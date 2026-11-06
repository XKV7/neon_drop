import { describe, it, expect } from 'vitest';
import { Writer, Reader, encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot, newEnt, F, EntType, Msg, MatchBlock, SelfBlock, NetEnt, qPos, Match, MatchHost, HistoryBuffer, rewindTicks, Btn } from '../src/index';

const matchBlock = (): MatchBlock => ({ phase: 1, time: 900, alive: 7, total: 10, zx: 1.5, zy: -2, zr: 29, nx: 3, ny: 4, nr: 20, showNext: 1, stage: 1, nextIn: 12.5, moving: 0, dps: 15, supplies: [{ state: 1, x: 5, y: 6, at: 105 }], destroyed: [3, 9] });
const selfBlock = (): SelfBlock => ({
  heroId: 3, viewId: 3, state: 2, x: 1.25, y: -7.5, fvx: 0, fvy: 0, ft: 0, ft0: 0, fkind: 0, dodgeCd: 40, gateCd: 0, padCd: 0, speed: 5.5, moveFlags: 3, dodgeCdMax: 120,
  cds: [0, 30, 0, 90, 0], maxCds: [20, 180, 240, 270, 30], charges: [1, 0, 1, 0, 1], chargeMax: [1, 1, 1, 1, 1], ult: 0.5, xp: 140, xpPrev: 120, xpNext: 290, level: 2,
  castSlot: 255, castProg: 0, chargeProg: 0, channelProg: 0, kills: 1,
});

describe('바이너리 직렬화 왕복', () => {
  it('기본 자료형', () => {
    const w = new Writer(4);
    w.writeU8(200); w.writeI8(-100); w.writeU16(65000); w.writeI16(-12345); w.writeU32(4000000000); w.writeF32(1.5); w.writeF64(Math.PI); w.writeVarU(300000); w.writeStr('네온 낙하');
    const r = new Reader(w.bytes());
    expect(r.readU8()).toBe(200); expect(r.readI8()).toBe(-100); expect(r.readU16()).toBe(65000); expect(r.readI16()).toBe(-12345);
    expect(r.readU32()).toBe(4000000000); expect(r.readF32()).toBe(1.5); expect(r.readF64()).toBe(Math.PI); expect(r.readVarU()).toBe(300000); expect(r.readStr()).toBe('네온 낙하');
    expect(() => r.readU8()).toThrow();
  });

  it('입력 왕복', () => {
    const inputs = [{ seq: 10, mx: 1, my: -0.5, ax: 12.5, ay: -3.25, held: Btn.Basic, pressed: Btn.S1 | Btn.Dodge, viewTick: 123.5 }];
    const bytes = encodeInputs(99, inputs);
    const r = new Reader(bytes);
    expect(r.readU8()).toBe(Msg.Input);
    const d = decodeInputs(r);
    expect(d.ackTick).toBe(99);
    expect(d.inputs[0].seq).toBe(10);
    expect(d.inputs[0].mx).toBeCloseTo(1, 2); expect(d.inputs[0].my).toBeCloseTo(-0.5, 1);
    expect(d.inputs[0].ax).toBeCloseTo(12.5, 1); expect(d.inputs[0].pressed).toBe(Btn.S1 | Btn.Dodge);
    expect(d.inputs[0].viewTick).toBeCloseTo(123.5);
  });

  it('전체 스냅샷과 델타 스냅샷 왕복', () => {
    const mk = (x: number, hp: number): NetEnt => { const e = newEnt(); e[F.TYPE] = EntType.Hero; e[F.X] = qPos(x); e[F.Y] = qPos(2); e[F.HP] = hp; e[F.MAXHP] = 1000; return e; };
    const base = new Map<number, NetEnt>([[1, mk(1, 900)], [2, mk(5, 800)], [150, mk(9, 100)]]);
    const full = encodeSnapshot(100, 0, 5, matchBlock(), selfBlock(), base, null, [{ k: 1, a: 2, b: 1, x: 3, y: 4, p: 55, f: 1 }]);
    const r1 = new Reader(full); r1.readU8();
    const s1 = decodeSnapshot(r1, () => undefined)!;
    expect(s1.ents.size).toBe(3);
    expect(s1.ents.get(2)![F.HP]).toBe(800);
    expect(s1.match.zr).toBeCloseTo(29, 1);
    expect(s1.match.supplies[0].at).toBe(105);
    expect(s1.match.destroyed).toEqual([3, 9]);
    expect(s1.self.cds).toEqual([0, 30, 0, 90, 0]);
    expect(s1.self.x).toBeCloseTo(1.25);
    expect(s1.events[0].p).toBe(55);

    // 델타: 1번 이동, 2번 그대로, 150번 삭제, 300번 추가
    const cur = new Map<number, NetEnt>([[1, mk(1.5, 900)], [2, mk(5, 800)], [300, mk(-4, 50)]]);
    const delta = encodeSnapshot(101, 100, 6, matchBlock(), selfBlock(), cur, base, []);
    expect(delta.byteLength).toBeLessThan(full.byteLength);
    const r2 = new Reader(delta); r2.readU8();
    const s2 = decodeSnapshot(r2, t => (t === 100 ? s1.ents : undefined))!;
    expect([...s2.ents.keys()].sort((a, b) => a - b)).toEqual([1, 2, 300]);
    expect(s2.ents.get(1)![F.X]).toBe(qPos(1.5));
    expect(s2.ents.get(2)![F.HP]).toBe(800);
    expect(s2.removed).toEqual([150]);
    expect(s2.changed).not.toContain(2);
    // 기준 스냅샷이 없으면 null
    const r3 = new Reader(delta); r3.readU8();
    expect(decodeSnapshot(r3, () => undefined)).toBeNull();
  });

  it('호스트가 생성한 실제 스냅샷을 클라이언트가 해석하고 델타로 이어간다', () => {
    const m = new Match({ seed: 3, mode: 'br', players: Array.from({ length: 10 }, (_, i) => ({ pid: 'p' + i, name: 'P' + i, heroId: 'rail' as const, isBot: i > 0, botLevel: 1 })) });
    const host = new MatchHost(m);
    const got: Uint8Array[] = [];
    host.attach(1, d => got.push(d), () => {});
    const store = new Map<number, Map<number, NetEnt>>();
    let ack = 0;
    for (let t = 0; t < 400; t++) {
      host.step();
      const bytes = got.shift()!;
      const r = new Reader(bytes); expect(r.readU8()).toBe(Msg.Snapshot);
      const snap = decodeSnapshot(r, k => store.get(k));
      expect(snap).not.toBeNull();
      store.set(snap!.tick, snap!.ents);
      ack = snap!.tick;
      host.receiveBinary(1, encodeInputs(ack, [{ seq: t + 1, mx: 0, my: 0, ax: 0, ay: 0, held: 0, pressed: t === 5 ? Btn.Basic : 0, viewTick: ack }]));
    }
    expect(m.w.hero(1)!.state).not.toBe('drop');
  });
});

describe('지연 보상', () => {
  it('되감기 틱은 최대 150ms(4.5틱)로 제한된다', () => {
    expect(rewindTicks(100, 98)).toBe(2);
    expect(rewindTicks(100, 80)).toBe(4.5);
    expect(rewindTicks(100, 105)).toBe(0);
    expect(rewindTicks(100, NaN)).toBe(0);
  });

  it('이력 보간', () => {
    const h = new HistoryBuffer();
    h.record(10, [{ id: 1, x: 0, y: 0, ok: true }]);
    h.record(11, [{ id: 1, x: 3, y: 0, ok: true }]);
    expect(h.get(1, 10.5)!.x).toBeCloseTo(1.5);
    expect(h.get(1, 5)).toBeNull();
  });

  it('클라이언트 화면 기준으로 맞은 투사체는 대상이 이후 이동했어도 명중한다', () => {
    const run = (viewLag: number) => {
      const m = new Match({ seed: 11, mode: 'practice', players: [
        { pid: 'a', name: 'A', heroId: 'rail', isBot: false, botLevel: 1 },
        { pid: 'b', name: 'B', heroId: 'hammerdog', isBot: false, botLevel: 1, dummy: false },
      ] });
      const [a, b] = m.w.heroes;
      m.w.alive.fill(0); // 장애물 제거 (순수 판정 테스트)
      a.m.x = -20; a.m.y = -5; b.m.x = -14; b.m.y = -5;
      // 대상이 위로 이동하는 이력을 만든다
      for (let t = 0; t < 8; t++) {
        m.setInput(2, { seq: t, mx: 0, my: 1, ax: -14, ay: 10, held: 0, pressed: 0, viewTick: 0 });
        m.setInput(1, { seq: t, mx: 0, my: 0, ax: -14, ay: -5, held: 0, pressed: 0, viewTick: 0 });
        m.step();
      }
      const hp0 = b.hp;
      // 공격자는 과거(viewLag 틱 전) 화면 기준 대상 위치를 조준
      const vt = m.w.tick - viewLag;
      const past = m.w.history.get(2, vt)!;
      m.setInput(1, { seq: 99, mx: 0, my: 0, ax: past.x, ay: past.y, held: 1, pressed: 0, viewTick: vt });
      m.setInput(2, { seq: 99, mx: 0, my: 1, ax: -14, ay: 10, held: 0, pressed: 0, viewTick: 0 });
      for (let t = 0; t < 12; t++) { m.step(); m.setInput(1, { seq: 100 + t, mx: 0, my: 0, ax: past.x, ay: past.y, held: 0, pressed: 0, viewTick: m.w.tick + 1 - viewLag }); m.setInput(2, { seq: 100 + t, mx: 0, my: 1, ax: -14, ay: 10, held: 0, pressed: 0, viewTick: 0 }); }
      return hp0 - b.hp;
    };
    expect(run(4)).toBeGreaterThan(0);
    // 되감기 없이(지연 0) 과거 위치를 쏘면 빗나간다
    expect(run(0.0001)).toBe(0);
  });
});
