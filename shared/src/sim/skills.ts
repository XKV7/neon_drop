import type { Action, AoeAction, BeamAction, BlinkAction, BombardAction, DashAction, DeployAction, Effect, Explode, ProjectileAction, SkillDef, StrikesAction, ZoneAction, AreaAllAction, PullAllAction, BuffAction } from '../data/types';
import { DT, TICK_RATE } from './constants';
import { clamp, dist, segDist2 } from './math';
import { bushAt, findFreeSpot, overlapsObstacle, raycast, resolveCircle } from './map';
import { ForcedKind } from './movement';
import { addShield, applyEffects, damageNeutral, damageObstacle, dealDamage, DmgKind, heal } from './combat';
import { ActionCtx, Fx, Hero, Projectile, SLOT_BTN, World } from './world';

export const FX_VISUALS = ['slam', 'emp', 'gravity', 'spin', 'web', 'hack', 'blackhole', 'bomb', 'override', 'cone', 'trap', 'turret', 'hammer', 'explode'] as const;
export const PROJ_VISUALS = ['bullet', 'shock', 'blade', 'shuriken', 'wire', 'rail', 'missile', 'bolt', 'code', 'orb', 'drone'] as const;
export const fxIndex = (v: string) => Math.max(0, (FX_VISUALS as readonly string[]).indexOf(v));
export const projIndex = (v: string) => Math.max(0, (PROJ_VISUALS as readonly string[]).indexOf(v));

const kindOf = (slot: number): DmgKind => (slot === 0 ? 'basic' : slot === 4 ? 'ult' : 'skill');

// ───────────────────────── 시전 ─────────────────────────

export function isBusy(h: Hero): boolean {
  return !!h.cast || !!h.charging || (h.m.ft > 0 && h.m.fkind !== ForcedKind.None) || !!h.dash;
}

export function slotReady(h: Hero, slot: number): boolean {
  if (slot === 4) return h.ult >= 1;
  return h.charges[slot] > 0;
}

export function canCastNow(h: Hero, slot: number): boolean {
  if (h.state !== 'play' || h.disconnected && !h.isBot) return false;
  if (h.st.stunT > 0) return false;
  if (slot > 0 && h.st.silenceT > 0) return false;
  if (!slotReady(h, slot)) return false;
  return !isBusy(h);
}

export function aimInfo(h: Hero, def: SkillDef, ax: number, ay: number) {
  let dx = ax - h.m.x, dy = ay - h.m.y;
  let d = Math.hypot(dx, dy);
  if (d < 0.05) { dx = Math.cos(h.facing); dy = Math.sin(h.facing); d = 0; } else { dx /= d; dy /= d; }
  let px = ax, py = ay;
  if (def.target === 'point') {
    const r = clamp(d, def.minRange ?? 0, def.range);
    px = h.m.x + dx * r; py = h.m.y + dy * r;
  }
  return { dx, dy, px, py, d };
}

export function findStrikeTarget(w: World, h: Hero, a: StrikesAction, ax: number, ay: number): Hero | null {
  let best: Hero | null = null, bestScore = Infinity;
  for (const e of w.heroes) {
    if (!w.targetable(e, h)) continue;
    const dh = dist(h.m.x, h.m.y, e.m.x, e.m.y);
    if (dh > a.range + 1) continue;
    const da = dist(ax, ay, e.m.x, e.m.y);
    const marked = e.st.markT > 0 && e.st.markBy === h.id;
    if (!marked && da > 3.5) continue;
    const score = (marked ? -100 : 0) + da;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

/** 입력 처리: 버튼 → 시전 시작 */
export function processCastInput(w: World, h: Hero) {
  if (h.state !== 'play') return;
  const inp = h.input;
  // 충전형 스킬
  if (h.charging) {
    const slot = h.charging.slot, def = h.skills[slot];
    h.charging.t++;
    const maxT = (def.chargeUp?.max ?? 1) * TICK_RATE;
    const held = (inp.held & SLOT_BTN[slot]) !== 0;
    if (!held || h.charging.t >= maxT + 0.6 * TICK_RATE || h.st.stunT > 0) {
      const mult = clamp(h.charging.t / maxT, 0, 1);
      h.charging = null;
      if (h.st.stunT <= 0 && !(slot > 0 && h.st.silenceT > 0)) {
        consumeSlot(w, h, slot);
        executeSkill(w, h, slot, inp.ax, inp.ay, mult, lagOf(w, h));
      }
    }
    return;
  }
  if (h.cast) {
    h.cast.t++;
    h.cast.ax = inp.ax; h.cast.ay = inp.ay;
    if (h.cast.t >= h.cast.total) {
      const c = h.cast;
      h.cast = null;
      executeSkill(w, h, c.slot, c.ax, c.ay, 1, lagOf(w, h));
    }
    return;
  }
  // 새 입력 (누름 우선, 막혔으면 짧게 버퍼)
  let want = -1;
  for (const s of [4, 3, 1, 2]) if (inp.pressed & SLOT_BTN[s]) { want = s; break; }
  if (want < 0 && h.queued && h.queued.t > 0) { want = h.queued.slot; }
  if (h.queued) { h.queued.t--; if (h.queued.t <= 0) h.queued = null; }
  if (want >= 0) {
    if (canCastNow(h, want)) { h.queued = null; startCast(w, h, want, inp.ax, inp.ay); return; }
    if (isBusy(h) && slotReady(h, want)) h.queued = { slot: want, t: 9 };
    return;
  }
  if ((inp.held & SLOT_BTN[0]) && canCastNow(h, 0)) startCast(w, h, 0, inp.ax, inp.ay);
}

function lagOf(w: World, h: Hero): number {
  if (h.isBot) return 0;
  const d = w.tick - h.input.viewTick;
  return h.input.viewTick > 0 ? clamp(d, 0, 4.5) : 0;
}

function consumeSlot(w: World, h: Hero, slot: number) {
  if (slot === 4) { h.ult = 0; return; }
  if (slot > 0 && h.stats.freeCast > 0 && w.rng.next() < h.stats.freeCast) return;
  h.charges[slot]--;
  if (h.cds[slot] <= 0) h.cds[slot] = h.maxCds[slot];
}

export function startCast(w: World, h: Hero, slot: number, ax: number, ay: number) {
  const def = h.skills[slot];
  const ai = aimInfo(h, def, ax, ay);
  if (def.needsTarget) {
    const a = def.actions.find(x => x.t === 'strikes') as StrikesAction | undefined;
    if (a && !findStrikeTarget(w, h, a, ai.px, ai.py)) return;
  }
  if (def.target !== 'self' && ai.d > 0) h.facing = Math.atan2(ai.dy, ai.dx);
  h.anim = slot + 1; h.animSeq = (h.animSeq + 1) & 255;
  if (slot > 0 && h.st.stealthT > 0 && !def.actions.some(a => a.t === 'buff' && (a as BuffAction).stealth)) breakStealth(w, h);
  if (def.chargeUp) { h.charging = { slot, t: 0 }; return; }
  consumeSlot(w, h, slot);
  if (slot === 4 && h.stats.ultReset > 0) for (let s = 1; s <= 3; s++) { h.charges[s] = h.chargeMax[s]; h.cds[s] = 0; }
  const total = Math.round(def.cast * TICK_RATE);
  // 위협 경고: 시전이 긴 스킬은 시전 중에도 바닥 경고를 보여준다
  if (slot > 0 && def.cast >= 0.15) warnIndicator(w, h, def, ai.px, ai.py, ai.dx, ai.dy, total);
  if (total <= 0) executeSkill(w, h, slot, ax, ay, 1, lagOf(w, h));
  else h.cast = { slot, t: 0, total, ax, ay };
}

function warnIndicator(w: World, h: Hero, def: SkillDef, px: number, py: number, dx: number, dy: number, ticks: number) {
  const ind = def.indicator;
  const ang = Math.atan2(dy, dx);
  if (ind.shape === 'circle') w.telegraphs.push({ id: w.allocId(), owner: h.id, shape: 0, x: px, y: py, r: ind.radius, ang, len: 0, w: 0, t: 0, delay: ticks, visual: 0, fire: () => {} });
  else if (ind.shape === 'self') w.telegraphs.push({ id: w.allocId(), owner: h.id, shape: 0, x: h.m.x, y: h.m.y, r: ind.radius, ang, len: 0, w: 0, t: 0, delay: ticks, visual: 0, fire: () => {} });
  else if (ind.shape === 'cone') w.telegraphs.push({ id: w.allocId(), owner: h.id, shape: 1, x: h.m.x, y: h.m.y, r: def.range, ang, len: (ind.angle * Math.PI) / 180, w: 0, t: 0, delay: ticks, visual: 0, fire: () => {} });
  else w.telegraphs.push({ id: w.allocId(), owner: h.id, shape: 2, x: h.m.x, y: h.m.y, r: 0, ang, len: def.range, w: ind.width, t: 0, delay: ticks, visual: 0, fire: () => {} });
}

export function breakStealth(w: World, h: Hero) {
  if (h.st.stealthT > 0) {
    h.st.stealthT = 0;
    h.stealthEndTick = w.tick;
    h.ambushUntil = w.tick + 45;
    w.ev(Fx.Stealth, h.id, 0, h.m.x, h.m.y, 0);
  }
}

export function executeSkill(w: World, h: Hero, slot: number, ax: number, ay: number, mult: number, lag: number) {
  if (h.state !== 'play') return;
  const skill = h.skills[slot];
  const ai = aimInfo(h, skill, ax, ay);
  if (skill.target !== 'self' && ai.d > 0) h.facing = Math.atan2(ai.dy, ai.dx);
  const ctx: ActionCtx = { hero: h, slot, ax: ai.px, ay: ai.py, dx: ai.dx, dy: ai.dy, mult, lag, skill };
  if (slot > 0 && slot < 4 || slot === 4) w.ev(Fx.Cast, h.id, slot, h.m.x, h.m.y, h.def.index);
  if (slot === 0) w.ev(Fx.Cast, h.id, 0, h.m.x, h.m.y, h.def.index);
  if (h.st.stealthT > 0 && !skill.actions.some(a => a.t === 'buff' && (a as BuffAction).stealth)) breakStealth(w, h);
  if (bushAt(w.map, h.m.x, h.m.y) >= 0) h.st.revealT = Math.max(h.st.revealT, 30);
  for (const a of skill.actions) runAction(w, ctx, a);
  if (slot === 3 && h.stats.dashEmpower > 0) h.empower = Math.max(h.empower, h.stats.dashEmpower);
  if (skill.repeat && skill.repeat.count > 1) {
    for (let i = 1; i < skill.repeat.count; i++) {
      w.after(skill.repeat.interval * i, () => {
        if (h.state !== 'play') return;
        h.anim = slot + 1; h.animSeq = (h.animSeq + 1) & 255;
        const c2: ActionCtx = { ...ctx, ax: skill.target === 'self' ? h.m.x : ctx.ax, ay: skill.target === 'self' ? h.m.y : ctx.ay, lag: 0 };
        for (const a of skill.actions) runAction(w, c2, a);
      });
    }
  }
}

export function runAction(w: World, c: ActionCtx, a: Action) {
  switch (a.t) {
    case 'projectile': return actProjectile(w, c, a);
    case 'melee': return actMelee(w, c, a);
    case 'dash': return actDash(w, c, a);
    case 'blink': return actBlink(w, c, a);
    case 'aoe': return actAoe(w, c, a);
    case 'zone': return actZone(w, c, a);
    case 'beam': return actBeam(w, c, a);
    case 'deploy': return actDeploy(w, c, a);
    case 'buff': return actBuff(w, c, a);
    case 'pullAll': return actPullAll(w, c, a);
    case 'strikes': return actStrikes(w, c, a);
    case 'bombard': return actBombard(w, c, a);
    case 'areaAll': return actAreaAll(w, c, a);
  }
}

// ───────────────────────── 투사체 ─────────────────────────

function actProjectile(w: World, c: ActionCtx, a: ProjectileAction) {
  const h = c.hero;
  const count = a.count ?? 1;
  const spread = ((a.spread ?? 0) * Math.PI) / 180;
  const base = Math.atan2(c.dy, c.dx);
  let dmg = a.dmg, range = a.range;
  if (a.chargeScale) {
    dmg = a.chargeScale.dmg[0] + (a.chargeScale.dmg[1] - a.chargeScale.dmg[0]) * c.mult;
    range = a.chargeScale.range[0] + (a.chargeScale.range[1] - a.chargeScale.range[0]) * c.mult;
  }
  const full = c.mult >= 0.97;
  for (let i = 0; i < count; i++) {
    const ang = count > 1 ? base - spread / 2 + (spread * i) / (count - 1) : base;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const p: Projectile = {
      id: w.allocId(), owner: h.id, x: h.m.x + dx * 0.5, y: h.m.y + dy * 0.5, dx, dy,
      speed: a.speed * (1 + h.stats.proj), radius: a.radius, rangeLeft: range * (1 + h.stats.proj), dmg, pierce: a.pierce ?? 0, hit: [],
      act: a, onHit: a.onHit ?? [], explode: a.explode ?? null,
      bounce: (a.bounce ?? 0) + (full ? a.bounceOnFull ?? 0 : 0), returning: false, returns: !!a.returns, chainLeft: a.chain?.count ?? 0,
      visual: a.visual, slot: c.slot, neutral: false, turret: false, lagTicks: c.lag, full, skillName: c.skill.name,
    };
    w.projectiles.push(p);
    // 지연 보상: 클라이언트가 보던 과거 시점부터 현재까지 따라잡기
    if (c.lag > 0) {
      let remaining = c.lag, t = w.tick - c.lag;
      while (remaining > 1e-3 && p.rangeLeft > 0) {
        const step = Math.min(1, remaining);
        t += step;
        if (!stepProjectile(w, p, step, t)) break;
        remaining -= step;
      }
    }
  }
}

export function spawnSimpleProjectile(w: World, owner: number, x: number, y: number, dx: number, dy: number, speed: number, range: number, radius: number, dmg: number, visual: Projectile['visual'], opts: Partial<Projectile> = {}) {
  w.projectiles.push({
    id: w.allocId(), owner, x, y, dx, dy, speed, radius, rangeLeft: range, dmg, pierce: 0, hit: [], act: null, onHit: [], explode: null,
    bounce: 0, returning: false, returns: false, chainLeft: 0, visual, slot: 1, neutral: false, turret: false, lagTicks: 0, full: false, skillName: '', ...opts,
  });
}

/** 투사체 한 스텝. histTick이 있으면 영웅 위치를 그 시점으로 되감아 판정. false = 소멸 */
export function stepProjectile(w: World, p: Projectile, ticks: number, histTick: number | null): boolean {
  const owner = w.hero(p.owner);
  if (p.returning) {
    if (!owner || owner.state !== 'play') return false;
    const dx = owner.m.x - p.x, dy = owner.m.y - p.y; const d = Math.hypot(dx, dy);
    if (d < 0.9) return false;
    p.dx = dx / d; p.dy = dy / d;
  }
  let move = p.speed * DT * ticks;
  if (!p.returning) move = Math.min(move, p.rangeLeft);
  const ax = p.x, ay = p.y, bx = p.x + p.dx * move, by = p.y + p.dy * move;

  // 장애물
  const ray = raycast(w.map, w.alive, ax, ay, bx, by, 'all', p.radius * 0.4);
  const obT = ray.ob ? ray.t : 2;

  // 영웅 (가장 가까운 순서)
  const hits: { t: number; id: number; kind: 0 | 1 }[] = [];
  const L2 = move * move;
  for (const h of w.heroes) {
    if (h.state !== 'play' || p.hit.includes(h.id)) continue;
    if (!p.neutral && h.id === p.owner) continue;
    if (h.st.untargetT > 0) continue;
    if (h.st.dodgeFrames > 0) continue;
    if (h.m.fkind === ForcedKind.Jump || h.m.fkind === ForcedKind.Leap) continue;
    let hx = h.m.x, hy = h.m.y;
    if (histTick !== null) { const hp = w.history.get(h.id, histTick); if (hp && hp.ok) { hx = hp.x; hy = hp.y; } }
    const rr = p.radius + h.radius;
    if (segDist2(hx, hy, ax, ay, bx, by) <= rr * rr) {
      const t = L2 > 0 ? clamp(((hx - ax) * (bx - ax) + (hy - ay) * (by - ay)) / L2, 0, 1) : 0;
      hits.push({ t, id: h.id, kind: 0 });
    }
  }
  if (!p.neutral) for (const n of w.neutrals) {
    if (!n.alive || p.hit.includes(n.id)) continue;
    const rr = p.radius + 0.6;
    if (segDist2(n.x, n.y, ax, ay, bx, by) <= rr * rr) {
      const t = L2 > 0 ? clamp(((n.x - ax) * (bx - ax) + (n.y - ay) * (by - ay)) / L2, 0, 1) : 0;
      hits.push({ t, id: n.id, kind: 1 });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  for (const hit of hits) {
    if (hit.t > obT) break;
    p.hit.push(hit.id);
    const hx = ax + (bx - ax) * hit.t, hy = ay + (by - ay) * hit.t;
    if (hit.kind === 0) {
      const t = w.hero(hit.id)!;
      if (p.neutral) dealDamage(w, null, t, p.dmg, { kind: 'neutral', skillName: '보안 드론' });
      else {
        const src = owner ?? null;
        if (p.dmg > 0) dealDamage(w, src, t, p.dmg, { kind: p.turret ? 'skill' : kindOf(p.slot), skillName: p.skillName });
        applyEffects(w, src, t, p.onHit, hx - p.dx * 2, hy - p.dy * 2, p.dx, p.dy);
        if (p.chainLeft > 0 && p.act?.chain) chainFrom(w, p, t);
      }
    } else {
      const n = w.neutrals.find(n => n.id === hit.id)!;
      if (p.dmg > 0) damageNeutral(w, owner ?? null, n, p.dmg);
    }
    w.ev(Fx.ProjHit, hit.id, PROJ_VISUALS.indexOf(p.visual as never), hx, hy);
    if (p.explode) { explodeAt(w, owner ?? null, hx, hy, p.explode, p.slot, p.skillName); return false; }
    if (p.pierce <= 0) { p.x = hx; p.y = hy; return false; }
    p.pierce--;
  }

  if (ray.ob) {
    const hx = ax + (bx - ax) * ray.t, hy = ay + (by - ay) * ray.t;
    if (ray.ob.destructible && !p.neutral) damageObstacle(w, ray.ob.id, p.dmg + (p.explode?.dmg ?? 0));
    if (p.bounce > 0) {
      p.bounce--;
      const dot = p.dx * ray.nx + p.dy * ray.ny;
      p.dx -= 2 * dot * ray.nx; p.dy -= 2 * dot * ray.ny;
      p.x = hx + ray.nx * 0.05; p.y = hy + ray.ny * 0.05;
      p.rangeLeft -= move * ray.t;
      p.hit = [];
      w.ev(Fx.Spark, 0, 0, hx, hy);
      return true;
    }
    if (p.explode) { explodeAt(w, owner ?? null, hx, hy, p.explode, p.slot, p.skillName); return false; }
    if (p.returns && !p.returning) { p.returning = true; p.hit = []; p.x = hx; p.y = hy; return true; }
    w.ev(Fx.Spark, 0, PROJ_VISUALS.indexOf(p.visual as never), hx, hy);
    return false;
  }
  p.x = bx; p.y = by;
  if (!p.returning) {
    p.rangeLeft -= move;
    if (p.rangeLeft <= 1e-3) {
      if (p.explode) { explodeAt(w, owner ?? null, p.x, p.y, p.explode, p.slot, p.skillName); return false; }
      if (p.returns) { p.returning = true; p.hit = []; return true; }
      return false;
    }
  }
  return true;
}

function chainFrom(w: World, p: Projectile, from: Hero) {
  const ch = p.act!.chain!;
  const owner = w.hero(p.owner);
  let best: Hero | null = null, bd = ch.range;
  for (const e of w.heroes) {
    if (e.id === from.id || p.hit.includes(e.id) || !w.targetable(e, owner ?? null)) continue;
    const d = dist(from.m.x, from.m.y, e.m.x, e.m.y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const dx = (best.m.x - from.m.x) / bd, dy = (best.m.y - from.m.y) / bd;
  spawnSimpleProjectile(w, p.owner, from.m.x, from.m.y, dx, dy, p.speed, ch.range + 1, p.radius, p.dmg * ch.dmgMult, p.visual, {
    onHit: p.onHit, slot: p.slot, hit: [from.id, ...p.hit], chainLeft: p.chainLeft - 1, act: p.act, skillName: p.skillName,
  });
  p.chainLeft = 0;
}

export function explodeAt(w: World, src: Hero | null, x: number, y: number, e: Explode, slot: number, skillName: string, visual = 13) {
  w.ev(Fx.Explode, src ? src.id : 0, visual, x, y, Math.round(e.radius * 10));
  for (const t of w.enemiesInRadius(src, x, y, e.radius)) {
    if (e.dmg > 0) dealDamage(w, src, t, e.dmg, { kind: kindOf(slot), skillName });
    applyEffects(w, src, t, e.onHit, x, y);
  }
  hitWorldInRadius(w, src, x, y, e.radius, e.dmg);
}

/** 범위 안 중립 드론과 파괴 가능한 장애물 */
export function hitWorldInRadius(w: World, src: Hero | null, x: number, y: number, r: number, dmg: number) {
  if (dmg <= 0) return;
  for (const n of w.neutrals) if (n.alive && dist(n.x, n.y, x, y) <= r + 0.6) damageNeutral(w, src, n, dmg);
  for (const o of w.map.obstacles) {
    if (!o.destructible || !w.alive[o.id]) continue;
    const cx = clamp(x, o.x - o.hw, o.x + o.hw), cy = clamp(y, o.y - o.hh, o.y + o.hh);
    if (dist(cx, cy, x, y) <= r) damageObstacle(w, o.id, dmg);
  }
}

export function updateProjectiles(w: World) {
  const out: Projectile[] = [];
  // 지연 보상: 발사자의 화면 시점(최대 150ms 과거)의 대상 위치로 계속 판정
  for (const p of w.projectiles) if (stepProjectile(w, p, 1, p.lagTicks > 0 ? w.tick - p.lagTicks : null)) out.push(p);
  w.projectiles = out;
}

// ───────────────────────── 근접 ─────────────────────────

function heroPosAt(w: World, h: Hero, lag: number) {
  if (lag > 0) { const p = w.history.get(h.id, w.tick - lag); if (p && p.ok) return p; }
  return { x: h.m.x, y: h.m.y };
}

function actMelee(w: World, c: ActionCtx, a: { range: number; angle: number; dmg: number; onHit?: Effect[] }) {
  const h = c.hero;
  const half = ((a.angle / 2) * Math.PI) / 180;
  const fa = Math.atan2(c.dy, c.dx);
  let any = false;
  for (const t of w.heroes) {
    if (!w.targetable(t, h)) continue;
    const p = heroPosAt(w, t, c.lag);
    const dx = p.x - h.m.x, dy = p.y - h.m.y;
    const d = Math.hypot(dx, dy);
    if (d > a.range + t.radius) continue;
    if (d > 0.6) {
      let da = Math.atan2(dy, dx) - fa;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const angTol = Math.atan2(t.radius, d);
      if (Math.abs(da) > half + angTol) continue;
      if (raycast(w.map, w.alive, h.m.x, h.m.y, p.x, p.y, 'all').ob) continue;
    }
    any = true;
    dealDamage(w, h, t, a.dmg, { kind: kindOf(c.slot), skillName: c.skill.name });
    applyEffects(w, h, t, a.onHit, h.m.x, h.m.y, c.dx, c.dy);
    w.ev(Fx.Spark, t.id, 1, t.m.x, t.m.y);
  }
  for (const n of w.neutrals) {
    if (!n.alive) continue;
    const dx = n.x - h.m.x, dy = n.y - h.m.y, d = Math.hypot(dx, dy);
    if (d > a.range + 0.6) continue;
    let da = Math.atan2(dy, dx) - fa;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > half + 0.3 && d > 0.8) continue;
    damageNeutral(w, h, n, a.dmg); any = true;
  }
  const tipX = h.m.x + c.dx * a.range * 0.7, tipY = h.m.y + c.dy * a.range * 0.7;
  for (const o of w.map.obstacles) {
    if (!o.destructible || !w.alive[o.id]) continue;
    const cx = clamp(tipX, o.x - o.hw, o.x + o.hw), cy = clamp(tipY, o.y - o.hh, o.y + o.hh);
    if (dist(cx, cy, tipX, tipY) < a.range * 0.5) damageObstacle(w, o.id, a.dmg);
  }
  return any;
}

// ───────────────────────── 이동기 ─────────────────────────

function actDash(w: World, c: ActionCtx, a: DashAction) {
  const h = c.hero;
  let dx = c.dx, dy = c.dy;
  if (a.backward) { dx = -dx; dy = -dy; }
  let d = a.dist;
  let cling = false;
  if (a.toPoint) d = Math.min(a.dist, dist(h.m.x, h.m.y, c.ax, c.ay));
  if (a.wire) {
    const r = raycast(w.map, w.alive, h.m.x, h.m.y, h.m.x + dx * a.wire.range, h.m.y + dy * a.wire.range, 'all');
    if (r.ob) { d = Math.max(0.5, r.t * a.wire.range - h.radius - 0.15); cling = true; }
    else d = a.wire.shortDist;
    w.ev(Fx.Wire, h.id, cling ? 1 : 0, h.m.x + dx * (d + h.radius), h.m.y + dy * (d + h.radius));
  }
  const speed = a.speed;
  const ticks = Math.max(1, Math.round((d / speed) * TICK_RATE));
  const sp = d / (ticks * DT);
  h.m.fvx = dx * sp; h.m.fvy = dy * sp; h.m.ft = ticks; h.m.ft0 = ticks;
  h.m.fkind = a.airborne ? ForcedKind.Leap : ForcedKind.Dash;
  h.facing = Math.atan2(c.dy, c.dx);
  h.dash = { act: a, hit: [], slot: c.slot, endAoe: !!a.endAoe, wireCling: cling };
  if (a.untargetable || a.airborne) h.st.untargetT = Math.max(h.st.untargetT, ticks + 2);
  if (a.haste) h.st.hastes.push({ pct: a.haste.pct, t: a.haste.dur * TICK_RATE });
  if (a.empower) h.empower = Math.max(h.empower, a.empower);
  if (cling && a.wire) h.empower = Math.max(h.empower, a.wire.clingBonus);
}

export function updateDashes(w: World) {
  for (const h of w.heroes) {
    const ds = h.dash;
    if (!ds) continue;
    if (h.state !== 'play') { h.dash = null; continue; }
    if (h.m.ft > 0 && h.m.fkind !== ForcedKind.Dash && h.m.fkind !== ForcedKind.Leap) { h.dash = null; continue; }
    const a = ds.act;
    if (h.m.ft > 0 && a.hitRadius) {
      for (const t of w.enemiesInRadius(h, h.m.x, h.m.y, a.hitRadius)) {
        if (ds.hit.includes(t.id)) continue;
        ds.hit.push(t.id);
        if (a.dmg) dealDamage(w, h, t, a.dmg, { kind: kindOf(ds.slot), skillName: h.skills[ds.slot].name });
        const dl = Math.hypot(h.m.fvx, h.m.fvy) || 1;
        applyEffects(w, h, t, a.onHit, h.m.x, h.m.y, h.m.fvx / dl, h.m.fvy / dl);
        w.ev(Fx.Spark, t.id, 2, t.m.x, t.m.y);
        if (a.stopOnHit) {
          w.ev(Fx.Grab, h.id, t.id, t.m.x, t.m.y);
          h.m.ft = 0; h.m.fvx = 0; h.m.fvy = 0; h.m.fkind = 0;
          break;
        }
      }
      for (const n of w.neutrals) if (n.alive && !ds.hit.includes(n.id) && dist(n.x, n.y, h.m.x, h.m.y) < a.hitRadius + 0.6) { ds.hit.push(n.id); if (a.dmg) damageNeutral(w, h, n, a.dmg); }
    }
    if (h.m.ft <= 0) {
      if (a.endAoe) explodeAt(w, h, h.m.x, h.m.y, a.endAoe, ds.slot, h.skills[ds.slot].name, 2);
      if (a.endShield) addShield(w, h, a.endShield, 3);
      if (ds.wireCling) w.ev(Fx.Wire, h.id, 2, h.m.x, h.m.y);
      h.dash = null;
      h.st.untargetT = Math.min(h.st.untargetT, 1);
    }
  }
}

function actBlink(w: World, c: ActionCtx, a: BlinkAction) {
  const h = c.hero;
  const sx = h.m.x, sy = h.m.y;
  const want = c.skill.target === 'point' ? Math.min(a.dist, dist(sx, sy, c.ax, c.ay)) : a.dist;
  let ex = sx + c.dx * want, ey = sy + c.dy * want;
  // 착지 가능한 지점까지 뒤로
  let back = 0;
  while (overlapsObstacle(w.map, w.alive, ex, ey, h.radius) && back < want) { back += 0.25; ex = sx + c.dx * (want - back); ey = sy + c.dy * (want - back); }
  if (overlapsObstacle(w.map, w.alive, ex, ey, h.radius)) { ex = sx; ey = sy; }
  h.m.x = ex; h.m.y = ey; h.m.ft = 0; h.m.fkind = 0; h.m.fvx = 0; h.m.fvy = 0;
  w.ev(Fx.Blink, h.id, 0, sx, sy, Math.round(Math.atan2(c.dy, c.dx) * 1000) & 0xffff);
  if (a.trail) {
    const ww = a.trail.width / 2;
    for (const t of w.heroes) {
      if (!w.targetable(t, h)) continue;
      const rr = ww + t.radius;
      if (segDist2(t.m.x, t.m.y, sx, sy, ex, ey) <= rr * rr) {
        dealDamage(w, h, t, a.trail.dmg, { kind: kindOf(c.slot), skillName: c.skill.name });
        applyEffects(w, h, t, a.trail.onHit, sx, sy, c.dx, c.dy);
        w.ev(Fx.Spark, t.id, 1, t.m.x, t.m.y);
      }
    }
    for (const n of w.neutrals) if (n.alive && segDist2(n.x, n.y, sx, sy, ex, ey) <= (ww + 0.6) ** 2) damageNeutral(w, h, n, a.trail.dmg);
  }
}

// ───────────────────────── 범위 ─────────────────────────

function inCone(cx: number, cy: number, fa: number, half: number, x: number, y: number, r: number) {
  const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
  if (d < 0.8) return true;
  let da = Math.atan2(dy, dx) - fa;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return Math.abs(da) <= half + Math.atan2(r, d);
}

function actAoe(w: World, c: ActionCtx, a: AoeAction) {
  const h = c.hero;
  const cx = a.at === 'self' ? h.m.x : c.ax, cy = a.at === 'self' ? h.m.y : c.ay;
  const fa = Math.atan2(c.dy, c.dx);
  const fire = () => {
    if (h.state === 'dead' && a.at === 'self') return;
    const x = a.at === 'self' && a.delay > 0 ? h.m.x : cx, y = a.at === 'self' && a.delay > 0 ? h.m.y : cy;
    w.ev(Fx.Explode, h.id, fxIndex(a.visual), x, y, Math.round(a.radius * 10), a.cone ? Math.round(((fa + Math.PI) / (Math.PI * 2)) * 255) : 0);
    for (const t of w.enemiesInRadius(h, x, y, a.radius)) {
      if (a.cone && !inCone(x, y, fa, ((a.cone / 2) * Math.PI) / 180, t.m.x, t.m.y, t.radius)) continue;
      if (a.dmg > 0) dealDamage(w, h, t, a.dmg, { kind: kindOf(c.slot), skillName: c.skill.name });
      applyEffects(w, h, t, a.onHit, x, y, c.dx, c.dy);
    }
    hitWorldInRadius(w, h, x, y, a.radius, a.dmg);
  };
  if (a.delay > 0) {
    w.telegraphs.push({ id: w.allocId(), owner: h.id, shape: a.cone ? 1 : 0, x: cx, y: cy, r: a.radius, ang: fa, len: a.cone ? (a.cone * Math.PI) / 180 : 0, w: 0, t: 0, delay: Math.round(a.delay * TICK_RATE), visual: fxIndex(a.visual), fire });
  } else fire();
}

function actZone(w: World, c: ActionCtx, a: ZoneAction) {
  const h = c.hero;
  const x = a.at === 'self' ? h.m.x : c.ax, y = a.at === 'self' ? h.m.y : c.ay;
  w.zones.push({
    id: w.allocId(), owner: h.id, x, y, r: a.radius, t: 0, dur: Math.round(a.duration * TICK_RATE), interval: Math.max(1, Math.round(a.interval * TICK_RATE)),
    act: a, slot: c.slot, started: !a.delay, delay: Math.round((a.delay ?? 0) * TICK_RATE), skillName: c.skill.name,
  });
}

export function updateZones(w: World) {
  const keep = [];
  for (const z of w.zones) {
    const owner = w.hero(z.owner) ?? null;
    const a = z.act;
    if (a.follow) {
      if (!owner || owner.state !== 'play') continue;
      z.x = owner.m.x; z.y = owner.m.y;
    }
    if (!z.started) {
      z.delay--;
      if (z.delay <= 0) {
        z.started = true;
        for (const t of w.enemiesInRadius(owner, z.x, z.y, z.r)) applyEffects(w, owner, t, a.startEffects, z.x, z.y);
        w.ev(Fx.Explode, z.owner, fxIndex(a.visual), z.x, z.y, Math.round(z.r * 10), 1);
      }
      keep.push(z);
      continue;
    }
    z.t++;
    if (a.pull) {
      for (const t of w.enemiesInRadius(owner, z.x, z.y, z.r)) {
        if (t.m.fkind === ForcedKind.Jump || t.m.fkind === ForcedKind.Leap) continue;
        const dx = z.x - t.m.x, dy = z.y - t.m.y, d = Math.hypot(dx, dy);
        if (d < 0.3) continue;
        const step = Math.min(d, a.pull * DT * (1.3 - 0.5 * (d / z.r)));
        const r = resolveCircle(w.map, w.alive, t.m.x + (dx / d) * step, t.m.y + (dy / d) * step, t.radius);
        t.m.x = r.x; t.m.y = r.y;
      }
    }
    if (a.selfHaste && owner && owner.state === 'play' && dist(owner.m.x, owner.m.y, z.x, z.y) <= z.r) {
      owner.st.hastes = owner.st.hastes.filter(x => x.pct !== a.selfHaste || x.t > 6);
      owner.st.hastes.push({ pct: a.selfHaste, t: 6 });
    }
    if (z.t % z.interval === 0) {
      for (const t of w.enemiesInRadius(owner, z.x, z.y, z.r)) {
        const dmg = a.dmg > 0 ? dealDamage(w, owner, t, a.dmg, { kind: kindOf(z.slot), skillName: z.skillName }) : 0;
        applyEffects(w, owner, t, a.onTick, z.x, z.y);
        if (a.lifesteal && owner && dmg > 0) heal(w, owner, dmg * a.lifesteal);
      }
      hitWorldInRadius(w, owner, z.x, z.y, z.r, a.dmg);
    }
    if (z.t >= z.dur) {
      if (a.endExplode) {
        const e = a.endExplode;
        if (e.pullIn) for (const t of w.enemiesInRadius(owner, z.x, z.y, e.radius)) applyEffects(w, owner, t, [{ t: 'pull', dist: e.pullIn }], z.x, z.y);
        explodeAt(w, owner, z.x, z.y, e, z.slot, z.skillName, fxIndex(a.visual));
      }
      continue;
    }
    keep.push(z);
  }
  w.zones = keep;
}

function actBeam(w: World, c: ActionCtx, a: BeamAction) {
  const h = c.hero;
  const count = a.count ?? 1;
  const make = (ox: number, oy: number, dx: number, dy: number) => {
    const ang = Math.atan2(dy, dx);
    w.telegraphs.push({
      id: w.allocId(), owner: h.id, shape: 2, x: ox, y: oy, r: 0, ang, len: a.length, w: a.width, t: 0, delay: Math.round(a.delay * TICK_RATE), visual: 1,
      fire: () => {
        if (h.state !== 'play') return;
        // 벽은 관통하되 파괴 가능 장애물은 부순다
        const ex = ox + dx * a.length, ey = oy + dy * a.length;
        w.ev(Fx.Beam, h.id, 0, ox, oy, Math.round(a.length * 10), Math.round(((ang + Math.PI) / (Math.PI * 2)) * 255));
        for (const t of w.heroes) {
          if (!w.targetable(t, h)) continue;
          const rr = a.width / 2 + t.radius;
          if (segDist2(t.m.x, t.m.y, ox, oy, ex, ey) <= rr * rr) {
            dealDamage(w, h, t, a.dmg, { kind: kindOf(c.slot), skillName: c.skill.name });
            applyEffects(w, h, t, a.onHit, ox, oy, dx, dy);
          }
        }
        for (const n of w.neutrals) if (n.alive && segDist2(n.x, n.y, ox, oy, ex, ey) <= (a.width / 2 + 0.6) ** 2) damageNeutral(w, h, n, a.dmg);
        for (const o of w.map.obstacles) {
          if (!o.destructible || !w.alive[o.id]) continue;
          if (segDist2(o.x, o.y, ox, oy, ex, ey) <= (a.width / 2 + Math.max(o.hw, o.hh)) ** 2) damageObstacle(w, o.id, a.dmg);
        }
      },
    });
  };
  make(h.m.x, h.m.y, c.dx, c.dy);
  for (let i = 1; i < count; i++) {
    w.after((a.interval ?? 0.7) * i, () => {
      if (h.state !== 'play') return;
      const ax = h.input.ax - h.m.x, ay = h.input.ay - h.m.y, l = Math.hypot(ax, ay);
      const dx = l > 0.1 ? ax / l : Math.cos(h.facing), dy = l > 0.1 ? ay / l : Math.sin(h.facing);
      h.facing = Math.atan2(dy, dx); h.anim = 5; h.animSeq = (h.animSeq + 1) & 255;
      make(h.m.x, h.m.y, dx, dy);
    });
  }
}

function actDeploy(w: World, c: ActionCtx, a: DeployAction) {
  const h = c.hero;
  const mine = w.deployables.filter(d => d.owner === h.id && d.slot === c.slot);
  while (mine.length >= a.max) {
    const old = mine.shift()!;
    w.deployables = w.deployables.filter(d => d !== old);
  }
  const spot = a.kind === 'turret' ? findFreeSpot(w.map, w.alive, c.ax, c.ay, 0.4) : { x: c.ax, y: c.ay };
  w.deployables.push({
    id: w.allocId(), owner: h.id, kind: a.kind, x: spot.x, y: spot.y, t: 0, dur: Math.round(a.duration * TICK_RATE), act: a,
    nextShot: w.tick + 10, armed: a.kind === 'turret', slot: c.slot, facing: h.facing,
  });
}

export function updateDeployables(w: World) {
  const keep = [];
  for (const d of w.deployables) {
    d.t++;
    const owner = w.hero(d.owner);
    if (!owner || owner.state === 'dead' || d.t >= d.dur) continue;
    const a = d.act;
    if (d.kind === 'trap') {
      if (!d.armed && d.t >= (a.arm ?? 0.5) * TICK_RATE) d.armed = true;
      if (d.armed) {
        let fired = false;
        for (const t of w.enemiesInRadius(owner, d.x, d.y, a.range)) {
          if (t.m.fkind === ForcedKind.Jump || t.m.fkind === ForcedKind.Leap) continue;
          dealDamage(w, owner, t, a.dmg, { kind: 'skill', skillName: owner.skills[d.slot].name });
          applyEffects(w, owner, t, a.onHit, d.x, d.y);
          fired = true;
        }
        if (fired) { w.ev(Fx.Trap, d.owner, 0, d.x, d.y); continue; }
      }
    } else if (w.tick >= d.nextShot) {
      let best: Hero | null = null, bd = a.range;
      for (const t of w.heroes) {
        if (!w.targetable(t, owner)) continue;
        if (t.st.stealthT > 0 && t.st.revealT <= 0) continue;
        const dd = dist(d.x, d.y, t.m.x, t.m.y);
        if (dd > bd) continue;
        if (raycast(w.map, w.alive, d.x, d.y, t.m.x, t.m.y, 'all').ob) continue;
        bd = dd; best = t;
      }
      if (best) {
        const sp = a.projSpeed ?? 20;
        const prev = w.history.get(best.id, w.tick - 3);
        let vx = 0, vy = 0;
        if (prev && prev.ok) { vx = (best.m.x - prev.x) / (3 * DT); vy = (best.m.y - prev.y) / (3 * DT); }
        const tt = bd / sp;
        const tx = best.m.x + vx * tt * 0.7, ty = best.m.y + vy * tt * 0.7;
        const dx = tx - d.x, dy = ty - d.y, l = Math.hypot(dx, dy) || 1;
        d.facing = Math.atan2(dy, dx);
        spawnSimpleProjectile(w, owner.id, d.x + (dx / l) * 0.4, d.y + (dy / l) * 0.4, dx / l, dy / l, sp, a.range + 2, 0.35, a.dmg, 'drone', { turret: true, slot: d.slot, onHit: a.onHit ?? [], skillName: owner.skills[d.slot].name });
        d.nextShot = w.tick + Math.max(3, Math.round((a.interval ?? 0.6) * TICK_RATE));
      } else d.nextShot = w.tick + 4;
    }
    keep.push(d);
  }
  w.deployables = keep;
}

function actBuff(w: World, c: ActionCtx, a: BuffAction) {
  const h = c.hero;
  if (a.stealth) { h.st.stealthT = a.stealth * TICK_RATE; h.ambush = a.ambush ?? 0; h.ambushUntil = w.tick + a.stealth * TICK_RATE + 45; w.ev(Fx.Stealth, h.id, 1, h.m.x, h.m.y); }
  if (a.haste) h.st.hastes.push({ pct: a.haste.pct, t: a.haste.dur * TICK_RATE });
  if (a.shield) addShield(w, h, a.shield.amt, a.shield.dur);
}

function actPullAll(w: World, c: ActionCtx, a: PullAllAction) {
  const h = c.hero;
  w.ev(Fx.Explode, h.id, fxIndex('blackhole'), h.m.x, h.m.y, Math.round(a.radius * 10), 2);
  for (const t of w.enemiesInRadius(h, h.m.x, h.m.y, a.radius)) {
    const d = dist(h.m.x, h.m.y, t.m.x, t.m.y);
    applyEffects(w, h, t, [{ t: 'pull', dist: Math.max(0, d - a.to + 1.3) }], h.m.x, h.m.y);
  }
}

function actStrikes(w: World, c: ActionCtx, a: StrikesAction) {
  const h = c.hero;
  const target = findStrikeTarget(w, h, a, c.ax, c.ay);
  if (!target) return;
  const total = a.count * a.interval + 0.25;
  h.st.untargetT = Math.max(h.st.untargetT, Math.round(total * TICK_RATE));
  h.st.rootT = Math.max(h.st.rootT, Math.round(total * TICK_RATE));
  for (let i = 0; i < a.count; i++) {
    w.after(0.05 + a.interval * i, () => {
      if (h.state !== 'play' || target.state !== 'play') return;
      const ang = (i * 2.399) + w.rng.range(-0.3, 0.3);
      const spot = findFreeSpot(w.map, w.alive, target.m.x + Math.cos(ang) * 1.3, target.m.y + Math.sin(ang) * 1.3, h.radius, 2);
      const sx = h.m.x, sy = h.m.y;
      h.m.x = spot.x; h.m.y = spot.y; h.m.ft = 0; h.m.fkind = 0;
      h.facing = Math.atan2(target.m.y - h.m.y, target.m.x - h.m.x);
      h.anim = 5; h.animSeq = (h.animSeq + 1) & 255;
      w.ev(Fx.Strike, h.id, target.id, sx, sy);
      dealDamage(w, h, target, a.dmg, { kind: 'ult', skillName: c.skill.name });
      applyEffects(w, h, target, a.onHit, h.m.x, h.m.y);
    });
  }
}

function actBombard(w: World, c: ActionCtx, a: BombardAction) {
  const h = c.hero;
  const cx = c.ax, cy = c.ay;
  w.telegraphs.push({ id: w.allocId(), owner: h.id, shape: 0, x: cx, y: cy, r: a.radius, ang: 0, len: 0, w: 0, t: 0, delay: Math.round((a.delay + a.interval * a.count) * TICK_RATE), visual: 2, fire: () => {} });
  for (let i = 0; i < a.count; i++) {
    w.after(a.interval * i + 0.01, () => {
      const ang = w.rng.range(0, Math.PI * 2), r = Math.sqrt(w.rng.next()) * (a.radius - a.bombRadius * 0.4);
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      w.telegraphs.push({
        id: w.allocId(), owner: h.id, shape: 0, x, y, r: a.bombRadius, ang: 0, len: 0, w: 0, t: 0, delay: Math.round(a.delay * TICK_RATE), visual: 3,
        fire: () => explodeAt(w, h.state === 'dead' ? null : h, x, y, { radius: a.bombRadius, dmg: a.dmg, onHit: a.onHit }, 4, c.skill.name, fxIndex('bomb')),
      });
    });
  }
}

function actAreaAll(w: World, c: ActionCtx, a: AreaAllAction) {
  const h = c.hero;
  w.ev(Fx.Explode, h.id, fxIndex(a.visual), h.m.x, h.m.y, Math.round(a.radius * 10));
  for (const t of w.enemiesInRadius(h, h.m.x, h.m.y, a.radius)) {
    if (a.dmg > 0) dealDamage(w, h, t, a.dmg, { kind: kindOf(c.slot), skillName: c.skill.name });
    applyEffects(w, h, t, a.onHit, h.m.x, h.m.y);
  }
  hitWorldInRadius(w, h, h.m.x, h.m.y, a.radius, a.dmg);
}

export function updateTelegraphs(w: World) {
  const keep = [];
  for (const t of w.telegraphs) {
    t.t++;
    if (t.t >= t.delay) { t.fire(); continue; }
    keep.push(t);
  }
  w.telegraphs = keep;
}

export function updateCooldowns(h: Hero) {
  for (let s = 0; s < 4; s++) {
    if (h.charges[s] < h.chargeMax[s]) {
      if (h.cds[s] > 0) h.cds[s]--;
      if (h.cds[s] <= 0) {
        h.charges[s]++;
        h.cds[s] = h.charges[s] < h.chargeMax[s] ? h.maxCds[s] : 0;
      }
    } else h.cds[s] = 0;
  }
}
