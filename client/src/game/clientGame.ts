import {
  generateMap, decodeSnapshot, encodeInputs, encodePing, Reader, Msg, F, EntType, POS_SCALE, dqAng, HF, stepMove, computeStats, HERO_RADIUS, TICK_MS,
  type MapData, type NetEnt, type SnapshotData, type MoveState, type InputCmd, type RosterEntry, type SimEvent, type MatchBlock, type SelfBlock, Btn, HERO_BY_ID, compileSkills, HEROES,
} from '@neon/shared';
import type { GameTransport } from '../net/connection';
import type { Input } from './input';

export interface VisEnt {
  id: number; type: number; sub: number; x: number; y: number; a: number; owner: number; hp: number; maxHp: number; shield: number;
  flags: number; anim: number; animSeq: number; level: number; r: number; t: number; aux: number; seen: number;
}

interface Stored { tick: number; ents: Map<number, NetEnt>; match: MatchBlock; self: SelfBlock }

const INTERP_BASE = 3; // 100ms

export class ClientGame {
  map: MapData;
  alive: Uint8Array;
  you: number;
  roster: RosterEntry[];
  mode: string;
  transport: GameTransport;
  input: Input | null;
  spectatorOnly: boolean;

  private store = new Map<number, Stored>();
  private ticks: number[] = [];
  latest: Stored | null = null;
  newestTick = 0;
  private offset = 0;
  private offsetInit = false;
  private samples: number[] = [];
  jitter = 0;
  /** 현재 보간 지연 (틱) */
  delay = INTERP_BASE;
  renderTick = 0;

  // 예측
  pred: MoveState = { x: 0, y: 0, fvx: 0, fvy: 0, ft: 0, ft0: 0, fkind: 0, dodgeCd: 0, gateCd: 0, padCd: 0 };
  private prevPred = { x: 0, y: 0 };
  private inputs: InputCmd[] = [];
  private seq = 0;
  private acc = 0;
  errX = 0; errY = 0;
  corrections = 0;
  predAlpha = 0;
  augments: string[] = [];

  aimX = 0; aimY = 0;
  view = new Map<number, VisEnt>();
  events: SimEvent[] = [];
  ping = 0;
  private pingTimer = 0;
  private lastPingSent = 0;
  snapCount = 0;
  bytesPerSec = 0;
  private byteAcc = 0;
  private byteTimer = 0;
  lastSnapBytes = 0;
  selfState = 0;
  get self(): SelfBlock | null { return this.latest?.self ?? null; }
  get match(): MatchBlock | null { return this.latest?.match ?? null; }

  /** 네트워크 관전자: 입력 없이 확인(ack)과 핑만 보내 델타 스냅샷을 받는다 */
  ackOnly = false;

  constructor(transport: GameTransport, start: { seed: number; you: number; roster: RosterEntry[]; mode: string }, input: Input | null, spectatorOnly = false) {
    this.transport = transport;
    this.map = generateMap(start.seed);
    this.alive = new Uint8Array(this.map.obstacles.length).fill(1);
    this.you = start.you;
    this.roster = start.roster;
    this.mode = start.mode;
    this.input = input;
    this.spectatorOnly = spectatorOnly;
  }

  rosterOf(id: number) { return this.roster.find(r => r.id === id); }

  handleBinary(d: Uint8Array) {
    const r = new Reader(d);
    const type = r.readU8();
    if (type === Msg.Snapshot) {
      let snap: SnapshotData | null = null;
      try { snap = decodeSnapshot(r, t => this.store.get(t)?.ents); } catch { return; }
      if (!snap) return;
      this.onSnapshot(snap, d.byteLength);
    } else if (type === Msg.Pong) {
      const t = r.readF64();
      const rtt = performance.now() - t;
      this.ping = this.ping ? this.ping * 0.7 + rtt * 0.3 : rtt;
    }
  }

  private onSnapshot(s: SnapshotData, bytes: number) {
    if (s.tick <= this.newestTick - 60) return;
    this.snapCount++;
    this.byteAcc += bytes;
    this.lastSnapBytes = bytes;
    const st: Stored = { tick: s.tick, ents: s.ents, match: s.match, self: s.self };
    this.store.set(s.tick, st);
    this.ticks.push(s.tick);
    this.ticks.sort((a, b) => a - b);
    while (this.ticks.length > 64) this.store.delete(this.ticks.shift()!);
    if (s.tick > this.newestTick) {
      this.newestTick = s.tick;
      this.latest = st;
      // 파괴된 장애물
      for (const id of s.match.destroyed) this.alive[id] = 0;
      // 시계 동기화
      const now = performance.now() / TICK_MS;
      const sample = s.tick - now;
      this.samples.push(sample);
      if (this.samples.length > 30) this.samples.shift();
      const mx = Math.max(...this.samples), mn = Math.min(...this.samples);
      this.jitter = Math.min(4, mx - mn);
      if (!this.offsetInit || Math.abs(sample - this.offset) > 8) { this.offset = sample; this.offsetInit = true; }
      else this.offset += (mx - this.offset) * 0.1;
      this.reconcile(s.self, s.ackSeq);
    }
    for (const e of s.events) this.events.push(e);
  }

  private moveParams(self: SelfBlock) {
    const stats = computeStats(this.augments);
    return {
      speed: self.speed, canMove: (self.moveFlags & 1) !== 0, canDodge: (self.moveFlags & 2) !== 0, invert: (self.moveFlags & 4) !== 0,
      radius: HERO_RADIUS * (1 + stats.size), dodgeCdTicks: self.dodgeCdMax, dodgeDistMult: 1 + stats.dodgeDist,
    };
  }

  private reconcile(self: SelfBlock, ackSeq: number) {
    this.selfState = self.state;
    if (this.spectatorOnly) return;
    // 처리된 입력 버리기
    while (this.inputs.length && this.inputs[0].seq <= ackSeq) this.inputs.shift();
    if (self.state !== 2) { this.pred.x = self.x; this.pred.y = self.y; this.prevPred = { x: self.x, y: self.y }; this.errX = this.errY = 0; return; }
    const oldX = this.pred.x, oldY = this.pred.y;
    const ms: MoveState = { x: self.x, y: self.y, fvx: self.fvx, fvy: self.fvy, ft: self.ft, ft0: self.ft0, fkind: self.fkind, dodgeCd: self.dodgeCd, gateCd: self.gateCd, padCd: self.padCd };
    const p = this.moveParams(self);
    for (const i of this.inputs) stepMove(ms, { mx: i.mx, my: i.my, ax: i.ax, ay: i.ay, dodge: (i.pressed & Btn.Dodge) !== 0 }, p, this.map, this.alive);
    const dx = oldX - ms.x, dy = oldY - ms.y;
    const err = Math.hypot(dx, dy);
    if (err > 0.05) this.corrections++;
    if (err > 4) { this.errX = this.errY = 0; this.prevPred = { x: ms.x, y: ms.y }; }
    else { this.errX += dx; this.errY += dy; }
    this.pred = ms;
  }

  /** 매 프레임 호출 */
  update(dtMs: number) {
    const now = performance.now();
    this.acc += dtMs;
    let n = 0;
    while (this.acc >= TICK_MS && n < 5) { this.fixedTick(); this.acc -= TICK_MS; n++; }
    if (this.acc > TICK_MS * 5) this.acc = 0;
    this.predAlpha = this.acc / TICK_MS;
    // 보정 오차를 부드럽게 줄인다
    const k = Math.exp(-dtMs / 90);
    this.errX *= k; this.errY *= k;
    if (Math.abs(this.errX) < 1e-3) this.errX = 0;
    if (Math.abs(this.errY) < 1e-3) this.errY = 0;
    // 렌더 시점
    // 지터가 크면 보간 지연을 늘리되(최대 +5틱), 화면이 튀지 않게 천천히 바꾼다
    const target = INTERP_BASE + Math.min(5, this.jitter * 0.7);
    this.delay += (target - this.delay) * Math.min(1, dtMs / (target > this.delay ? 150 : 1500));
    this.renderTick = now / TICK_MS + this.offset - this.delay;
    this.interpolate();
    if (now - this.pingTimer > 1000) {
      this.pingTimer = now;
      if (!this.spectatorOnly || this.ackOnly) this.transport.sendBinary(encodePing(now));
      this.lastPingSent = now;
    }
    if (now - this.byteTimer > 1000) { this.bytesPerSec = this.byteAcc * 1000 / (now - this.byteTimer || 1000); this.byteAcc = 0; this.byteTimer = now; }
  }

  get serverNow() { return performance.now() / TICK_MS + this.offset; }

  private fixedTick() {
    if (this.ackOnly && this.latest) { this.seq++; if (this.seq % 2 === 0) this.transport.sendBinary(encodeInputs(this.newestTick, [])); return; }
    if (this.spectatorOnly || !this.input || !this.latest) return;
    const self = this.latest.self;
    const mv = this.input.moveVector();
    const { held, pressed } = this.input.consume();
    this.seq++;
    const cmd: InputCmd = { seq: this.seq, mx: mv.x, my: mv.y, ax: this.aimX, ay: this.aimY, held, pressed, viewTick: Math.max(0, this.renderTick) };
    this.prevPred = { x: this.pred.x, y: this.pred.y };
    if (self.state === 2) {
      stepMove(this.pred, { mx: cmd.mx, my: cmd.my, ax: cmd.ax, ay: cmd.ay, dodge: (pressed & Btn.Dodge) !== 0 }, this.moveParams(self), this.map, this.alive);
    }
    this.inputs.push(cmd);
    if (this.inputs.length > 90) this.inputs.shift();
    const recent = this.inputs.slice(-3);
    this.transport.sendBinary(encodeInputs(this.newestTick, recent));
  }

  /** 내 영웅의 화면 위치 (예측 + 부드러운 보정) */
  myRenderPos(): { x: number; y: number } {
    const a = this.predAlpha;
    return { x: this.prevPred.x + (this.pred.x - this.prevPred.x) * a + this.errX, y: this.prevPred.y + (this.pred.y - this.prevPred.y) * a + this.errY };
  }

  private interpolate() {
    if (!this.latest) return;
    const rt = this.renderTick;
    // 기준 스냅샷 찾기
    let s0: Stored | null = null, s1: Stored | null = null;
    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const t = this.ticks[i];
      if (t <= rt) { s0 = this.store.get(t)!; s1 = i + 1 < this.ticks.length ? this.store.get(this.ticks[i + 1])! : null; break; }
    }
    if (!s0) { s0 = this.store.get(this.ticks[0])!; s1 = null; }
    const f = s1 ? Math.max(0, Math.min(1, (rt - s0.tick) / (s1.tick - s0.tick))) : 0;
    const latest = this.latest;
    const seen = new Set<number>();
    const nowServer = this.serverNow;
    // 보간 대상은 s0/s1, 수명이 짧은 엔티티(투사체 등)는 최신 스냅샷 기준
    for (const [id, e] of latest.ents) {
      const type = e[F.TYPE];
      seen.add(id);
      let v = this.view.get(id);
      if (!v) { v = { id, type, sub: 0, x: 0, y: 0, a: 0, owner: 0, hp: 0, maxHp: 0, shield: 0, flags: 0, anim: 0, animSeq: 0, level: 0, r: 0, t: 0, aux: 0, seen: performance.now() }; this.view.set(id, v); }
      v.type = type; v.sub = e[F.SUB]; v.owner = e[F.OWNER]; v.hp = e[F.HP]; v.maxHp = e[F.MAXHP]; v.shield = e[F.SHIELD];
      v.flags = e[F.FLAGS]; v.anim = e[F.ANIM]; v.animSeq = e[F.ANIMSEQ]; v.level = e[F.LEVEL]; v.r = e[F.R]; v.t = e[F.T]; v.aux = e[F.AUX];
      if (type === EntType.Proj) {
        // 현재 시점으로 외삽
        const dt = (nowServer - latest.tick) / 30;
        const ang = dqAng(e[F.A]), sp = e[F.T] / 10;
        const ex = Math.min(0.25, Math.max(0, dt));
        v.x = e[F.X] / POS_SCALE + Math.cos(ang) * sp * ex; v.y = e[F.Y] / POS_SCALE + Math.sin(ang) * sp * ex; v.a = ang;
        continue;
      }
      if (type === EntType.Zone || type === EntType.Tele || type === EntType.Deploy) {
        v.x = e[F.X] / POS_SCALE; v.y = e[F.Y] / POS_SCALE; v.a = dqAng(e[F.A]);
        // 시간 필드는 현재 시점 추정치로 보정
        v.t = e[F.T] + Math.max(0, Math.min(6, nowServer - latest.tick));
        continue;
      }
      const a0 = s0.ents.get(id), a1 = s1?.ents.get(id);
      if (a0 && a1 && a0[F.TYPE] === type && a1[F.TYPE] === type) {
        const x0 = a0[F.X] / POS_SCALE, y0 = a0[F.Y] / POS_SCALE, x1 = a1[F.X] / POS_SCALE, y1 = a1[F.Y] / POS_SCALE;
        if (Math.hypot(x1 - x0, y1 - y0) > 4) { v.x = x1; v.y = y1; }
        else { v.x = x0 + (x1 - x0) * f; v.y = y0 + (y1 - y0) * f; }
        let da = dqAng(a1[F.A]) - dqAng(a0[F.A]);
        while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        v.a = dqAng(a0[F.A]) + da * f;
      } else if (a0 && a0[F.TYPE] === type) {
        v.x = a0[F.X] / POS_SCALE; v.y = a0[F.Y] / POS_SCALE; v.a = dqAng(a0[F.A]);
        // 다음 스냅샷이 늦으면(서버·네트워크 지연) 직전 속도로 짧게(최대 4틱) 이어서 움직여 끊김을 줄인다
        const prevTick = s1 ? -1 : this.prevTickOf(s0.tick);
        const ap = prevTick >= 0 ? this.store.get(prevTick)?.ents.get(id) : undefined;
        if (ap && ap[F.TYPE] === type && type === EntType.Hero) {
          const span = s0.tick - prevTick, ex = Math.min(4, rt - s0.tick);
          const vx = (a0[F.X] - ap[F.X]) / POS_SCALE / span, vy = (a0[F.Y] - ap[F.Y]) / POS_SCALE / span;
          if (ex > 0 && span <= 4 && Math.hypot(vx, vy) < 0.6) { v.x += vx * ex; v.y += vy * ex; }
        }
      } else {
        // 보간 시점에 아직 없는 새 엔티티: 최신값 사용
        v.x = e[F.X] / POS_SCALE; v.y = e[F.Y] / POS_SCALE; v.a = dqAng(e[F.A]);
      }
    }
    for (const id of [...this.view.keys()]) if (!seen.has(id)) this.view.delete(id);
    // 내 영웅은 예측 위치
    if (!this.spectatorOnly && this.latest.self.state === 2) {
      const me = this.view.get(this.you);
      if (me) { const p = this.myRenderPos(); me.x = p.x; me.y = p.y; }
    }
  }

  private prevTickOf(tick: number): number {
    const i = this.ticks.indexOf(tick);
    return i > 0 ? this.ticks[i - 1] : -1;
  }

  takeEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }

  viewId(): number { return this.latest?.self.viewId ?? this.you; }

  myHeroDef() { const r = this.rosterOf(this.you); return r ? HERO_BY_ID[r.heroId] : HEROES[0]; }
  mySkills() { return compileSkills(this.myHeroDef(), this.augments); }

  isFlag(id: number, f: HF) { const v = this.view.get(id); return !!v && (v.flags & f) !== 0; }
}
