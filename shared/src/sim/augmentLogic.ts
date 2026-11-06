import { AUGMENTS, AUGMENT_BY_ID, BASE_STATS, STAT_CAPS, TIER_ODDS, HERO_AUG_CHANCE } from '../data/augments';
import type { AugmentDef, HeroDef, HeroId, Patch, SkillDef, Stats, Tier } from '../data/types';
import { Rng } from './math';

export function computeStats(augs: string[]): Stats {
  const s: Stats = { ...BASE_STATS };
  for (const id of augs) {
    const a = AUGMENT_BY_ID[id];
    if (!a?.stats) continue;
    for (const k of Object.keys(a.stats) as (keyof Stats)[]) s[k] += a.stats[k] ?? 0;
  }
  for (const k of Object.keys(STAT_CAPS) as (keyof Stats)[]) s[k] = Math.min(s[k], STAT_CAPS[k]!);
  return s;
}

export function applyPatch(root: unknown, p: Pick<Patch, 'path' | 'op' | 'value'>) {
  const parts = p.path.split('.');
  let obj = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (obj[k] === undefined || obj[k] === null) obj[k] = {};
    obj = obj[k] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  const cur = obj[last];
  switch (p.op) {
    case 'set': obj[last] = structuredClone(p.value); break;
    case 'add': obj[last] = ((cur as number) ?? 0) + (p.value as number); break;
    case 'mul': obj[last] = ((cur as number) ?? 0) * (p.value as number); break;
    case 'push': { const arr = (Array.isArray(cur) ? cur : []) as unknown[]; arr.push(structuredClone(p.value)); obj[last] = arr; break; }
  }
}

/** 영웅 기본 스킬 + 증강 패치 = 이 플레이어 전용 스킬 정의 */
export function compileSkills(def: HeroDef, augs: string[]): SkillDef[] {
  const skills: SkillDef[] = [def.basic, ...def.skills, def.ult].map(s => structuredClone(s));
  for (const id of augs) {
    const a = AUGMENT_BY_ID[id];
    if (!a?.patches) continue;
    for (const p of a.patches) applyPatch(skills[p.skill], p);
  }
  return skills;
}

export function augmentPool(heroId: HeroId): AugmentDef[] {
  return AUGMENTS.filter(a => !a.hero || a.hero === heroId);
}

function rollTier(rng: Rng, level: number): Tier {
  const odds = TIER_ODDS[Math.min(TIER_ODDS.length - 1, Math.max(0, level))];
  const r = rng.next();
  if (r < odds[0]) return 'silver';
  if (r < odds[0] + odds[1]) return 'gold';
  return 'prism';
}

/** 증강 선택지 3개 (중복 없음, 보유 증강 제외). forceTier가 있으면 해당 등급만 */
export function rollAugmentOptions(rng: Rng, heroId: HeroId, level: number, owned: string[], forceTier?: Tier, exclude: string[] = []): string[] {
  const pool = augmentPool(heroId).filter(a => !owned.includes(a.id) && !exclude.includes(a.id));
  const out: string[] = [];
  for (let k = 0; k < 3 && pool.length > 0; k++) {
    const tier = forceTier ?? rollTier(rng, level);
    let cands = pool.filter(a => a.tier === tier && !out.includes(a.id));
    if (cands.length === 0) cands = pool.filter(a => !out.includes(a.id));
    if (cands.length === 0) break;
    const heroCands = cands.filter(a => a.hero);
    const pick = heroCands.length > 0 && rng.next() < HERO_AUG_CHANCE ? rng.pick(heroCands) : rng.pick(cands.filter(a => !a.hero).length ? cands.filter(a => !a.hero) : cands);
    out.push(pick.id);
  }
  return out;
}
