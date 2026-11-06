import { describe, it, expect } from 'vitest';
import { Match, computeDamage, dealDamage, computeStats, compileSkills, HERO_BY_ID, chooseAugment, offerAugment, rollAugmentOptions, Rng, AUGMENT_BY_ID, LEVEL_DMG_BONUS, heroDmgMult } from '../src/index';

function duel(a = 'hammerdog', b = 'rail') {
  const m = new Match({ seed: 1, mode: 'practice', players: [
    { pid: 'a', name: 'A', heroId: a as never, isBot: false, botLevel: 1 },
    { pid: 'b', name: 'B', heroId: b as never, isBot: false, botLevel: 1 },
  ] });
  const [ha, hb] = m.w.heroes;
  ha.m.x = 0; ha.m.y = 3; hb.m.x = 2; hb.m.y = 3;
  return { m, ha, hb };
}

describe('피해 계산', () => {
  it('공식: 기본 × 공격 배율 × (1+보너스) × (1-방어)', () => {
    expect(computeDamage(100, 1, 0, 0)).toBe(100);
    expect(computeDamage(100, 1.2, 0, 0)).toBeCloseTo(120);
    expect(computeDamage(100, 1, 0.25, 0)).toBeCloseTo(75);
    expect(computeDamage(100, 1.1, 0.1, 0.5)).toBeCloseTo(100 * 1.1 * 1.5 * 0.9);
    expect(computeDamage(100, 1, 0.99, 0)).toBeCloseTo(25); // 방어 최대 75%
  });

  it('보호막이 먼저 흡수한다', () => {
    const { m, ha, hb } = duel();
    hb.shield = 30; hb.shieldT = 100;
    const hp0 = hb.hp;
    const dealt = dealDamage(m.w, ha, hb, 100, { kind: 'skill' });
    expect(dealt).toBe(100);
    expect(hb.shield).toBe(0);
    expect(hb.hp).toBe(hp0 - 70);
  });

  it('레벨이 오르면 피해 배율이 증가한다', () => {
    const { ha } = duel();
    const base = heroDmgMult(ha);
    ha.level = 5;
    expect(heroDmgMult(ha)).toBeCloseTo(base + 4 * LEVEL_DMG_BONUS);
  });

  it('구르기 무적 프레임 중에는 공격 피해를 받지 않지만 구역 피해는 받는다', () => {
    const { m, ha, hb } = duel();
    hb.st.dodgeFrames = 5;
    expect(dealDamage(m.w, ha, hb, 100, { kind: 'basic' })).toBe(0);
    expect(dealDamage(m.w, null, hb, 50, { kind: 'zone' })).toBe(50);
  });

  it('치명상 시 처치되고 처치자는 경험치와 회복을 얻는다', () => {
    const { m, ha, hb } = duel();
    ha.hp = ha.maxHp * 0.5;
    const xp0 = ha.xp;
    dealDamage(m.w, ha, hb, hb.hp + 500, { kind: 'ult', skillName: '테스트' });
    expect(hb.state).toBe('dead');
    expect(ha.kills).toBe(1);
    expect(ha.xp).toBeGreaterThan(xp0);
    expect(ha.hp).toBeGreaterThan(ha.maxHp * 0.5);
    expect(m.w.msgs.some(x => x.type === 'feed')).toBe(true);
  });
});

describe('증강', () => {
  it('스탯 증강은 합산되고 상한이 적용된다', () => {
    const s = computeStats(['servo', 'overdrive']);
    expect(s.dmg).toBeCloseTo(0.28);
    const capped = computeStats(['overclock', 'overdrive', 'quantum']);
    expect(capped.cdr).toBeLessThanOrEqual(0.45);
  });

  it('영웅 전용 증강이 스킬 정의를 변형한다 (원본 데이터는 불변)', () => {
    const def = HERO_BY_ID.mirage;
    const sk = compileSkills(def, ['mr_a2']);
    const a = sk[1].actions[0] as { count?: number };
    expect(a.count).toBe(3);
    expect((def.skills[0].actions[0] as { count?: number }).count).toBeUndefined();
    const hd = compileSkills(HERO_BY_ID.hammerdog, ['hd_a3']);
    expect(hd[4].actions.length).toBe(3);
  });

  it('선택지는 중복 없고 보유 증강과 다른 영웅 전용 증강을 제외한다', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const owned = ['servo', 'nanoarmor'];
      const opts = rollAugmentOptions(rng, 'rail', 1 + (i % 8), owned);
      expect(new Set(opts).size).toBe(opts.length);
      for (const o of opts) {
        expect(owned).not.toContain(o);
        const d = AUGMENT_BY_ID[o];
        expect(!d.hero || d.hero === 'rail').toBe(true);
      }
    }
  });

  it('프리즘 강제 선택지는 모두 프리즘', () => {
    const rng = new Rng(7);
    const opts = rollAugmentOptions(rng, 'glitch', 3, [], 'prism');
    expect(opts.every(o => AUGMENT_BY_ID[o].tier === 'prism')).toBe(true);
  });

  it('선택 시 적용되고 최대 체력이 증가한다', () => {
    const { m, ha } = duel();
    offerAugment(m.w, ha, 'level');
    ha.pending[0].options = ['nanoarmor', 'servo', 'overclock'];
    const before = ha.maxHp;
    expect(chooseAugment(m.w, ha, 0)).toBe(true);
    expect(ha.augments).toContain('nanoarmor');
    expect(ha.maxHp).toBeGreaterThan(before);
    expect(ha.pending.length).toBe(0);
  });

  it('쿨타임 감소가 컴파일된 쿨타임에 반영된다', () => {
    const { m, ha } = duel();
    const cd0 = ha.maxCds[1];
    offerAugment(m.w, ha, 'level');
    ha.pending[0].options = ['overclock', 'servo', 'nanoarmor'];
    chooseAugment(m.w, ha, 0);
    expect(ha.maxCds[1]).toBeLessThan(cd0);
  });
});
