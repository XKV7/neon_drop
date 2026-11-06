import { LEVEL_DMG_BONUS, LEVEL_HP_BONUS, XP_REWARD, XP_TABLE, ULT_TAKEN_RATIO } from '../data/heroes';
import type { Effect } from '../data/types';
import { AUGMENT_PICK_SEC, ASSIST_WINDOW_SEC, HERO_RADIUS, KILL_HEAL_PCT, MAX_LEVEL, TICK_RATE } from './constants';
import { compileSkills, computeStats, rollAugmentOptions } from './augmentLogic';
import { ForcedKind } from './movement';
import { Fx, Hero, Neutral, World } from './world';
import { HERO_BY_ID } from '../data/heroes';
import type { Tier } from '../data/types';
import { DEFAULT_COSMETIC } from '../data/cosmetics';

export type DmgKind = 'basic' | 'skill' | 'ult' | 'zone' | 'dot' | 'neutral' | 'reflect' | 'passive' | 'storm';

export interface DmgOpts { kind: DmgKind; skillName?: string }

export const DMG_FLAG_BIG = 1, DMG_FLAG_SHIELD = 2, DMG_FLAG_DOT = 4, DMG_FLAG_ZONE = 8;

export function heroDmgMult(h: Hero): number {
  let rage = 0;
  for (const b of h.st.dmgBuffs) rage += b.pct;
  return 1 + h.stats.dmg + (h.level - 1) * LEVEL_DMG_BONUS + rage;
}

/** 피해 계산 (순수 계산부, 테스트용으로 분리) */
export function computeDamage(base: number, srcMult: number, armor: number, bonus: number): number {
  return Math.max(0, base * srcMult * (1 + bonus) * (1 - Math.min(0.75, armor)));
}

export function heal(w: World, h: Hero, amt: number, overheal = false) {
  if (h.state === 'dead' || amt <= 0) return;
  const before = h.hp;
  h.hp = Math.min(h.maxHp, h.hp + amt);
  const over = amt - (h.hp - before);
  if (overheal && over > 0) { h.shield = Math.min(h.maxHp * 0.5, h.shield + over); h.shieldT = Math.max(h.shieldT, 90); }
  if (amt >= 8) w.ev(Fx.Heal, h.id, 0, h.m.x, h.m.y, Math.round(amt));
}

export function addShield(w: World, h: Hero, amt: number, durSec: number) {
  h.shield += amt;
  h.shieldT = Math.max(h.shieldT, Math.round(durSec * TICK_RATE));
  w.ev(Fx.Shield, h.id, 0, h.m.x, h.m.y, Math.round(amt));
}

export function dealDamage(w: World, src: Hero | null, t: Hero, base: number, o: DmgOpts): number {
  if (t.state !== 'play' || base <= 0) return 0;
  if (t.st.invulnT > 0) return 0;
  if (t.st.dodgeFrames > 0 && o.kind !== 'zone' && o.kind !== 'dot') return 0;
  if (t.st.untargetT > 0 && o.kind !== 'zone') return 0;
  if (src && src.id === t.id) return 0;
  let mult = 1, bonus = 0;
  const isAttack = o.kind === 'basic' || o.kind === 'skill' || o.kind === 'ult';
  if (src) {
    mult = heroDmgMult(src);
    if (src.stats.execute > 0 && t.hp < t.maxHp * 0.3) bonus += src.stats.execute;
    if (isAttack) {
      if (src.stats.opener > 0 && w.tick - src.lastDealtTick > 150) bonus += src.stats.opener;
      if (src.ambush > 0 && w.tick <= src.ambushUntil) { bonus += src.ambush; src.ambush = 0; }
      if (t.st.markT > 0 && t.st.markBy === src.id) bonus += 0.12;
    }
    if (o.kind === 'basic' && src.empower > 0) { bonus += src.empower; src.empower = 0; }
  }
  if (o.kind === 'dot' || o.kind === 'zone' || o.kind === 'reflect') { mult = 1; }
  let amount = computeDamage(base, mult, t.stats.armor, bonus);
  amount = Math.round(amount);
  if (amount <= 0) return 0;

  let absorbed = 0;
  if (t.shield > 0) { absorbed = Math.min(t.shield, amount); t.shield -= absorbed; }
  const rest = amount - absorbed;
  t.hp -= rest;
  t.damageTaken += amount;
  t.lastDamagedTick = w.tick;
  t.ult = Math.min(1, t.ult + (amount * ULT_TAKEN_RATIO * (1 + t.stats.ult)) / t.def.ultReq);
  if (src) {
    src.damageDealt += amount;
    if (isAttack) src.lastDealtTick = w.tick;
    src.ult = Math.min(1, src.ult + (amount * (1 + src.stats.ult)) / src.def.ultReq);
    t.lastHitBy = src.id; t.lastHitTick = w.tick;
    if (o.skillName) t.killSkill = o.skillName;
  } else if (o.kind === 'zone') {
    if (w.tick - t.lastHitTick > ASSIST_WINDOW_SEC * TICK_RATE) t.lastHitBy = 0;
    t.killSkill = '데이터 붕괴';
  }
  let flags = 0;
  if (amount >= 150) flags |= DMG_FLAG_BIG;
  if (rest === 0) flags |= DMG_FLAG_SHIELD;
  if (o.kind === 'dot') flags |= DMG_FLAG_DOT;
  if (o.kind === 'zone') flags |= DMG_FLAG_ZONE;
  w.ev(Fx.Dmg, t.id, src ? src.id : 0, t.m.x, t.m.y, amount, flags);

  // 생존 패시브
  if (t.stats.rage > 0) {
    if (t.st.dmgBuffs.length >= 5) t.st.dmgBuffs.shift();
    t.st.dmgBuffs.push({ pct: t.stats.rage, t: 90 });
  }
  if (t.stats.lowShield > 0 && t.hp > 0 && t.hp < t.maxHp * 0.3 && w.tick >= t.lowShieldReady) {
    addShield(w, t, t.maxHp * t.stats.lowShield, 4);
    t.lowShieldReady = w.tick + 20 * TICK_RATE;
  }
  if (src && t.stats.reflect > 0 && o.kind !== 'reflect' && o.kind !== 'dot') {
    dealDamage(w, t, src, amount * t.stats.reflect, { kind: 'reflect', skillName: '가시 장갑' });
  }
  if (src) {
    if (src.stats.lifesteal > 0 && o.kind !== 'reflect') heal(w, src, amount * src.stats.lifesteal, src.stats.overheal > 0);
    if (o.kind === 'skill' || o.kind === 'ult') {
      if (src.stats.burn > 0) { t.st.dots = t.st.dots.filter(d => d.src !== src.id); t.st.dots.push({ dps: src.stats.burn, t: 90, src: src.id }); }
      if (src.stats.skillSlow > 0) t.st.slows.push({ pct: src.stats.skillSlow, t: 30 });
      if (src.stats.skillRefund > 0) for (let s = 1; s <= 3; s++) if (src.cds[s] > 0) src.cds[s] = Math.max(1, src.cds[s] - src.stats.skillRefund * TICK_RATE);
    }
    if (o.kind === 'basic' && src.lastBasicTick !== w.tick) {
      src.lastBasicTick = w.tick;
      src.basicCount++;
      if (src.stats.thirdBolt > 0 && src.basicCount % 3 === 0) {
        const near = w.enemiesInRadius(src, t.m.x, t.m.y, 6).sort((a, b) => ((a.m.x - t.m.x) ** 2 + (a.m.y - t.m.y) ** 2) - ((b.m.x - t.m.x) ** 2 + (b.m.y - t.m.y) ** 2)).slice(0, 2);
        for (const n of near) { w.ev(Fx.Bolt, src.id, n.id, n.m.x, n.m.y); dealDamage(w, src, n, src.stats.thirdBolt, { kind: 'passive', skillName: '삼연 번개' }); }
      }
    }
  }

  if (t.hp <= 0) {
    if (t.stats.undying > 0 && !t.undyingUsed) {
      t.undyingUsed = true;
      t.hp = t.maxHp * 0.3;
      t.st.invulnT = 2 * TICK_RATE;
      w.ev(Fx.Revive, t.id, 0, t.m.x, t.m.y);
    } else {
      t.hp = 0;
      killHero(w, t, src);
    }
  }
  return amount;
}

export function cancelActions(h: Hero) {
  h.cast = null; h.charging = null; h.channel = null; h.queued = null;
}

export function applyEffects(w: World, src: Hero | null, t: Hero, effects: Effect[] | undefined, ox: number, oy: number, dirx = 0, diry = 0) {
  if (!effects || t.state !== 'play') return;
  if (t.st.invulnT > 0 || t.st.untargetT > 0) return;
  for (const e of effects) {
    switch (e.t) {
      case 'stun': t.st.stunT = Math.max(t.st.stunT, e.dur * TICK_RATE); cancelActions(t); break;
      case 'slow': t.st.slows.push({ pct: e.pct, t: e.dur * TICK_RATE }); break;
      case 'root': t.st.rootT = Math.max(t.st.rootT, e.dur * TICK_RATE); break;
      case 'silence': t.st.silenceT = Math.max(t.st.silenceT, e.dur * TICK_RATE); if (t.charging) t.charging = null; if (t.cast && t.cast.slot > 0) t.cast = null; break;
      case 'invert': t.st.invertT = Math.max(t.st.invertT, e.dur * TICK_RATE); break;
      case 'mark': if (src) { t.st.markT = e.dur * TICK_RATE; t.st.markBy = src.id; } break;
      case 'dot': t.st.dots.push({ dps: e.dps, t: e.dur * TICK_RATE, src: src ? src.id : 0 }); break;
      case 'reveal': t.st.revealT = Math.max(t.st.revealT, e.dur * TICK_RATE); break;
      case 'knock': {
        let kx = t.m.x - ox, ky = t.m.y - oy;
        if (e.from === 'side') {
          // 진행 방향의 수직 방향, 대상이 있는 쪽으로
          const cross = dirx * (t.m.y - oy) - diry * (t.m.x - ox);
          kx = cross >= 0 ? -diry : diry; ky = cross >= 0 ? dirx : -dirx;
        } else if (Math.abs(kx) + Math.abs(ky) < 1e-3) { kx = dirx || 1; ky = diry; }
        const l = Math.hypot(kx, ky) || 1;
        const speed = 15;
        const ticks = Math.max(2, Math.round((e.dist / speed) * TICK_RATE));
        t.m.fvx = (kx / l) * speed; t.m.fvy = (ky / l) * speed; t.m.ft = ticks; t.m.ft0 = ticks; t.m.fkind = ForcedKind.Knock;
        t.knockStun = e.wallStun ? e.wallStun * TICK_RATE : 0;
        t.dash = null; cancelActions(t);
        break;
      }
      case 'pull': {
        const dx = ox - t.m.x, dy = oy - t.m.y;
        const d = Math.hypot(dx, dy);
        const go = Math.min(e.dist, d - 1.3);
        if (go <= 0.1) break;
        const speed = 18;
        const ticks = Math.max(2, Math.round((go / speed) * TICK_RATE));
        t.m.fvx = (dx / d) * (go / (ticks / TICK_RATE)); t.m.fvy = (dy / d) * (go / (ticks / TICK_RATE));
        t.m.ft = ticks; t.m.ft0 = ticks; t.m.fkind = ForcedKind.Pull; t.dash = null; cancelActions(t);
        break;
      }
    }
  }
}

export function damageNeutral(w: World, src: Hero | null, n: Neutral, amt: number) {
  if (!n.alive) return;
  const dmg = Math.round(amt * (src ? heroDmgMult(src) : 1));
  n.hp -= dmg;
  if (src) { n.aggro = src.id; n.lastHitBy = src.id; }
  w.ev(Fx.Dmg, n.id, src ? src.id : 0, n.x, n.y, dmg, 0);
  if (n.hp <= 0) {
    n.alive = false; n.respawnAt = w.tick + 45 * TICK_RATE;
    w.ev(Fx.Death, n.id, src ? src.id : 0, n.x, n.y, 0, 1);
    const killer = src ?? w.hero(n.lastHitBy);
    if (killer && killer.state === 'play') { gainXp(w, killer, XP_REWARD.drone); heal(w, killer, killer.maxHp * 0.1); }
  }
}

export function damageObstacle(w: World, id: number, amt: number) {
  const o = w.map.obstacles[id];
  if (!o.destructible || !w.alive[id]) return;
  w.obHp[id] -= amt;
  if (w.obHp[id] <= 0) {
    w.alive[id] = 0;
    w.destroyed.push(id);
    w.ev(Fx.Destroy, id, 0, o.x, o.y, Math.round(o.hw * 10));
  }
}

export function aliveCount(w: World) { let n = 0; for (const h of w.heroes) if (h.state !== 'dead') n++; return n; }

export function killHero(w: World, v: Hero, src: Hero | null) {
  if (v.state === 'dead') return;
  const before = aliveCount(w);
  v.state = 'dead'; v.deathTick = w.tick; v.placement = before;
  cancelActions(v); v.dash = null; v.shield = 0;
  let killer: Hero | null = src;
  if (!killer && v.lastHitBy && w.tick - v.lastHitTick <= ASSIST_WINDOW_SEC * TICK_RATE) killer = w.hero(v.lastHitBy) ?? null;
  if (killer && killer.id === v.id) killer = null;
  v.killer = killer ? killer.id : 0;
  w.ev(Fx.Death, v.id, killer ? killer.id : 0, v.m.x, v.m.y, killer ? killer.cos.kill : 0, 0);
  // 설치물 정리
  w.deployables = w.deployables.filter(d => d.owner !== v.id);
  // 데이터 코어 드롭
  for (let i = 0; i < 3; i++) {
    const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(0.6, 1.8);
    w.pickups.push({ id: w.allocId(), kind: 'core', x: v.m.x + Math.cos(a) * r, y: v.m.y + Math.sin(a) * r, xp: 20 + v.level * 5, used: false, t: 0 });
  }
  const skill = v.killSkill || '처치';
  w.msgs.push({ to: 'all', type: 'feed', killer: killer ? killer.name : '데이터 붕괴', victim: v.name, skill: killer ? skill : '데이터 붕괴', killerHero: killer ? killer.heroId : '', victimHero: v.heroId });
  w.msgs.push({ to: v.id, type: 'eliminated', placement: v.placement, killer: v.killer });

  if (killer && killer.state === 'play') {
    killer.kills++;
    killer.streak++;
    killer.killTimes.push(w.tick);
    killer.killTimes = killer.killTimes.filter(t => w.tick - t <= 8 * TICK_RATE);
    gainXp(w, killer, XP_REWARD.kill + XP_REWARD.killPerLevel * v.level);
    heal(w, killer, killer.maxHp * (KILL_HEAL_PCT + killer.stats.killHeal), killer.stats.overheal > 0);
    if (killer.stats.killHaste > 0) killer.st.hastes.push({ pct: killer.stats.killHaste, t: 4 * TICK_RATE });
    if (killer.stats.stealthReset > 0 && (killer.st.stealthT > 0 || w.tick - killer.stealthEndTick <= 45)) {
      for (let s = 1; s <= 3; s++) { killer.charges[s] = killer.chargeMax[s]; killer.cds[s] = 0; }
    }
    if (killer.stats.killBlast > 0) {
      w.ev(Fx.Explode, killer.id, 9, v.m.x, v.m.y, 45);
      for (const e of w.enemiesInRadius(killer, v.m.x, v.m.y, 4.5)) dealDamage(w, killer, e, killer.stats.killBlast, { kind: 'passive', skillName: '연쇄 폭발' });
    }
    const totalKills = w.heroes.reduce((s, h) => s + h.kills, 0);
    if (totalKills === 1) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name} — 선취점!`, tone: 'first' });
    const multi = killer.killTimes.length;
    if (multi === 2) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name} 더블 킬!`, tone: 'multi' });
    else if (multi === 3) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name} 트리플 킬!`, tone: 'multi' });
    else if (multi >= 4) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name} 생중계 학살!!`, tone: 'multi' });
    else if (killer.streak === 3) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name} 폭주 중!`, tone: 'streak' });
    else if (killer.streak === 5) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name} 시청률 폭발! 5연속 처치`, tone: 'streak' });
  }
  const remain = before - 1;
  if (remain === 3) w.msgs.push({ to: 'all', type: 'announce', text: '최후의 3인!', tone: 'final' });
  else if (remain === 2) w.msgs.push({ to: 'all', type: 'announce', text: '최후의 결투!', tone: 'final' });
  if (v.streak >= 3 && killer) w.msgs.push({ to: 'all', type: 'announce', text: `${killer.name}이(가) ${v.name}의 폭주를 저지!`, tone: 'shutdown' });
}

export function xpForNext(level: number): number { return level >= MAX_LEVEL ? XP_TABLE[MAX_LEVEL - 1] : XP_TABLE[level]; }

export function gainXp(w: World, h: Hero, amount: number) {
  if (h.state === 'dead' || h.level >= MAX_LEVEL) return;
  h.xp += amount * (1 + h.stats.xp);
  while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level]) {
    h.level++;
    recomputeHero(h);
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.12);
    w.ev(Fx.LevelUp, h.id, h.level, h.m.x, h.m.y);
    offerAugment(w, h, 'level');
  }
  if (h.level >= MAX_LEVEL) h.xp = XP_TABLE[MAX_LEVEL - 1];
}

export function offerAugment(w: World, h: Hero, source: 'level' | 'supply', tier?: Tier) {
  const exclude = h.pending.flatMap(p => p.options);
  const options = rollAugmentOptions(w.rng, h.heroId, h.level, h.augments, tier, exclude);
  if (options.length === 0) return;
  h.pending.push({ options, deadline: w.tick + AUGMENT_PICK_SEC * TICK_RATE, source });
  if (h.pending.length === 1) sendOffer(w, h);
}

export function sendOffer(w: World, h: Hero) {
  const p = h.pending[0];
  if (!p) return;
  p.deadline = w.tick + AUGMENT_PICK_SEC * TICK_RATE;
  w.msgs.push({ to: h.id, type: 'augOffer', options: p.options, source: p.source, deadline: p.deadline, queue: h.pending.length });
}

export function chooseAugment(w: World, h: Hero, idx: number): boolean {
  const p = h.pending[0];
  if (!p || h.state === 'dead') return false;
  const id = p.options[Math.max(0, Math.min(p.options.length - 1, idx | 0))];
  h.pending.shift();
  if (!h.augments.includes(id)) {
    h.augments.push(id);
    recomputeHero(h);
    w.msgs.push({ to: h.id, type: 'augGained', id });
  }
  if (h.pending.length > 0) sendOffer(w, h);
  return true;
}

export function recomputeHero(h: Hero) {
  const oldMax = h.maxHp;
  h.stats = computeStats(h.augments);
  h.maxHp = Math.round(h.def.hp * (1 + (h.level - 1) * LEVEL_HP_BONUS) * (1 + h.stats.hp));
  if (oldMax > 0 && h.maxHp > oldMax) h.hp += h.maxHp - oldMax;
  h.hp = Math.min(h.hp, h.maxHp);
  h.radius = HERO_RADIUS * (1 + h.stats.size);
  h.skills = compileSkills(h.def, h.augments);
  for (let s = 0; s < 5; s++) {
    const def = h.skills[s];
    const cm = def.charges ?? 1;
    if (cm > h.chargeMax[s]) h.charges[s] += cm - h.chargeMax[s];
    h.chargeMax[s] = cm;
    h.charges[s] = Math.min(h.charges[s], cm);
    h.maxCds[s] = s === 0 ? Math.round((def.cd / (1 + h.stats.atkSpeed)) * TICK_RATE) : Math.round(def.cd * (1 - h.stats.cdr) * TICK_RATE);
  }
}

export function createHero(w: World, id: number, opts: { pid: string; name: string; heroId: string; isBot: boolean; botLevel: number; cos?: typeof DEFAULT_COSMETIC; dummy?: boolean }): Hero {
  const def = HERO_BY_ID[opts.heroId as keyof typeof HERO_BY_ID] ?? HERO_BY_ID.hammerdog;
  const h: Hero = {
    id, pid: opts.pid, name: opts.name, heroId: def.id, def, isBot: opts.isBot, botLevel: opts.botLevel, dummy: !!opts.dummy,
    cos: opts.cos ?? { ...DEFAULT_COSMETIC },
    m: { x: 0, y: 0, fvx: 0, fvy: 0, ft: 0, ft0: 0, fkind: 0, dodgeCd: 0, gateCd: 0, padCd: 0 }, facing: 0, radius: HERO_RADIUS,
    hp: def.hp, maxHp: 0, shield: 0, shieldT: 0,
    state: 'drop', landT: 0, dropX: 0, dropY: 0,
    level: 1, xp: 0,
    cds: [0, 0, 0, 0, 0], maxCds: [0, 0, 0, 0, 0], charges: [1, 1, 1, 1, 1], chargeMax: [1, 1, 1, 1, 1], ult: 0,
    skills: [], stats: computeStats([]), augments: [], pending: [],
    st: { stunT: 0, rootT: 0, silenceT: 0, invertT: 0, slows: [], hastes: [], stealthT: 0, untargetT: 0, invulnT: 0, markT: 0, markBy: 0, revealT: 0, dots: [], dodgeFrames: 0, dmgBuffs: [] },
    cast: null, charging: null, channel: null,
    input: { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, held: 0, pressed: 0, viewTick: 0 }, lastSeq: 0,
    anim: 0, animSeq: 0, dash: null,
    basicCount: 0, lastDealtTick: -1000, lastDamagedTick: -1000, lowShieldReady: 0, undyingUsed: false,
    empower: 0, ambush: 0, stealthEndTick: -1000, autoBoltTick: 0,
    kills: 0, damageDealt: 0, damageTaken: 0, deathTick: 0, placement: 0, killer: 0,
    lastHitBy: 0, lastHitTick: -1000, killTimes: [], streak: 0, killSkill: '',
    disconnected: false, dcTick: 0, emoteT: 0, spawnTick: 0,
    knockStun: 0, lastBasicTick: -1, queued: null, ambushUntil: 0, stealthSlot: -1, dodgeHits: [],
  };
  recomputeHero(h);
  h.hp = h.maxHp;
  return h;
}
