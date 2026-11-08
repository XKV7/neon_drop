import { Match } from '../sim/match';
import { Reader, Writer } from './codec';
import { decodeInputs, encodePong, encodeSnapshot, EntType, F, HF, MatchBlock, Msg, NetEnt, newEnt, qAng, qPos, SelfBlock } from './protocol';
import { EMPTY_INPUT, Fx, Hero, InputCmd, MatchMsg, SimEvent } from '../sim/world';
import { canSeeArea, canSeePoint } from '../sim/vision';
import { bushAt } from '../sim/map';
import { ForcedKind } from '../sim/movement';
import { xpForNext } from '../sim/combat';
import { XP_TABLE } from '../data/heroes';
import { FX_VISUALS, PROJ_VISUALS } from '../sim/skills';
import { TICK_RATE, VIEW_RADIUS } from '../sim/constants';

export interface HostClient {
  heroId: number;
  send: (data: Uint8Array) => void;
  sendJson: (msg: object) => void;
  ackTick: number;
  hist: Map<number, Map<number, NetEnt>>;
  queue: InputCmd[];
  lastInput: InputCmd;
  recvSeq: number;
  appliedSeq: number;
  spectate: number;
  rateWindow: number;
  rateCount: number;
  rejected: number;
  connected: boolean;
  bytesOut: number;
}

const MAX_QUEUE = 6;
const MAX_INPUTS_PER_SEC = 40;

export class MatchHost {
  match: Match;
  clients = new Map<number, HostClient>();
  /** 대기열 관전자 (영웅 없음, heroId = 0) — 키는 서버 세션 id */
  spectators = new Map<number, HostClient>();
  private writer = new Writer(4096);
  onMsg: (m: MatchMsg) => void = () => {};
  private globalEnts = new Map<number, { e: NetEnt; x: number; y: number; kind: number; owner: number; r: number }>();

  constructor(match: Match) { this.match = match; }

  attach(heroId: number, send: (d: Uint8Array) => void, sendJson: (m: object) => void): HostClient {
    const old = this.clients.get(heroId);
    const c: HostClient = {
      heroId, send, sendJson, ackTick: 0, hist: new Map(), queue: [], lastInput: { ...EMPTY_INPUT }, recvSeq: old?.recvSeq ?? 0, appliedSeq: old?.appliedSeq ?? 0,
      spectate: 0, rateWindow: 0, rateCount: 0, rejected: 0, connected: true, bytesOut: 0,
    };
    this.clients.set(heroId, c);
    this.match.setDisconnected(heroId, false);
    // 진행 중인 증강 선택 재전송
    const h = this.match.w.hero(heroId);
    if (h && h.augments.length) sendJson({ type: 'augList', ids: [...h.augments] });
    if (h && h.pending.length) sendJson({ type: 'augOffer', options: h.pending[0].options, source: h.pending[0].source, deadline: h.pending[0].deadline, queue: h.pending.length });
    return c;
  }

  attachSpectator(sid: number, send: (d: Uint8Array) => void, sendJson: (m: object) => void): HostClient {
    const c: HostClient = {
      heroId: 0, send, sendJson, ackTick: 0, hist: new Map(), queue: [], lastInput: { ...EMPTY_INPUT }, recvSeq: 0, appliedSeq: 0,
      spectate: this.pickSpectateTarget(), rateWindow: 0, rateCount: 0, rejected: 0, connected: true, bytesOut: 0,
    };
    this.spectators.set(sid, c);
    return c;
  }

  detachSpectator(sid: number) { this.spectators.delete(sid); }

  /** 관전 대상 기본값: 사람 > 처치 많은 순 */
  pickSpectateTarget(): number {
    const alive = this.match.w.heroes.filter(h => h.state !== 'dead');
    alive.sort((a, b) => Number(a.isBot) - Number(b.isBot) || b.kills - a.kills);
    return alive[0]?.id ?? 1;
  }

  setSpectatorTarget(sid: number, target: number) {
    const c = this.spectators.get(sid);
    const t = this.match.w.hero(target);
    if (c && t && t.state !== 'dead') c.spectate = target;
  }

  /** 관전자 ack (관전자는 입력 대신 확인 틱만 보낸다) */
  spectatorAck(sid: number, data: Uint8Array) {
    const c = this.spectators.get(sid);
    if (!c) return;
    try {
      const r = new Reader(data);
      const type = r.readU8();
      if (type === Msg.Input) { const { ackTick } = decodeInputs(r); if (ackTick <= this.match.w.tick && ackTick > c.ackTick) c.ackTick = ackTick; }
      else if (type === Msg.Ping) c.send(encodePong(r.readF64(), this.match.w.tick));
    } catch { /* 무시 */ }
  }

  detach(heroId: number) {
    const c = this.clients.get(heroId);
    if (c) c.connected = false;
    this.match.setDisconnected(heroId, true);
  }

  receiveBinary(heroId: number, data: Uint8Array) {
    const c = this.clients.get(heroId);
    if (!c) return;
    try {
      const r = new Reader(data);
      const type = r.readU8();
      if (type === Msg.Input) {
        const { ackTick, inputs } = decodeInputs(r);
        if (ackTick <= this.match.w.tick && ackTick > c.ackTick) c.ackTick = ackTick;
        const now = this.match.w.tick;
        if (now - c.rateWindow >= TICK_RATE) { c.rateWindow = now; c.rateCount = 0; }
        for (const inp of inputs) {
          if (inp.seq <= c.recvSeq) continue;
          if (!this.validInput(inp)) { c.rejected++; continue; }
          if (++c.rateCount > MAX_INPUTS_PER_SEC) { c.rejected++; continue; }
          c.recvSeq = inp.seq;
          inp.viewTick = Math.min(inp.viewTick, now);
          c.queue.push(inp);
        }
        if (c.queue.length > MAX_QUEUE) {
          // 밀린 입력: 누름은 보존하고 오래된 이동은 버린다
          const drop = c.queue.splice(0, c.queue.length - MAX_QUEUE);
          const pressed = drop.reduce((p, i) => p | i.pressed, 0);
          c.queue[0].pressed |= pressed;
        }
      } else if (type === Msg.Ping) {
        const t = r.readF64();
        c.send(encodePong(t, this.match.w.tick));
      }
    } catch {
      c.rejected++;
    }
  }

  private validInput(i: InputCmd): boolean {
    const ok = (v: number, lim: number) => Number.isFinite(v) && Math.abs(v) <= lim;
    if (!ok(i.mx, 1.01) || !ok(i.my, 1.01) || !ok(i.ax, 200) || !ok(i.ay, 200)) return false;
    if (Math.hypot(i.mx, i.my) > 1.42) return false;
    if (!Number.isFinite(i.viewTick)) return false;
    if ((i.held | i.pressed) > 127) return false;
    return true;
  }

  setSpectate(heroId: number, target: number) {
    const c = this.clients.get(heroId);
    const t = this.match.w.hero(target);
    if (c && t && t.state !== 'dead') c.spectate = target;
  }

  step() {
    const m = this.match, w = m.w;
    // 입력 적용 (틱당 1개, 밀리면 2개 합치기)
    for (const c of this.clients.values()) {
      const h = w.hero(c.heroId);
      if (!h) continue;
      let inp: InputCmd | undefined = c.queue.shift();
      if (inp && c.queue.length > 2) {
        const next = c.queue.shift()!;
        next.pressed |= inp.pressed;
        inp = next;
      }
      if (inp) { c.lastInput = inp; c.appliedSeq = inp.seq; m.setInput(c.heroId, inp); }
      else m.setInput(c.heroId, { ...c.lastInput, pressed: 0 });
    }
    m.step();
    for (const msg of w.msgs) this.routeMsg(msg);
    w.msgs.length = 0;
    this.buildGlobal();
    for (const c of this.clients.values()) if (c.connected) this.sendSnapshot(c);
    for (const c of this.spectators.values()) this.sendSnapshot(c);
    if (w.tick % 30 === 0) {
      const sb = { type: 'scoreboard', rows: m.scoreboard() };
      for (const c of this.clients.values()) if (c.connected) c.sendJson(sb);
      for (const c of this.spectators.values()) c.sendJson(sb);
    }
  }

  private routeMsg(msg: MatchMsg) {
    this.onMsg(msg);
    if (msg.to === 'all') { for (const c of this.clients.values()) if (c.connected) c.sendJson(msg); for (const c of this.spectators.values()) if (msg.type !== 'end') c.sendJson(msg); }
    else { const c = this.clients.get(msg.to); if (c && c.connected) c.sendJson(msg); }
  }

  private heroFlags(h: Hero): number {
    const st = h.st;
    let f = 0;
    if (st.stunT > 0) f |= HF.Stun;
    if (st.slows.length) f |= HF.Slow;
    if (st.silenceT > 0) f |= HF.Silence;
    if (st.invertT > 0) f |= HF.Invert;
    if (st.rootT > 0) f |= HF.Root;
    if (st.stealthT > 0) f |= HF.Stealth;
    if (st.untargetT > 0) f |= HF.Untarget;
    if (st.invulnT > 0) f |= HF.Invuln;
    if (h.m.fkind === ForcedKind.Dodge && h.m.ft > 0) f |= HF.Dodge;
    if (h.cast) f |= HF.Cast;
    if (h.charging) f |= HF.Charge;
    if (h.state === 'landing') f |= HF.Landing;
    if (st.markT > 0) f |= HF.Marked;
    if (bushAt(this.match.w.map, h.m.x, h.m.y) >= 0) f |= HF.Bush;
    if (h.disconnected && !h.isBot) f |= HF.Disconnected;
    if (h.m.ft > 0 && (h.m.fkind === ForcedKind.Jump || h.m.fkind === ForcedKind.Leap)) f |= HF.Air;
    return f;
  }

  /** 모든 엔티티를 양자화 (관찰자별 필터 전) */
  private buildGlobal() {
    const w = this.match.w;
    const g = this.globalEnts;
    g.clear();
    for (const h of w.heroes) {
      if (h.state === 'dead' || h.state === 'drop') continue;
      const e = newEnt();
      e[F.TYPE] = EntType.Hero; e[F.SUB] = h.def.index; e[F.X] = qPos(h.m.x); e[F.Y] = qPos(h.m.y); e[F.A] = qAng(h.facing);
      e[F.OWNER] = 0; e[F.HP] = Math.ceil(h.hp); e[F.MAXHP] = h.maxHp; e[F.SHIELD] = Math.ceil(h.shield); e[F.FLAGS] = this.heroFlags(h);
      e[F.ANIM] = h.anim; e[F.ANIMSEQ] = h.animSeq; e[F.LEVEL] = h.level;
      e[F.R] = h.state === 'landing' ? h.landT : 0;
      e[F.T] = h.cast ? Math.round((h.cast.t / Math.max(1, h.cast.total)) * 255) : h.charging ? Math.min(255, Math.round((h.charging.t / ((h.skills[h.charging.slot].chargeUp?.max ?? 1) * TICK_RATE)) * 255)) : 0;
      e[F.AUX] = (Math.min(255, h.m.ft) & 255) | ((Math.min(255, h.m.ft0) & 255) << 8);
      g.set(h.id, { e, x: h.m.x, y: h.m.y, kind: EntType.Hero, owner: h.id, r: 0 });
    }
    for (const p of w.projectiles) {
      const e = newEnt();
      e[F.TYPE] = EntType.Proj; e[F.SUB] = Math.max(0, (PROJ_VISUALS as readonly string[]).indexOf(p.visual)); e[F.X] = qPos(p.x); e[F.Y] = qPos(p.y);
      e[F.A] = qAng(Math.atan2(p.dy, p.dx)); e[F.OWNER] = p.owner; e[F.R] = Math.round(p.radius * 100); e[F.T] = Math.round(p.speed * 10);
      e[F.AUX] = (p.neutral ? 1 : 0) | (p.returning ? 2 : 0) | (p.turret ? 4 : 0) | (p.full ? 8 : 0);
      e[F.LEVEL] = p.slot;
      g.set(p.id, { e, x: p.x, y: p.y, kind: EntType.Proj, owner: p.owner, r: 0 });
    }
    for (const z of w.zones) {
      const e = newEnt();
      e[F.TYPE] = EntType.Zone; e[F.SUB] = Math.max(0, (FX_VISUALS as readonly string[]).indexOf(z.act.visual)); e[F.X] = qPos(z.x); e[F.Y] = qPos(z.y);
      e[F.OWNER] = z.owner; e[F.R] = Math.round(z.r * 100); e[F.T] = Math.min(65535, z.t); e[F.AUX] = Math.min(65535, z.dur); e[F.FLAGS] = z.started ? 1 : 0;
      e[F.LEVEL] = z.slot;
      g.set(z.id, { e, x: z.x, y: z.y, kind: EntType.Zone, owner: z.owner, r: z.r });
    }
    for (const t of w.telegraphs) {
      const e = newEnt();
      e[F.TYPE] = EntType.Tele; e[F.SUB] = t.visual; e[F.X] = qPos(t.x); e[F.Y] = qPos(t.y); e[F.A] = qAng(t.ang); e[F.OWNER] = t.owner;
      e[F.R] = Math.round(t.r * 100); e[F.T] = Math.min(65535, t.t); e[F.AUX] = Math.min(65535, t.delay); e[F.LEVEL] = t.shape;
      e[F.MAXHP] = Math.round(t.len * 100); e[F.SHIELD] = Math.round(t.w * 100);
      g.set(t.id, { e, x: t.x, y: t.y, kind: EntType.Tele, owner: t.owner, r: Math.max(t.r, t.len) });
    }
    for (const d of w.deployables) {
      const e = newEnt();
      e[F.TYPE] = EntType.Deploy; e[F.SUB] = d.kind === 'trap' ? 1 : d.act.zone ? 2 : 0; e[F.X] = qPos(d.x); e[F.Y] = qPos(d.y); e[F.A] = qAng(d.facing);
      e[F.OWNER] = d.owner; e[F.R] = Math.round(d.act.range * 100); e[F.T] = Math.min(65535, d.t); e[F.AUX] = Math.min(65535, d.dur); e[F.FLAGS] = d.armed ? 1 : 0;
      g.set(d.id, { e, x: d.x, y: d.y, kind: EntType.Deploy, owner: d.owner, r: d.kind === 'trap' ? -1 : d.act.zone ? d.act.range : 0 });
    }
    for (const n of w.neutrals) {
      if (!n.alive) continue;
      const e = newEnt();
      e[F.TYPE] = EntType.Neutral; e[F.X] = qPos(n.x); e[F.Y] = qPos(n.y); e[F.A] = qAng(n.facing); e[F.HP] = Math.ceil(n.hp); e[F.MAXHP] = n.maxHp;
      e[F.ANIM] = n.anim; e[F.ANIMSEQ] = n.animSeq; e[F.FLAGS] = n.aggro ? 1 : 0;
      g.set(n.id, { e, x: n.x, y: n.y, kind: EntType.Neutral, owner: 0, r: 0 });
    }
    for (const p of w.pickups) {
      if (p.used && p.kind === 'core') continue;
      const e = newEnt();
      e[F.TYPE] = EntType.Pickup; e[F.SUB] = p.kind === 'core' ? 0 : p.kind === 'crate' ? 1 : 2; e[F.X] = qPos(p.x); e[F.Y] = qPos(p.y); e[F.FLAGS] = p.used ? 1 : 0;
      g.set(p.id, { e, x: p.x, y: p.y, kind: EntType.Pickup, owner: 0, r: p.kind === 'core' ? 0 : 99 });
    }
  }

  observerFor(c: HostClient): Hero {
    const w = this.match.w;
    if (c.heroId === 0) {
      let t = w.hero(c.spectate);
      if (!t || t.state === 'dead') { c.spectate = this.pickSpectateTarget(); t = w.hero(c.spectate); }
      return t ?? w.heroes[0];
    }
    const me = w.hero(c.heroId)!;
    if (me.state !== 'dead') return me;
    let t = c.spectate ? w.hero(c.spectate) : undefined;
    if (!t || t.state === 'dead') {
      t = (me.killer ? w.hero(me.killer) : undefined);
      if (!t || t.state === 'dead') t = w.heroes.find(h => h.state !== 'dead');
      c.spectate = t ? t.id : 0;
    }
    return t ?? me;
  }

  private sendSnapshot(c: HostClient) {
    const m = this.match, w = m.w;
    const obs = this.observerFor(c);
    const me = c.heroId === 0 ? obs : w.hero(c.heroId)!;
    const ox = obs.m.x, oy = obs.m.y;
    const cur = new Map<number, NetEnt>();
    for (const [id, g] of this.globalEnts) {
      let vis = false;
      switch (g.kind) {
        case EntType.Hero: vis = obs.state === 'drop' ? true : m.visible(obs.id, id) || (me.state === 'drop'); break;
        case EntType.Proj: vis = g.owner === obs.id || canSeePoint(w, ox, oy, g.x, g.y, 2); break;
        case EntType.Zone: case EntType.Tele: vis = g.owner === obs.id || canSeeArea(ox, oy, g.x, g.y, g.r); break;
        case EntType.Deploy:
          if (g.r === -1) vis = g.owner === obs.id || ((g.x - ox) ** 2 + (g.y - oy) ** 2 < 2.2 * 2.2);
          else vis = g.owner === obs.id || canSeePoint(w, ox, oy, g.x, g.y) || (g.r > 0 && canSeeArea(ox, oy, g.x, g.y, g.r));
          break;
        case EntType.Neutral: vis = canSeePoint(w, ox, oy, g.x, g.y); break;
        case EntType.Pickup: vis = g.r > 0 || canSeePoint(w, ox, oy, g.x, g.y, 3); break;
      }
      if (vis) cur.set(id, g.e);
    }
    const base = c.ackTick ? c.hist.get(c.ackTick) ?? null : null;
    const z = m.zs;
    const match: MatchBlock = {
      phase: m.phase === 'drop' ? 0 : m.phase === 'play' ? 1 : 2, time: w.tick - m.startTick,
      alive: w.heroes.filter(h => h.state !== 'dead').length, total: w.heroes.length,
      zx: z?.x ?? 0, zy: z?.y ?? 0, zr: z?.r ?? 0, nx: z?.nx ?? 0, ny: z?.ny ?? 0, nr: z?.nr ?? 0,
      showNext: z?.showNext ? 1 : 0, stage: z?.stage ?? 0, nextIn: Math.max(0, z?.nextShrinkIn ?? 0), moving: z?.moving ? 1 : 0, dps: Math.round(z?.dps ?? 0),
      supplies: m.supply.map(s => ({ state: s.state, x: s.x, y: s.y, at: s.at })),
      destroyed: w.destroyed,
    };
    const self = this.selfBlock(me, obs);
    if (c.heroId === 0) { self.heroId = 0; self.state = 3; }
    // 이벤트 필터
    const R = VIEW_RADIUS + 5;
    const evs: SimEvent[] = [];
    for (const e of w.events) {
      const near = (e.x - ox) ** 2 + (e.y - oy) ** 2 < R * R;
      const mine = e.a === me.id || e.b === me.id || e.a === obs.id || e.b === obs.id;
      const global = e.k === Fx.Supply || e.k === Fx.Destroy;
      if (near || mine || global) evs.push(e);
    }
    const bytes = encodeSnapshot(w.tick, c.ackTick, c.appliedSeq, match, self, cur, base, evs, this.writer);
    c.hist.set(w.tick, cur);
    if (c.hist.size > 40) { const cut = w.tick - 40; for (const k of c.hist.keys()) if (k < cut) c.hist.delete(k); }
    c.bytesOut += bytes.byteLength;
    c.send(bytes);
  }

  private selfBlock(me: Hero, obs: Hero): SelfBlock {
    const p = this.match.moveParams(me);
    const lvl = me.level;
    return {
      heroId: me.id, viewId: obs.id, state: me.state === 'drop' ? 0 : me.state === 'landing' ? 1 : me.state === 'play' ? 2 : 3,
      x: me.m.x, y: me.m.y, fvx: me.m.fvx, fvy: me.m.fvy, ft: Math.min(255, me.m.ft), ft0: Math.min(255, me.m.ft0), fkind: me.m.fkind,
      dodgeCd: me.m.dodgeCd, gateCd: Math.min(255, me.m.gateCd), padCd: Math.min(255, me.m.padCd),
      speed: p.speed, moveFlags: (p.canMove ? 1 : 0) | (p.canDodge ? 2 : 0) | (p.invert ? 4 : 0), dodgeCdMax: p.dodgeCdTicks,
      cds: me.cds.map(v => Math.max(0, Math.round(v))), maxCds: me.maxCds, charges: me.charges, chargeMax: me.chargeMax,
      ult: me.ult, xp: Math.floor(me.xp), xpPrev: XP_TABLE[lvl - 1], xpNext: xpForNext(lvl), level: lvl,
      castSlot: me.cast ? me.cast.slot : me.charging ? me.charging.slot : 255,
      castProg: me.cast ? Math.round((me.cast.t / Math.max(1, me.cast.total)) * 255) : 0,
      chargeProg: me.charging ? Math.min(255, Math.round((me.charging.t / ((me.skills[me.charging.slot].chargeUp?.max ?? 1) * TICK_RATE)) * 255)) : 0,
      channelProg: me.channel ? Math.round((me.channel.t / me.channel.total) * 255) : 0,
      kills: me.kills,
    };
  }
}
