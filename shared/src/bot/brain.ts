import { AUGMENT_BY_ID } from '../data/augments';
import type { DashAction, SkillDef, Tier } from '../data/types';
import { DT, MAP_RADIUS, TICK_RATE } from '../sim/constants';
import { Rng, clamp, dist, segDist2 } from '../sim/math';
import { raycast } from '../sim/map';
import { ForcedKind } from '../sim/movement';
import { canSeeArea, canSeePoint } from '../sim/vision';
import type { ZoneState } from '../sim/zone';
import { Btn, Hero, InputCmd, SLOT_BTN, World } from '../sim/world';
import { slotReady } from '../sim/skills';

export interface BotView {
  w: World;
  phase: 'drop' | 'play' | 'end';
  visible(a: number, b: number): boolean;
  zoneState(): ZoneState | null;
  supplies(): { x: number; y: number; state: number; pickupId: number }[];
  pickAugment(heroId: number, idx: number): void;
  matchTime(): number;
}

export const BOT_LEVELS = [
  { name: '쉬움', react: 14, aimErr: 1.5, judge: 0.45, lead: 0, dodge: 0.15, skillUse: 0.55 },
  { name: '보통', react: 8, aimErr: 0.75, judge: 0.75, lead: 0.5, dodge: 0.45, skillUse: 0.8 },
  { name: '어려움', react: 4, aimErr: 0.3, judge: 0.95, lead: 0.9, dodge: 0.8, skillUse: 0.97 },
];

const TIER_SCORE: Record<Tier, number> = { silver: 1, gold: 2, prism: 3 };

interface Seen { x: number; y: number; vx: number; vy: number; tick: number; hp: number; maxHp: number; level: number }

export class BotBrain {
  p: (typeof BOT_LEVELS)[number];
  rng: Rng;
  nextThink = 0;
  inp: InputCmd = { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, held: 0, pressed: 0, viewTick: 0 };
  seen = new Map<number, Seen>();
  goal: { x: number; y: number } | null = null;
  goalUntil = 0;
  strafe = 1;
  strafeUntil = 0;
  chargeHold = 0;
  dropAt = 0;
  augAt = 0;
  lastPos = { x: 0, y: 0, tick: 0 };
  unstuckUntil = 0;
  unstuckDir = { x: 0, y: 0 };
  usedVending = new Set<number>();
  mode = 'explore';
  aggr = 1;

  constructor(level: number, seed: number) {
    this.p = BOT_LEVELS[clamp(level | 0, 0, 2)];
    this.rng = new Rng(seed);
    this.dropAt = Math.round(this.rng.range(1.5, 7) * TICK_RATE);
    this.aggr = this.rng.range(0.8, 1.25);
  }

  think(v: BotView, h: Hero): InputCmd {
    const w = v.w;
    const inp = this.inp;
    inp.pressed = 0;
    if (h.state === 'drop') {
      if (w.tick - w.phaseStart >= this.dropAt) {
        const a = this.rng.range(0, Math.PI * 2), r = this.rng.range(6, 32);
        inp.ax = Math.cos(a) * r; inp.ay = Math.sin(a) * r; inp.pressed = Btn.Basic;
      }
      return inp;
    }
    if (h.state !== 'play') { inp.mx = 0; inp.my = 0; inp.held = 0; return inp; }

    // 증강 선택
    if (h.pending.length > 0) {
      if (this.augAt === 0) this.augAt = w.tick + Math.round(this.rng.range(0.6, 2.5) * TICK_RATE);
      else if (w.tick >= this.augAt) { v.pickAugment(h.id, this.chooseAug(h)); this.augAt = 0; }
    }

    // 충전형 스킬 유지
    if (this.chargeHold > 0) {
      this.chargeHold--;
      if (h.charging) inp.held |= SLOT_BTN[h.charging.slot];
      if (this.chargeHold === 0 && h.charging) inp.held &= ~SLOT_BTN[h.charging.slot];
      this.updateAimOnly(v, h);
      return inp;
    }
    if (w.tick < this.nextThink) return inp;
    this.nextThink = w.tick + this.p.react + (this.rng.next() < 0.3 ? 1 : 0);
    this.decide(v, h);
    return inp;
  }

  private chooseAug(h: Hero): number {
    const opts = h.pending[0].options;
    if (this.p.judge < 0.6 && this.rng.next() < 0.5) return this.rng.int(0, opts.length - 1);
    let best = 0, bs = -1;
    opts.forEach((id, i) => {
      const a = AUGMENT_BY_ID[id];
      let s = TIER_SCORE[a.tier] * 10 + (a.hero ? 4 : 0) + this.rng.range(0, 3);
      const melee = h.skills[0].range < 4.5;
      if (melee && (a.stats?.hp || a.stats?.armor || a.stats?.lifesteal)) s += 2;
      if (!melee && (a.stats?.dmg || a.stats?.proj)) s += 2;
      if (s > bs) { bs = s; best = i; }
    });
    return best;
  }

  private updateAimOnly(v: BotView, h: Hero) {
    const t = this.currentTarget(v, h);
    if (t) { const p = this.predict(t, h, 40); this.inp.ax = p.x; this.inp.ay = p.y; }
  }

  private currentTarget(v: BotView, h: Hero): Hero | null {
    let best: Hero | null = null, bd = 1e9;
    for (const e of v.w.heroes) {
      if (e.id === h.id || e.state !== 'play' || !v.visible(h.id, e.id)) continue;
      const d = dist(h.m.x, h.m.y, e.m.x, e.m.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private predict(e: Hero, h: Hero, projSpeed: number): { x: number; y: number } {
    const s = this.seen.get(e.id);
    let x = e.m.x, y = e.m.y;
    if (s && this.p.lead > 0) {
      const d = dist(h.m.x, h.m.y, x, y);
      const tt = Math.min(0.8, d / Math.max(8, projSpeed));
      x += s.vx * tt * this.p.lead; y += s.vy * tt * this.p.lead;
    }
    const err = this.p.aimErr;
    return { x: x + this.rng.range(-err, err), y: y + this.rng.range(-err, err) };
  }

  private decide(v: BotView, h: Hero) {
    const w = v.w;
    const inp = this.inp;
    inp.held = 0;
    // ── 인지 ──
    const enemies: Hero[] = [];
    for (const e of w.heroes) {
      if (e.id === h.id || e.state !== 'play') continue;
      if (!v.visible(h.id, e.id)) continue;
      enemies.push(e);
      const prev = this.seen.get(e.id);
      const dtS = prev ? Math.max(DT, (w.tick - prev.tick) * DT) : 1;
      this.seen.set(e.id, {
        x: e.m.x, y: e.m.y, vx: prev && w.tick - prev.tick < 20 ? (e.m.x - prev.x) / dtS : 0, vy: prev && w.tick - prev.tick < 20 ? (e.m.y - prev.y) / dtS : 0,
        tick: w.tick, hp: e.hp, maxHp: e.maxHp, level: e.level,
      });
    }
    const zone = v.zoneState();
    const hpR = h.hp / h.maxHp;

    // ── 위협 회피 ──
    const threat = this.findThreat(v, h);
    let moveX = 0, moveY = 0;
    let dodgeNow = false;
    if (threat) {
      moveX = threat.x; moveY = threat.y;
      if (threat.urgent && h.m.dodgeCd <= 0 && this.rng.next() < this.p.dodge) dodgeNow = true;
    }

    // ── 목표 결정 ──
    let target: Hero | null = null;
    let bestScore = 1e9;
    for (const e of enemies) {
      const d = dist(h.m.x, h.m.y, e.m.x, e.m.y);
      const score = d + (e.hp / e.maxHp) * 6 - (e.st.markT > 0 && e.st.markBy === h.id ? 3 : 0);
      if (score < bestScore) { bestScore = score; target = e; }
    }
    let flee = false;
    let avoid: Hero | null = null;
    if (target) {
      const near = enemies.filter(e => dist(e.m.x, e.m.y, h.m.x, h.m.y) < 10);
      const myPow = (h.hp + h.shield) * (1 + 0.12 * h.level) * (1 + h.stats.dmg);
      let theirPow = 0;
      for (const e of near) theirPow += (e.hp + e.shield) * (1 + 0.12 * e.level);
      const noise = (1 - this.p.judge) * this.rng.range(-0.6, 0.6);
      const ratio = myPow / Math.max(1, theirPow) + noise;
      const early = v.matchTime() < 130;
      if ((hpR < (early ? 0.5 : 0.38) && ratio < 1.2) || (ratio < 0.6 && near.length > 0)) flee = true;
      // 교전 판단: 초반엔 파밍 위주, 시간이 갈수록 공격적
      const td = dist(h.m.x, h.m.y, target.m.x, target.m.y);
      const aggr = clamp(0.05 + Math.max(0, v.matchTime() - 50) / 330, 0.05, 1.3) * this.aggr;
      const provoked = h.lastHitBy === target.id && w.tick - h.lastHitTick < 75 && (!early || ratio > 1.15);
      const lateZone = (zone?.stage ?? 0) >= 4;
      const engage = provoked || lateZone || td < 3.2 || (target.hp / target.maxHp < 0.3 && (td < 7 || aggr > 0.35)) || ratio * aggr > 1.05;
      if (!flee && !engage) { avoid = target; target = null; }
    }

    const melee = h.skills[0].range < 4.6;
    const outside = zone && (h.m.x - zone.x) ** 2 + (h.m.y - zone.y) ** 2 > (zone.r - 1) ** 2;
    const outsideNext = zone && zone.showNext && zone.nextShrinkIn < 14 && (h.m.x - zone.nx) ** 2 + (h.m.y - zone.ny) ** 2 > (zone.nr - 1.5) ** 2;

    let goalX = h.m.x, goalY = h.m.y, hasGoal = false;
    let aimX = h.input.ax || h.m.x + Math.cos(h.facing) * 3, aimY = h.input.ay || h.m.y + Math.sin(h.facing) * 3;

    if (target && !flee) {
      this.mode = 'fight';
      const p = this.predict(target, h, 25);
      aimX = p.x; aimY = p.y;
      const d = dist(h.m.x, h.m.y, target.m.x, target.m.y);
      const want = melee ? 1.5 : h.skills[0].range * 0.72;
      const dx = (target.m.x - h.m.x) / (d || 1), dy = (target.m.y - h.m.y) / (d || 1);
      if (w.tick > this.strafeUntil) { this.strafe = this.rng.next() < 0.5 ? -1 : 1; this.strafeUntil = w.tick + Math.round(this.rng.range(0.6, 1.6) * TICK_RATE); }
      if (d > want + 0.6) { goalX = target.m.x; goalY = target.m.y; }
      else if (d < want - 1.2 && !melee) { goalX = h.m.x - dx * 3 + -dy * this.strafe * 2; goalY = h.m.y - dy * 3 + dx * this.strafe * 2; }
      else { goalX = h.m.x - dy * this.strafe * 3; goalY = h.m.y + dx * this.strafe * 3; }
      hasGoal = true;
      this.useSkills(v, h, target, enemies, d);
    } else if (target && flee) {
      this.mode = 'flee';
      let ax = 0, ay = 0;
      for (const e of enemies) { const d = dist(h.m.x, h.m.y, e.m.x, e.m.y) || 1; ax += (h.m.x - e.m.x) / (d * d); ay += (h.m.y - e.m.y) / (d * d); }
      const zx = zone ? zone.nx - h.m.x : -h.m.x, zy = zone ? zone.ny - h.m.y : -h.m.y; const zl = Math.hypot(zx, zy) || 1;
      const l = Math.hypot(ax, ay) || 1;
      goalX = h.m.x + (ax / l) * 5 + (zx / zl) * 2.5; goalY = h.m.y + (ay / l) * 5 + (zy / zl) * 2.5; hasGoal = true;
      const p = this.predict(target, h, 25); aimX = p.x; aimY = p.y;
      // 도주용 이동기/은신
      this.useEscape(v, h, target, goalX, goalY);
      if (dist(h.m.x, h.m.y, target.m.x, target.m.y) < Math.min(5, h.skills[0].range)) inp.held |= Btn.Basic;
    } else {
      this.mode = 'explore';
      const goal = this.pickNonCombatGoal(v, h, zone);
      goalX = goal.x; goalY = goal.y; hasGoal = true;
      if (avoid) {
        const ad = dist(h.m.x, h.m.y, avoid.m.x, avoid.m.y) || 1;
        if (ad < 12) { goalX += ((h.m.x - avoid.m.x) / ad) * 6; goalY += ((h.m.y - avoid.m.y) / ad) * 6; }
      }
      if (goal.aim) { aimX = goal.aim.x; aimY = goal.aim.y; }
      else { aimX = h.m.x + (goalX - h.m.x); aimY = h.m.y + (goalY - h.m.y); }
      if (goal.attack) inp.held |= Btn.Basic;
      if (goal.interact && dist(h.m.x, h.m.y, goal.x, goal.y) < 1.8) inp.pressed |= Btn.Interact;
    }

    if (outside || outsideNext) {
      // 구역 안으로 (전투 중이라도)
      const zx = outside ? zone!.x : zone!.nx, zy = outside ? zone!.y : zone!.ny;
      goalX = zx; goalY = zy; hasGoal = true;
      if (outside && h.m.dodgeCd <= 0 && !target && this.rng.next() < 0.3) dodgeNow = true;
    }

    if (hasGoal && !threat) {
      const dx = goalX - h.m.x, dy = goalY - h.m.y, l = Math.hypot(dx, dy);
      if (l > 0.3) { moveX = dx / l; moveY = dy / l; }
    } else if (hasGoal && threat) {
      const dx = goalX - h.m.x, dy = goalY - h.m.y, l = Math.hypot(dx, dy) || 1;
      moveX = moveX * 0.8 + (dx / l) * 0.2; moveY = moveY * 0.8 + (dy / l) * 0.2;
    }
    // 장애물 회피
    const steer = this.steer(w, h, moveX, moveY);
    inp.mx = steer.x; inp.my = steer.y;
    inp.ax = aimX; inp.ay = aimY;
    if (dodgeNow) inp.pressed |= Btn.Dodge;
  }

  private steer(w: World, h: Hero, mx: number, my: number): { x: number; y: number } {
    const l = Math.hypot(mx, my);
    if (l < 0.05) return { x: 0, y: 0 };
    mx /= l; my /= l;
    // 막힘 감지
    if (w.tick - this.lastPos.tick >= 20) {
      const moved = dist(h.m.x, h.m.y, this.lastPos.x, this.lastPos.y);
      if (moved < 0.4 && h.m.ft <= 0 && !h.cast && h.st.rootT <= 0 && h.st.stunT <= 0) {
        const a = this.rng.range(0, Math.PI * 2);
        this.unstuckDir = { x: Math.cos(a), y: Math.sin(a) }; this.unstuckUntil = w.tick + 15;
      }
      this.lastPos = { x: h.m.x, y: h.m.y, tick: w.tick };
    }
    if (w.tick < this.unstuckUntil) return this.unstuckDir;
    const probe = 1.6;
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
      const c = Math.cos(off), s = Math.sin(off);
      const dx = mx * c - my * s, dy = mx * s + my * c;
      const r = raycast(w.map, w.alive, h.m.x, h.m.y, h.m.x + dx * probe, h.m.y + dy * probe, 'all', h.radius * 0.9);
      if (!r.ob && Math.hypot(h.m.x + dx * probe, h.m.y + dy * probe) < 42) return { x: dx, y: dy };
    }
    return { x: mx, y: my };
  }

  private findThreat(v: BotView, h: Hero): { x: number; y: number; urgent: boolean } | null {
    const w = v.w;
    let best: { x: number; y: number; urgent: boolean; score: number } | null = null;
    for (const p of w.projectiles) {
      if (p.owner === h.id && !p.neutral) continue;
      const dx = h.m.x - p.x, dy = h.m.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 9) continue;
      if (!canSeePoint(w, h.m.x, h.m.y, p.x, p.y)) continue;
      const along = dx * p.dx + dy * p.dy;
      if (along < 0) continue;
      const perp = Math.abs(dx * p.dy - dy * p.dx);
      const rr = p.radius + h.radius + 0.35;
      if (perp > rr) continue;
      const tti = along / p.speed;
      if (tti > 0.9) continue;
      // 수직 방향으로 회피
      const side = dx * p.dy - dy * p.dx >= 0 ? 1 : -1;
      const sc = tti;
      if (!best || sc < best.score) best = { x: -p.dy * side * -1, y: p.dx * side * -1, urgent: tti < 0.35, score: sc };
    }
    for (const t of w.telegraphs) {
      if (t.owner === h.id) continue;
      if (!canSeeArea(h.m.x, h.m.y, t.x, t.y, t.r + t.len)) continue;
      const remain = (t.delay - t.t) / TICK_RATE;
      let inside = false, ex = 0, ey = 0;
      if (t.shape === 0) {
        const d = dist(h.m.x, h.m.y, t.x, t.y);
        if (d < t.r + h.radius + 0.3) { inside = true; ex = (h.m.x - t.x) / (d || 1); ey = (h.m.y - t.y) / (d || 1); if (d < 0.1) { ex = 1; ey = 0; } }
      } else if (t.shape === 2) {
        const bx = t.x + Math.cos(t.ang) * t.len, by = t.y + Math.sin(t.ang) * t.len;
        if (segDist2(h.m.x, h.m.y, t.x, t.y, bx, by) < (t.w / 2 + h.radius + 0.3) ** 2) {
          inside = true;
          const nx = -Math.sin(t.ang), ny = Math.cos(t.ang);
          const s = (h.m.x - t.x) * nx + (h.m.y - t.y) * ny >= 0 ? 1 : -1;
          ex = nx * s; ey = ny * s;
        }
      } else {
        const d = dist(h.m.x, h.m.y, t.x, t.y);
        if (d < t.r + h.radius) {
          let da = Math.atan2(h.m.y - t.y, h.m.x - t.x) - t.ang;
          while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) < t.len / 2 + 0.2) { inside = true; ex = -Math.sin(t.ang) * Math.sign(da || 1); ey = Math.cos(t.ang) * Math.sign(da || 1); }
        }
      }
      if (inside) {
        const sc = remain;
        if (!best || sc < best.score) best = { x: ex, y: ey, urgent: remain < 0.4, score: sc };
      }
    }
    for (const z of w.zones) {
      if (z.owner === h.id) continue;
      if (!z.act.pull && !z.act.onTick && z.act.dmg <= 0) continue;
      if (z.act.follow) continue;
      const d = dist(h.m.x, h.m.y, z.x, z.y);
      if (d < z.r + 0.5) {
        const sc = 1.0;
        if (!best || sc < best.score) best = { x: (h.m.x - z.x) / (d || 1), y: (h.m.y - z.y) / (d || 1), urgent: !!z.act.pull, score: sc };
      }
    }
    return best;
  }

  private canUse(h: Hero, slot: number): boolean {
    if (!slotReady(h, slot)) return false;
    if (h.cast || h.charging || h.m.ft > 0) return false;
    if (slot > 0 && h.st.silenceT > 0) return false;
    return h.st.stunT <= 0;
  }

  private press(h: Hero, slot: number, ax: number, ay: number) {
    this.inp.pressed |= SLOT_BTN[slot];
    this.inp.ax = ax; this.inp.ay = ay;
    const def = h.skills[slot];
    if (def.chargeUp) {
      this.inp.held |= SLOT_BTN[slot];
      this.chargeHold = Math.round(def.chargeUp.max * TICK_RATE * clamp(this.rng.range(0.55, 1.05) + this.p.judge * 0.1, 0.4, 1.05));
    }
  }

  private useSkills(v: BotView, h: Hero, t: Hero, enemies: Hero[], d: number) {
    const w = v.w;
    if (this.rng.next() > this.p.skillUse) { if (d <= h.skills[0].range + 0.3) this.inp.held |= Btn.Basic; return; }
    const tHp = t.hp / t.maxHp;
    const order = [4, 1, 2, 3];
    for (const slot of order) {
      if (!this.canUse(h, slot)) continue;
      const def = h.skills[slot];
      const speed = projSpeedOf(def);
      const p = this.predict(t, h, speed);
      const r = def.ai.range;
      const isDash = def.actions[0].t === 'dash' || def.actions[0].t === 'blink';
      const back = isDash && (def.actions[0] as DashAction).backward;
      if (slot === 4) {
        const inRange = d <= r;
        const multi = enemies.filter(e => dist(e.m.x, e.m.y, h.m.x, h.m.y) <= r).length;
        if (inRange && (tHp < 0.6 || multi >= 2 || h.hp / h.maxHp < 0.4)) {
          if (def.target === 'self' && d > (def.indicator.shape === 'self' ? def.indicator.radius * 0.85 : r)) continue;
          this.press(h, slot, p.x, p.y); return;
        }
        continue;
      }
      if (back) {
        if (d < 3.5 && t.skills[0].range < 4.6) { this.press(h, slot, t.m.x, t.m.y); return; }
        continue;
      }
      if (def.ai.use === 'buff') {
        if (d > 3 && d < 10 && h.hp / h.maxHp > 0.4) { this.press(h, slot, p.x, p.y); return; }
        continue;
      }
      if (def.ai.use === 'mobility' || (isDash && def.ai.use === 'engage')) {
        const melee = h.skills[0].range < 4.6;
        if (melee && d > 3 && d < r && h.hp / h.maxHp > 0.35) { this.press(h, slot, p.x, p.y); return; }
        if (!melee && d < 3 && h.hp / h.maxHp < 0.8) {
          // 원거리는 거리 벌리기: 적 반대 방향
          const ax = h.m.x - (t.m.x - h.m.x) * 2, ay = h.m.y - (t.m.y - h.m.y) * 2;
          this.press(h, slot, ax, ay); return;
        }
        continue;
      }
      if (def.target === 'self') {
        const rad = def.indicator.shape === 'self' ? def.indicator.radius : r;
        if (d <= rad * 0.85) { this.press(h, slot, p.x, p.y); return; }
        continue;
      }
      if (d <= r) {
        if (def.target === 'dir' && raycast(w.map, w.alive, h.m.x, h.m.y, t.m.x, t.m.y, 'all').ob && def.actions[0].t === 'projectile') continue;
        this.press(h, slot, p.x, p.y); return;
      }
    }
    if (d <= h.skills[0].range + 0.3) {
      this.inp.held |= Btn.Basic;
      const p = this.predict(t, h, projSpeedOf(h.skills[0]));
      this.inp.ax = p.x; this.inp.ay = p.y;
    }
  }

  private useEscape(v: BotView, h: Hero, t: Hero, gx: number, gy: number) {
    for (const slot of [3, 2, 1]) {
      if (!this.canUse(h, slot)) continue;
      const def = h.skills[slot];
      const a0 = def.actions[0];
      if (def.ai.use === 'buff') { this.press(h, slot, gx, gy); return; }
      if (a0.t === 'dash' || a0.t === 'blink') {
        if ((a0 as DashAction).backward) this.press(h, slot, t.m.x, t.m.y);
        else this.press(h, slot, h.m.x + (gx - h.m.x) * 3, h.m.y + (gy - h.m.y) * 3);
        return;
      }
    }
    if (h.m.dodgeCd <= 0 && dist(h.m.x, h.m.y, t.m.x, t.m.y) < 4 && this.rng.next() < this.p.dodge) {
      this.inp.mx = gx - h.m.x; this.inp.my = gy - h.m.y; this.inp.pressed |= Btn.Dodge;
    }
  }

  private pickNonCombatGoal(v: BotView, h: Hero, zone: ZoneState | null): { x: number; y: number; aim?: { x: number; y: number }; attack?: boolean; interact?: boolean } {
    const w = v.w;
    const hpR = h.hp / h.maxHp;
    // 보급품
    for (const s of v.supplies()) {
      if (s.state === 2 && dist(h.m.x, h.m.y, s.x, s.y) < 26 && hpR > 0.35) return { x: s.x, y: s.y, interact: true };
    }
    // 자판기
    if (hpR < 0.6) {
      let best: { x: number; y: number; id: number } | null = null, bd = 22;
      for (const p of w.pickups) {
        if (p.kind !== 'vending' || p.used) continue;
        const d = dist(h.m.x, h.m.y, p.x, p.y);
        if (d < bd) { bd = d; best = { x: p.x, y: p.y, id: p.id }; }
      }
      if (best) return { x: best.x, y: best.y, interact: true };
    }
    // 중립 드론
    if (hpR > 0.45) {
      let best = null as null | { x: number; y: number }, bd = 13;
      for (const n of w.neutrals) {
        if (!n.alive) continue;
        const d = dist(h.m.x, h.m.y, n.x, n.y);
        if (d < bd && canSeePoint(w, h.m.x, h.m.y, n.x, n.y)) { bd = d; best = { x: n.x, y: n.y }; }
      }
      if (best) {
        const range = h.skills[0].range;
        const d = bd;
        const gx = d > range * 0.8 ? best.x : h.m.x, gy = d > range * 0.8 ? best.y : h.m.y;
        return { x: gx, y: gy, aim: best, attack: d <= range + 0.3 };
      }
    }
    // 데이터 코어
    let core = null as null | { x: number; y: number }, cd = 14;
    for (const p of w.pickups) {
      if (p.kind !== 'core' || p.used) continue;
      if (zone && (p.x - zone.x) ** 2 + (p.y - zone.y) ** 2 > zone.r * zone.r) continue;
      const d = dist(h.m.x, h.m.y, p.x, p.y);
      if (d < cd && canSeePoint(w, h.m.x, h.m.y, p.x, p.y)) { cd = d; core = p; }
    }
    if (core) return core;
    // 마지막으로 본 적 사냥
    if (hpR > 0.55 && v.matchTime() > 150 * (2 - this.aggr)) {
      let last: Seen | null = null;
      for (const s of this.seen.values()) if (w.tick - s.tick < 8 * TICK_RATE && (!last || s.tick > last.tick)) last = s;
      if (last && dist(h.m.x, h.m.y, last.x, last.y) > 2) return { x: last.x, y: last.y };
    }
    // 배회
    if (!this.goal || w.tick > this.goalUntil || dist(h.m.x, h.m.y, this.goal.x, this.goal.y) < 2) {
      const cx = zone ? (zone.showNext ? zone.nx : zone.x) : 0, cy = zone ? (zone.showNext ? zone.ny : zone.y) : 0;
      const rr = zone ? Math.max(2, (zone.showNext ? zone.nr : zone.r) * 0.8) : MAP_RADIUS * 0.7;
      const a = this.rng.range(0, Math.PI * 2), r = Math.sqrt(this.rng.next()) * rr;
      this.goal = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      this.goalUntil = w.tick + Math.round(this.rng.range(4, 9) * TICK_RATE);
    }
    return this.goal;
  }
}

function projSpeedOf(def: SkillDef): number {
  const a = def.actions[0];
  if (a.t === 'projectile') return a.speed;
  if (a.t === 'aoe' || a.t === 'zone') return 12;
  return 40;
}

export function botIsBusy(h: Hero) { return h.m.fkind === ForcedKind.Dodge; }
