import { describe, it, expect } from 'vitest';
import { Match, makeZoneSchedule, zoneAt, ZONE_RULES, DROP_PHASE_SEC, canSeeHero, generateMap, raycast, resolveCircle, stepMove, newMoveState, Btn, MAP_RADIUS, outsideZone } from '../src/index';

describe('구역 축소', () => {
  const s = makeZoneSchedule(1234);
  it('처음엔 맵 전체, 60초 간격으로 줄어든다', () => {
    expect(zoneAt(s, 0).r).toBeCloseTo(MAP_RADIUS);
    const first = s.stages[0];
    expect(first.start).toBe(DROP_PHASE_SEC + 60);
    expect(s.stages[1].start - s.stages[0].start).toBe(60);
    expect(zoneAt(s, first.end + 1).r).toBeCloseTo(ZONE_RULES.radii[1]);
  });
  it('다음 구역은 20초 전에 표시된다', () => {
    const first = s.stages[0];
    expect(zoneAt(s, first.start - 21).showNext).toBe(false);
    expect(zoneAt(s, first.start - 19).showNext).toBe(true);
  });
  it('다음 구역은 항상 현재 구역 안에 있다', () => {
    for (const seed of [1, 2, 3, 99, 2048]) {
      const sc = makeZoneSchedule(seed);
      for (const st of sc.stages) expect(Math.hypot(st.x1 - st.x0, st.y1 - st.y0) + st.r1).toBeLessThanOrEqual(st.r0 + 1e-6);
    }
  });
  it('축소 중에는 반경이 단조 감소하고 피해는 단계마다 증가한다', () => {
    let prev = Infinity, prevDps = 0;
    for (let t = 0; t < 380; t += 0.5) {
      const z = zoneAt(s, t);
      expect(z.r).toBeLessThanOrEqual(prev + 1e-6);
      expect(z.dps).toBeGreaterThanOrEqual(prevDps - 1e-6);
      prev = z.r; prevDps = z.dps;
    }
  });
  it('마지막 1분은 구역이 계속 움직인다', () => {
    const a = zoneAt(s, ZONE_RULES.movingStart + 5), b = zoneAt(s, ZONE_RULES.movingStart + 20);
    expect(a.moving).toBe(true);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });
  it('밖에 있으면 피해 판정', () => {
    const z = zoneAt(s, 0);
    expect(outsideZone(z, 0, 0)).toBe(false);
    expect(outsideZone(z, 100, 0)).toBe(true);
  });
});

describe('충돌과 이동', () => {
  const map = generateMap(77);
  const alive = new Uint8Array(map.obstacles.length).fill(1);
  it('장애물 밖으로 밀어낸다', () => {
    const o = map.obstacles.find(o => o.shape === 'box')!;
    const r = resolveCircle(map, alive, o.x, o.y, 0.5);
    expect(r.hit).toBe(true);
    const inside = Math.abs(r.x - o.x) < o.hw + 0.49 && Math.abs(r.y - o.y) < o.hh + 0.49;
    expect(inside).toBe(false);
  });
  it('구르기는 쿨타임이 있다', () => {
    const ms = newMoveState(0, 4);
    const p = { speed: 5, canMove: true, canDodge: true, invert: false, radius: 0.5, dodgeCdTicks: 100, dodgeDistMult: 1 };
    const r1 = stepMove(ms, { mx: 1, my: 0, ax: 5, ay: 4, dodge: true }, p, map, alive);
    expect(r1.dodged).toBe(true);
    for (let i = 0; i < 10; i++) stepMove(ms, { mx: 1, my: 0, ax: 5, ay: 4, dodge: false }, p, map, alive);
    const r2 = stepMove(ms, { mx: 1, my: 0, ax: 5, ay: 4, dodge: true }, p, map, alive);
    expect(r2.dodged).toBe(false);
  });
  it('반전 상태에서는 반대로 움직인다', () => {
    const ms = newMoveState(0, 4);
    stepMove(ms, { mx: 1, my: 0, ax: 0, ay: 0, dodge: false }, { speed: 6, canMove: true, canDodge: true, invert: true, radius: 0.5, dodgeCdTicks: 100, dodgeDistMult: 1 }, map, alive);
    expect(ms.x).toBeLessThan(0);
  });
});

describe('시야 판정', () => {
  const setup = () => {
    const m = new Match({ seed: 5, mode: 'practice', players: [
      { pid: 'a', name: 'A', heroId: 'rail', isBot: false, botLevel: 1 },
      { pid: 'b', name: 'B', heroId: 'mirage', isBot: false, botLevel: 1 },
    ] });
    return { m, a: m.w.heroes[0], b: m.w.heroes[1] };
  };
  it('시야 거리 밖은 보이지 않는다', () => {
    const { m, a, b } = setup();
    a.m.x = 0; a.m.y = 3; b.m.x = 2; b.m.y = 3;
    expect(canSeeHero(m.w, a, b)).toBe(true);
    b.m.x = 30;
    expect(canSeeHero(m.w, a, b)).toBe(false);
  });
  it('시야 차단 장애물 뒤는 보이지 않는다', () => {
    const { m, a, b } = setup();
    const o = m.w.map.obstacles.find(o => o.kind === 'building')!;
    a.m.x = o.x - o.hw - 2; a.m.y = o.y; b.m.x = o.x + o.hw + 2; b.m.y = o.y;
    expect(raycast(m.w.map, m.w.alive, a.m.x, a.m.y, b.m.x, b.m.y, 'vision').ob).not.toBeNull();
    expect(canSeeHero(m.w, a, b)).toBe(false);
  });
  it('홀로그램 광고판(부시) 안은 밖에서 안 보이고, 같은 부시 안이나 근접 시 보인다', () => {
    const { m, a, b } = setup();
    const bush = m.w.map.bushes[0];
    b.m.x = bush.x; b.m.y = bush.y;
    a.m.x = bush.x - bush.hw - 4; a.m.y = bush.y;
    expect(canSeeHero(m.w, a, b)).toBe(false);
    a.m.x = bush.x - 0.8;
    expect(canSeeHero(m.w, a, b)).toBe(true);
  });
  it('은신은 근접하거나 노출되면 보인다', () => {
    const { m, a, b } = setup();
    a.m.x = 0; a.m.y = 3; b.m.x = 5; b.m.y = 3;
    b.st.stealthT = 50;
    expect(canSeeHero(m.w, a, b)).toBe(false);
    b.st.revealT = 10;
    expect(canSeeHero(m.w, a, b)).toBe(true);
  });
  it('봇 매치 진행: 낙하 → 전투 → 1명 남으면 종료', () => {
    const m = new Match({ seed: 9, mode: 'br', players: Array.from({ length: 10 }, (_, i) => ({ pid: 'b' + i, name: 'B' + i, heroId: 'hive' as const, isBot: true, botLevel: 2 })) });
    while (m.phase !== 'end' && m.w.tick < 30 * 480) m.step();
    expect(m.phase).toBe('end');
    const res = m.results();
    expect(res[0].placement).toBe(1);
    expect(new Set(res.map(r => r.placement)).size).toBe(10);
  });
});

describe('스킬 시전 규칙', () => {
  it('쿨타임 중에는 스킬이 나가지 않는다 (서버 검증)', () => {
    const m = new Match({ seed: 2, mode: 'practice', players: [{ pid: 'a', name: 'A', heroId: 'glitch', isBot: false, botLevel: 1 }] });
    const h = m.w.heroes[0];
    let casts = 0;
    for (let t = 0; t < 60; t++) {
      m.setInput(1, { seq: t, mx: 0, my: 0, ax: 5, ay: 5, held: 0, pressed: Btn.S1, viewTick: 0 });
      m.step();
      casts += m.w.events.filter(e => e.k === 5 && e.a === 1 && e.b === 1).length;
    }
    expect(casts).toBe(1);
    expect(h.cds[1]).toBeGreaterThan(0);
  });
  it('봉인 상태에서는 스킬을 쓸 수 없지만 기본 공격은 가능', () => {
    const m = new Match({ seed: 2, mode: 'practice', players: [{ pid: 'a', name: 'A', heroId: 'rail', isBot: false, botLevel: 1 }] });
    const h = m.w.heroes[0];
    h.st.silenceT = 100;
    m.setInput(1, { seq: 1, mx: 0, my: 0, ax: 5, ay: 5, held: Btn.Basic, pressed: Btn.S2, viewTick: 0 });
    m.step(); m.step(); m.step();
    expect(h.cds[2]).toBe(0);
    expect(m.w.projectiles.length + (h.cds[0] > 0 ? 1 : 0)).toBeGreaterThan(0);
  });
});
