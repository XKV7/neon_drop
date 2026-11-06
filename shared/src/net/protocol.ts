import { Reader, Writer } from './codec';
import type { InputCmd, SimEvent } from '../sim/world';

export const PROTOCOL_VERSION = 3;

export const enum Msg { Input = 1, Snapshot = 2, Ping = 3, Pong = 4 }

export const enum EntType { Hero = 1, Proj = 2, Zone = 3, Tele = 4, Deploy = 5, Neutral = 6, Pickup = 7 }

/** 엔티티 필드 인덱스 (16개 → u16 마스크) */
export const F = { TYPE: 0, SUB: 1, X: 2, Y: 3, A: 4, OWNER: 5, HP: 6, MAXHP: 7, SHIELD: 8, FLAGS: 9, ANIM: 10, ANIMSEQ: 11, LEVEL: 12, R: 13, T: 14, AUX: 15 } as const;
export const NFIELDS = 16;
const FIELD_KIND = ['u8', 'u8', 'i16', 'i16', 'u8', 'u16', 'u16', 'u16', 'u16', 'u16', 'u8', 'u8', 'u8', 'u16', 'u16', 'u16'] as const;
export const POS_SCALE = 64;
export const FULL_MASK = 0xffff;

export const enum HF {
  Stun = 1, Slow = 2, Silence = 4, Invert = 8, Root = 16, Stealth = 32, Untarget = 64, Invuln = 128,
  Dodge = 256, Cast = 512, Charge = 1024, Landing = 2048, Marked = 4096, Bush = 8192, Disconnected = 16384, Air = 32768,
}

export type NetEnt = Int32Array; // 양자화된 16개 필드

export function newEnt(): NetEnt { return new Int32Array(NFIELDS); }
export const qPos = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * POS_SCALE)));
export const qAng = (a: number) => Math.round(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 256) & 255;
export const dqAng = (q: number) => (q / 256) * Math.PI * 2;

function writeField(w: Writer, k: number, v: number) {
  switch (FIELD_KIND[k]) {
    case 'u8': w.writeU8(v); break;
    case 'u16': w.writeU16(v); break;
    case 'i16': w.writeI16(v); break;
  }
}
function readField(r: Reader, k: number): number {
  switch (FIELD_KIND[k]) {
    case 'u8': return r.readU8();
    case 'u16': return r.readU16();
    default: return r.readI16();
  }
}

// ───────────── 입력 ─────────────

export function encodeInputs(ackTick: number, inputs: InputCmd[]): Uint8Array {
  const w = new Writer(64);
  w.writeU8(Msg.Input);
  w.writeU32(ackTick);
  w.writeU8(inputs.length);
  for (const i of inputs) {
    w.writeU32(i.seq);
    w.writeI8(i.mx * 127); w.writeI8(i.my * 127);
    w.writeI16(i.ax * POS_SCALE); w.writeI16(i.ay * POS_SCALE);
    w.writeU8(i.held); w.writeU8(i.pressed);
    w.writeF32(i.viewTick);
  }
  return w.bytes();
}

export function decodeInputs(r: Reader): { ackTick: number; inputs: InputCmd[] } {
  const ackTick = r.readU32();
  const n = Math.min(8, r.readU8());
  const inputs: InputCmd[] = [];
  for (let k = 0; k < n; k++) {
    const seq = r.readU32();
    const mx = r.readI8() / 127, my = r.readI8() / 127;
    const ax = r.readI16() / POS_SCALE, ay = r.readI16() / POS_SCALE;
    const held = r.readU8(), pressed = r.readU8();
    const viewTick = r.readF32();
    inputs.push({ seq, mx, my, ax, ay, held, pressed, viewTick });
  }
  return { ackTick, inputs };
}

// ───────────── 스냅샷 ─────────────

export interface MatchBlock {
  phase: number; time: number; alive: number; total: number;
  zx: number; zy: number; zr: number; nx: number; ny: number; nr: number; showNext: number; stage: number; nextIn: number; moving: number; dps: number;
  supplies: { state: number; x: number; y: number; at: number }[];
  destroyed: number[];
}

export interface SelfBlock {
  heroId: number; viewId: number; state: number;
  x: number; y: number; fvx: number; fvy: number; ft: number; ft0: number; fkind: number; dodgeCd: number; gateCd: number; padCd: number;
  speed: number; moveFlags: number; dodgeCdMax: number;
  cds: number[]; maxCds: number[]; charges: number[]; chargeMax: number[];
  ult: number; xp: number; xpPrev: number; xpNext: number; level: number;
  castSlot: number; castProg: number; chargeProg: number; channelProg: number; kills: number;
}

export interface SnapshotData {
  tick: number; baseTick: number; ackSeq: number;
  match: MatchBlock; self: SelfBlock;
  ents: Map<number, NetEnt>; // 기준 스냅샷에 델타를 적용한 결과
  changed: number[]; removed: number[];
  events: SimEvent[];
  bytes: number;
}

export function encodeSnapshot(
  tick: number, baseTick: number, ackSeq: number, match: MatchBlock, self: SelfBlock,
  cur: Map<number, NetEnt>, base: Map<number, NetEnt> | null, events: SimEvent[], w = new Writer(2048),
): Uint8Array {
  w.reset();
  w.writeU8(Msg.Snapshot);
  w.writeU32(tick); w.writeU32(base ? baseTick : 0); w.writeU32(ackSeq);
  // 매치
  w.writeU8(match.phase); w.writeU32(match.time); w.writeU8(match.alive); w.writeU8(match.total);
  w.writeI16(match.zx * POS_SCALE); w.writeI16(match.zy * POS_SCALE); w.writeU16(match.zr * POS_SCALE);
  w.writeI16(match.nx * POS_SCALE); w.writeI16(match.ny * POS_SCALE); w.writeU16(match.nr * POS_SCALE);
  w.writeU8(match.showNext); w.writeU8(match.stage); w.writeU16(match.nextIn * 10); w.writeU8(match.moving); w.writeU16(match.dps);
  w.writeU8(match.supplies.length);
  for (const s of match.supplies) { w.writeU8(s.state); w.writeI16(s.x * POS_SCALE); w.writeI16(s.y * POS_SCALE); w.writeU16(s.at); }
  w.writeU8(Math.min(255, match.destroyed.length));
  for (const d of match.destroyed.slice(0, 255)) w.writeU8(d);
  // 자신
  w.writeU16(self.heroId); w.writeU16(self.viewId); w.writeU8(self.state);
  w.writeF32(self.x); w.writeF32(self.y); w.writeF32(self.fvx); w.writeF32(self.fvy);
  w.writeU8(self.ft); w.writeU8(self.ft0); w.writeU8(self.fkind); w.writeU16(self.dodgeCd); w.writeU8(self.gateCd); w.writeU8(self.padCd);
  w.writeU16(self.speed * 100); w.writeU8(self.moveFlags); w.writeU16(self.dodgeCdMax);
  for (let i = 0; i < 5; i++) { w.writeU16(self.cds[i]); w.writeU16(self.maxCds[i]); }
  for (let i = 0; i < 5; i++) { w.writeU8(self.charges[i]); w.writeU8(self.chargeMax[i]); }
  w.writeU8(self.ult * 255); w.writeU16(self.xp); w.writeU16(self.xpPrev); w.writeU16(self.xpNext); w.writeU8(self.level);
  w.writeU8(self.castSlot); w.writeU8(self.castProg); w.writeU8(self.chargeProg); w.writeU8(self.channelProg); w.writeU8(self.kills);
  // 엔티티 델타
  const countAt = w.o; w.writeU16(0);
  let count = 0;
  for (const [id, e] of cur) {
    const b = base?.get(id);
    let mask = 0;
    if (!b || b[F.TYPE] !== e[F.TYPE]) mask = FULL_MASK;
    else for (let k = 0; k < NFIELDS; k++) if (b[k] !== e[k]) mask |= 1 << k;
    if (mask === 0) continue;
    w.writeU16(id); w.writeU16(mask);
    for (let k = 0; k < NFIELDS; k++) if (mask & (1 << k)) writeField(w, k, e[k]);
    count++;
  }
  w.dv.setUint16(countAt, count, true);
  const removed: number[] = [];
  if (base) for (const id of base.keys()) if (!cur.has(id)) removed.push(id);
  w.writeU16(removed.length);
  for (const id of removed) w.writeU16(id);
  // 이벤트
  w.writeU16(events.length);
  for (const e of events) {
    w.writeU8(e.k); w.writeU16(e.a); w.writeU16(e.b);
    w.writeI16(e.x * POS_SCALE); w.writeI16(e.y * POS_SCALE); w.writeU16(e.p); w.writeU8(e.f);
  }
  return w.bytes();
}

/** baseLookup(tick)은 클라이언트가 보관한 기준 스냅샷 엔티티 맵 */
export function decodeSnapshot(r: Reader, baseLookup: (tick: number) => Map<number, NetEnt> | undefined): SnapshotData | null {
  const start = r.o - 1;
  const tick = r.readU32(), baseTick = r.readU32(), ackSeq = r.readU32();
  const match: MatchBlock = {
    phase: r.readU8(), time: r.readU32(), alive: r.readU8(), total: r.readU8(),
    zx: r.readI16() / POS_SCALE, zy: r.readI16() / POS_SCALE, zr: r.readU16() / POS_SCALE,
    nx: r.readI16() / POS_SCALE, ny: r.readI16() / POS_SCALE, nr: r.readU16() / POS_SCALE,
    showNext: r.readU8(), stage: r.readU8(), nextIn: r.readU16() / 10, moving: r.readU8(), dps: r.readU16(),
    supplies: [], destroyed: [],
  };
  const ns = r.readU8();
  for (let i = 0; i < ns; i++) match.supplies.push({ state: r.readU8(), x: r.readI16() / POS_SCALE, y: r.readI16() / POS_SCALE, at: r.readU16() });
  const nd = r.readU8();
  for (let i = 0; i < nd; i++) match.destroyed.push(r.readU8());
  const self: SelfBlock = {
    heroId: r.readU16(), viewId: r.readU16(), state: r.readU8(),
    x: r.readF32(), y: r.readF32(), fvx: r.readF32(), fvy: r.readF32(),
    ft: r.readU8(), ft0: r.readU8(), fkind: r.readU8(), dodgeCd: r.readU16(), gateCd: r.readU8(), padCd: r.readU8(),
    speed: r.readU16() / 100, moveFlags: r.readU8(), dodgeCdMax: r.readU16(),
    cds: [], maxCds: [], charges: [], chargeMax: [],
    ult: 0, xp: 0, xpPrev: 0, xpNext: 0, level: 1, castSlot: 255, castProg: 0, chargeProg: 0, channelProg: 0, kills: 0,
  };
  for (let i = 0; i < 5; i++) { self.cds.push(r.readU16()); self.maxCds.push(r.readU16()); }
  for (let i = 0; i < 5; i++) { self.charges.push(r.readU8()); self.chargeMax.push(r.readU8()); }
  self.ult = r.readU8() / 255; self.xp = r.readU16(); self.xpPrev = r.readU16(); self.xpNext = r.readU16(); self.level = r.readU8();
  self.castSlot = r.readU8(); self.castProg = r.readU8(); self.chargeProg = r.readU8(); self.channelProg = r.readU8(); self.kills = r.readU8();

  let base: Map<number, NetEnt> | undefined;
  if (baseTick !== 0) { base = baseLookup(baseTick); if (!base) return null; }
  const ents = new Map<number, NetEnt>();
  if (base) for (const [id, e] of base) ents.set(id, e);
  const changed: number[] = [];
  const n = r.readU16();
  for (let i = 0; i < n; i++) {
    const id = r.readU16(), mask = r.readU16();
    const prev = ents.get(id);
    const e = mask === FULL_MASK || !prev ? newEnt() : prev.slice();
    for (let k = 0; k < NFIELDS; k++) if (mask & (1 << k)) e[k] = readField(r, k);
    ents.set(id, e);
    changed.push(id);
  }
  const removed: number[] = [];
  const nr = r.readU16();
  for (let i = 0; i < nr; i++) { const id = r.readU16(); ents.delete(id); removed.push(id); }
  const events: SimEvent[] = [];
  const ne = r.readU16();
  for (let i = 0; i < ne; i++) events.push({ k: r.readU8(), a: r.readU16(), b: r.readU16(), x: r.readI16() / POS_SCALE, y: r.readI16() / POS_SCALE, p: r.readU16(), f: r.readU8() });
  return { tick, baseTick, ackSeq, match, self, ents, changed, removed, events, bytes: r.o - start };
}

export function encodePing(t: number): Uint8Array { const w = new Writer(16); w.writeU8(Msg.Ping); w.writeF64(t); return w.bytes(); }
export function encodePong(t: number, tick: number): Uint8Array { const w = new Writer(16); w.writeU8(Msg.Pong); w.writeF64(t); w.writeU32(tick); return w.bytes(); }
