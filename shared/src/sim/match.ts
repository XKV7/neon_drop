import { BotBrain, BotView } from '../bot/brain';
import { DEFAULT_COSMETIC, Cosmetic } from '../data/cosmetics';
import { HERO_IDS } from '../data/heroes';
import { XP_REWARD, XP_TABLE, OOC_REGEN, ULT_PASSIVE_PER_SEC } from '../data/heroes';
import { DODGE_IFRAMES, DROP_PHASE_SEC, LANDING_SEC, MAP_RADIUS, RECONNECT_GRACE_SEC, TICK_RATE, DODGE_CD } from './constants';
import { addShield, aliveCount, chooseAugment, createHero, dealDamage, gainXp, heal, killHero, offerAugment, recomputeHero } from './combat';
import { generateMap, findFreeSpot, overlapsObstacle } from './map';
import { Rng, dist, clamp } from './math';
import { ForcedKind, MoveParams, stepMove } from './movement';
import { processCastInput, updateCooldowns, updateDashes, updateDeployables, updateProjectiles, updateTelegraphs, updateZones, spawnSimpleProjectile } from './skills';
import { computeVisMatrix, canSeePoint } from './vision';
import { makeZoneSchedule, zoneAt, ZoneState, outsideZone } from './zone';
import { Btn, Fx, Hero, InputCmd, World } from './world';
import type { HeroId } from '../data/types';

export interface PlayerSpec { pid: string; name: string; heroId: HeroId; isBot: boolean; botLevel: number; cos?: Cosmetic; dummy?: boolean }
export interface MatchConfig { seed: number; players: PlayerSpec[]; mode: 'br' | 'practice' | 'demo'; /** 테스트용: 구역/보급 시간 가속 */ timeScale?: number; /** 테스트용: 경험치 배율 */ xpMult?: number }

export interface Supply { x: number; y: number; state: number; at: number; pickupId: number }
// state: 0 대기, 1 예고, 2 착지(획득 가능), 3 획득됨

export const SUPPLY_TIMES = [105, 225];
export const SUPPLY_WARN = 15;

export class Match implements BotView {
  w: World;
  cfg: MatchConfig;
  phase: 'drop' | 'play' | 'end' = 'drop';
  bots = new Map<number, BotBrain>();
  vis = new Uint8Array(16 * 16);
  visTick = -1;
  winner = 0;
  endTick = 0;
  supply: Supply[] = [];
  zs: ZoneState | null = null;
  startTick = 0;
  coreTimer = 0;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    const map = generateMap(cfg.seed);
    this.w = new World(map, cfg.seed);
    const w = this.w;
    w.practice = cfg.mode === 'practice';
    w.xpMult = cfg.xpMult ?? 1;
    if (cfg.mode !== 'practice') w.zone = makeZoneSchedule(cfg.seed);
    const rng = new Rng(cfg.seed ^ 0x77);
    cfg.players.slice(0, 10).forEach((p, i) => {
      const heroId = HERO_IDS.includes(p.heroId) ? p.heroId : rng.pick(HERO_IDS);
      const h = createHero(w, i + 1, { pid: p.pid, name: p.name, heroId, isBot: p.isBot, botLevel: p.botLevel, cos: p.cos ?? { ...DEFAULT_COSMETIC }, dummy: p.dummy });
      w.heroes.push(h);
      if (p.isBot && !p.dummy) this.bots.set(h.id, new BotBrain(p.botLevel, cfg.seed ^ (i * 7919)));
    });
    // 중립 드론, 자판기, 코어
    for (const c of map.camps) w.neutrals.push({ id: w.allocId(), x: c.x, y: c.y, hx: c.x, hy: c.y, hp: 280, maxHp: 280, aggro: 0, shotCd: 0, respawnAt: 0, alive: true, facing: 0, lastHitBy: 0, anim: 0, animSeq: 0 });
    for (const v of map.vendings) w.pickups.push({ id: w.allocId(), kind: 'vending', x: v.x, y: v.y, xp: 0, used: false, t: 0 });
    for (let i = 0; i < 22; i++) this.spawnCore(MAP_RADIUS - 3);
    if (cfg.mode === 'practice') {
      this.phase = 'play';
      w.heroes.forEach((h, i) => {
        h.state = 'play';
        if (h.dummy) {
          const a = (i / Math.max(1, w.heroes.length - 1)) * Math.PI * 1.2 - 0.6;
          const s = findFreeSpot(w.map, w.alive, 6 + Math.cos(a) * 5, 6 + Math.sin(a) * 5, h.radius);
          h.m.x = s.x; h.m.y = s.y;
        } else { h.m.x = 2; h.m.y = 3; }
      });
      w.neutrals.forEach(n => { n.alive = false; n.respawnAt = 1e9; });
    } else {
      SUPPLY_TIMES.forEach(t => this.supply.push({ x: 0, y: 0, state: 0, at: t, pickupId: 0 }));
    }
    w.phaseStart = 0;
  }

  // ───── BotView ─────
  visible(a: number, b: number): boolean {
    if (this.visTick !== this.w.tick) { computeVisMatrix(this.w, this.vis); this.visTick = this.w.tick; }
    return this.vis[a * 16 + b] === 1;
  }
  zoneState(): ZoneState | null { return this.zs; }
  supplies() { return this.supply; }
  matchTime() { return this.time; }
  pickAugment(heroId: number, idx: number) { const h = this.w.hero(heroId); if (h) chooseAugment(this.w, h, idx); }

  get time(): number { return (this.w.tick - this.startTick) / TICK_RATE; }
  /** 구역/보급 진행 시간 (테스트 가속 반영, 낙하 단계는 실시간) */
  get zoneTime(): number { const t = this.time, s = this.cfg.timeScale ?? 1; return t <= DROP_PHASE_SEC ? t : DROP_PHASE_SEC + (t - DROP_PHASE_SEC) * s; }

  setInput(heroId: number, inp: InputCmd) {
    const h = this.w.hero(heroId);
    if (!h) return;
    // 같은 틱에 여러 입력이 들어오면 누름을 합친다
    h.input = { ...inp, pressed: inp.pressed };
  }

  setDisconnected(heroId: number, dc: boolean) {
    const h = this.w.hero(heroId);
    if (!h) return;
    h.disconnected = dc;
    if (dc) { h.dcTick = this.w.tick; h.input = { ...h.input, mx: 0, my: 0, held: 0, pressed: 0 }; }
  }

  emote(heroId: number, n: number) {
    const h = this.w.hero(heroId);
    if (!h || h.state !== 'play' || h.emoteT > 0) return;
    h.emoteT = 60; h.anim = 10 + (n & 7); h.animSeq = (h.animSeq + 1) & 255;
    this.w.ev(Fx.Emote, h.id, n, h.m.x, h.m.y);
  }

  practiceCheat(heroId: number, what: 'level' | 'reset' | 'ult') {
    if (this.cfg.mode !== 'practice') return;
    const h = this.w.hero(heroId);
    if (!h) return;
    if (what === 'level' && h.level < 8) { const XP = XP_TABLE; gainXp(this.w, h, (XP[h.level] - h.xp) / (1 + h.stats.xp) + 1); }
    if (what === 'reset') for (let s = 0; s < 5; s++) { h.charges[s] = h.chargeMax[s]; h.cds[s] = 0; }
    if (what === 'ult') h.ult = 1;
  }

  spawnCore(maxR: number) {
    const w = this.w;
    const z = this.zs;
    for (let tries = 0; tries < 12; tries++) {
      const cx = z ? z.x : 0, cy = z ? z.y : 0, rr = z ? Math.max(1, Math.min(z.r - 1, maxR)) : maxR;
      const a = w.rng.range(0, Math.PI * 2), r = Math.sqrt(w.rng.next()) * rr;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (Math.hypot(x, y) > MAP_RADIUS - 1) continue;
      if (overlapsObstacle(w.map, w.alive, x, y, 0.5)) continue;
      w.pickups.push({ id: w.allocId(), kind: 'core', x, y, xp: XP_REWARD.core, used: false, t: 0 });
      return;
    }
  }

  dropHero(h: Hero, x: number, y: number) {
    const w = this.w;
    const d = Math.hypot(x, y);
    if (d > MAP_RADIUS - 2) { x *= (MAP_RADIUS - 2) / d; y *= (MAP_RADIUS - 2) / d; }
    const s = findFreeSpot(w.map, w.alive, x, y, h.radius);
    h.m.x = s.x; h.m.y = s.y; h.dropX = s.x; h.dropY = s.y;
    h.state = 'landing'; h.landT = Math.round(LANDING_SEC * TICK_RATE);
  }

  step() {
    const w = this.w;
    if (this.phase === 'end') { w.tick++; w.events = []; return; }
    w.tick++;
    w.events.length = 0;
    // 예약 실행
    if (w.timers.length) {
      const due = w.timers.filter(t => t.at <= w.tick);
      if (due.length) { w.timers = w.timers.filter(t => t.at > w.tick); for (const t of due) t.fn(); }
    }
    if (w.zone) this.zs = zoneAt(w.zone, this.zoneTime);

    // 봇 입력
    for (const [id, b] of this.bots) {
      const h = w.hero(id)!;
      if (h.state === 'dead') continue;
      const inp = b.think(this, h);
      h.input = { ...inp };
    }

    // 낙하 단계
    if (this.phase === 'drop') {
      for (const h of w.heroes) {
        if (h.state === 'drop' && (h.input.pressed & (Btn.Basic | Btn.Dodge))) this.dropHero(h, h.input.ax, h.input.ay);
      }
      if (this.time >= DROP_PHASE_SEC) {
        for (const h of w.heroes) if (h.state === 'drop') {
          const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(8, 30);
          this.dropHero(h, Math.cos(a) * r, Math.sin(a) * r);
        }
      }
      if (w.heroes.every(h => h.state !== 'drop' && h.state !== 'landing')) { this.phase = 'play'; w.playStart = w.tick; }
    }

    for (const h of w.heroes) {
      if (h.state === 'landing') {
        h.landT--;
        if (h.landT <= 0) {
          h.state = 'play'; h.spawnTick = w.tick;
          h.st.invulnT = 30;
          w.ev(Fx.Land, h.id, h.cos.drop, h.m.x, h.m.y);
        }
        continue;
      }
      if (h.state !== 'play') continue;
      if (h.disconnected && !h.isBot) {
        h.input = { ...h.input, mx: 0, my: 0, held: 0, pressed: 0 };
        if (w.tick - h.dcTick > RECONNECT_GRACE_SEC * TICK_RATE && !w.practice) { h.killSkill = '연결 끊김'; killHero(w, h, null); continue; }
      }
      this.updateStatus(h);
      updateCooldowns(h);
      if (h.dummy) { h.input = { ...h.input, mx: 0, my: 0, held: 0, pressed: 0 }; }
      processCastInput(w, h);
      this.moveHero(h);
      this.interact(h);
      if (h.st.dodgeFrames <= 0 && h.m.fkind !== ForcedKind.Dodge) h.dodgeHits.length = 0;
    }
    updateDashes(w);
    updateProjectiles(w);
    updateZones(w);
    updateTelegraphs(w);
    updateDeployables(w);
    this.updateNeutrals();
    this.updatePickups();
    this.updateZoneDamage();
    this.updateSupply();
    this.updatePassives();
    this.autoPickAugments();
    if (w.practice) this.practiceUpkeep();

    w.history.record(w.tick, w.heroes.map(h => ({ id: h.id, x: h.m.x, y: h.m.y, ok: h.state === 'play' })));
    for (const h of w.heroes) h.input.pressed = 0;
    this.checkEnd();
  }

  private updateStatus(h: Hero) {
    const w = this.w, st = h.st;
    if (st.stunT > 0) st.stunT--;
    if (st.rootT > 0) st.rootT--;
    if (st.silenceT > 0) st.silenceT--;
    if (st.invertT > 0) st.invertT--;
    if (st.stealthT > 0) { st.stealthT--; if (st.stealthT === 0) { h.stealthEndTick = w.tick; w.ev(Fx.Stealth, h.id, 0, h.m.x, h.m.y); } }
    if (st.untargetT > 0) st.untargetT--;
    if (st.invulnT > 0) st.invulnT--;
    if (st.markT > 0) st.markT--;
    if (st.revealT > 0) st.revealT--;
    if (st.dodgeFrames > 0) st.dodgeFrames--;
    if (h.emoteT > 0) h.emoteT--;
    if (st.slows.length) { for (const s of st.slows) s.t--; st.slows = st.slows.filter(s => s.t > 0); }
    if (st.hastes.length) { for (const s of st.hastes) s.t--; st.hastes = st.hastes.filter(s => s.t > 0); }
    if (st.dmgBuffs.length) { for (const s of st.dmgBuffs) s.t--; st.dmgBuffs = st.dmgBuffs.filter(s => s.t > 0); }
    if (h.shieldT > 0) { h.shieldT--; if (h.shieldT === 0) h.shield = 0; }
    if (st.dots.length) {
      const tickDmg = w.tick % 15 === 0;
      for (const d of st.dots) {
        d.t--;
        if (tickDmg) dealDamage(w, w.hero(d.src) ?? null, h, d.dps * 0.5, { kind: 'dot', skillName: '화상' });
      }
      st.dots = st.dots.filter(d => d.t > 0);
    }
  }

  moveParams(h: Hero): MoveParams {
    const st = h.st;
    let slow = 0, haste = 0;
    for (const s of st.slows) slow = Math.max(slow, s.pct);
    for (const s of st.hastes) haste = Math.max(haste, s.pct);
    let mult = 1 + h.stats.speed + haste - slow;
    if (h.cast) mult *= h.skills[h.cast.slot].castMove ?? 0.5;
    if (h.charging) mult *= h.skills[h.charging.slot].chargeUp?.move ?? 0.5;
    if (h.channel) mult = 0;
    const strikeLock = st.rootT > 0;
    return {
      speed: h.def.speed * Math.max(0.25, mult),
      canMove: st.stunT <= 0 && !strikeLock,
      canDodge: st.stunT <= 0 && st.rootT <= 0 && !h.cast && !h.charging,
      invert: st.invertT > 0,
      radius: h.radius,
      dodgeCdTicks: Math.round(DODGE_CD * (1 - h.stats.dodgeCd) * TICK_RATE),
      dodgeDistMult: 1 + h.stats.dodgeDist,
    };
  }

  private moveHero(h: Hero) {
    const w = this.w;
    const inp = h.input;
    if (h.channel && (Math.abs(inp.mx) + Math.abs(inp.my) > 0.1)) h.channel = null;
    const p = this.moveParams(h);
    const prevFk = h.m.fkind;
    const r = stepMove(h.m, { mx: inp.mx, my: inp.my, ax: inp.ax, ay: inp.ay, dodge: (inp.pressed & Btn.Dodge) !== 0 }, p, w.map, w.alive);
    if (r.dodged) {
      h.st.dodgeFrames = Math.round(DODGE_IFRAMES * TICK_RATE);
      h.dodgeHits.length = 0;
      w.ev(Fx.Dodge, h.id, 0, h.m.x, h.m.y);
      if (h.stats.dodgeHaste > 0) h.st.hastes.push({ pct: h.stats.dodgeHaste, t: 36 });
      if (h.st.stealthT > 0) { /* 구르기는 은신 유지 */ }
    }
    if (h.m.fkind === ForcedKind.Dodge && h.stats.dodgeDmg > 0) {
      for (const e of w.enemiesInRadius(h, h.m.x, h.m.y, 1.1)) {
        if (h.dodgeHits.includes(e.id)) continue;
        h.dodgeHits.push(e.id);
        dealDamage(w, h, e, h.stats.dodgeDmg, { kind: 'passive', skillName: '충격 구르기' });
      }
    }
    if (prevFk === ForcedKind.Knock && r.wallHit && h.knockStun > 0) {
      h.st.stunT = Math.max(h.st.stunT, h.knockStun); h.knockStun = 0;
      h.m.ft = 0; h.m.fkind = 0;
      w.ev(Fx.Spark, h.id, 3, h.m.x, h.m.y);
    }
    if (r.forcedEnded) h.knockStun = 0;
    if (r.pad) w.ev(Fx.Pad, h.id, 0, h.m.x, h.m.y);
    if (r.gate) w.ev(Fx.Teleport, h.id, 0, h.m.x, h.m.y);
    // 바라보는 방향
    if (h.m.ft > 0 && (h.m.fkind === ForcedKind.Dash || h.m.fkind === ForcedKind.Dodge || h.m.fkind === ForcedKind.Jump)) {
      if (Math.abs(h.m.fvx) + Math.abs(h.m.fvy) > 0.1) h.facing = Math.atan2(h.m.fvy, h.m.fvx);
    } else if (!h.dummy && h.st.stunT <= 0) {
      const dx = inp.ax - h.m.x, dy = inp.ay - h.m.y;
      if (dx * dx + dy * dy > 0.04) h.facing = Math.atan2(dy, dx);
    }
  }

  private interact(h: Hero) {
    const w = this.w;
    if (h.channel) {
      h.channel.t++;
      const pk = w.pickups.find(p => p.id === h.channel!.target);
      if (!pk || pk.used || h.lastDamagedTick > w.tick - h.channel.t || h.st.stunT > 0) { h.channel = null; return; }
      if (h.channel.t >= h.channel.total) {
        pk.used = true; h.channel = null;
        const s = this.supply.find(s => s.pickupId === pk.id);
        if (s) s.state = 3;
        w.ev(Fx.Pickup, h.id, 2, pk.x, pk.y);
        w.msgs.push({ to: 'all', type: 'announce', text: `${h.name}이(가) 기업 보급품을 확보했습니다!`, tone: 'supply' });
        offerAugment(w, h, 'supply', 'prism');
        addShield(w, h, 150, 5);
      }
      return;
    }
    if (!(h.input.pressed & Btn.Interact)) return;
    let best = null as null | (typeof w.pickups)[number], bd = 2.3;
    for (const p of w.pickups) {
      if (p.used || p.kind === 'core') continue;
      const d = dist(h.m.x, h.m.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    if (best.kind === 'vending') {
      best.used = true;
      heal(w, h, h.maxHp * 0.4);
      w.ev(Fx.Pickup, h.id, 1, best.x, best.y);
    } else if (best.kind === 'crate') {
      h.channel = { kind: 'crate', t: 0, total: Math.round(1.5 * TICK_RATE), target: best.id };
      h.cast = null; h.charging = null;
    }
  }

  private updateNeutrals() {
    const w = this.w;
    for (const n of w.neutrals) {
      if (!n.alive) {
        if (w.tick >= n.respawnAt && (!this.zs || !outsideZone(this.zs, n.hx, n.hy))) {
          n.alive = true; n.hp = n.maxHp; n.x = n.hx; n.y = n.hy; n.aggro = 0;
        }
        continue;
      }
      if (this.zs && outsideZone(this.zs, n.x, n.y) && this.zs.stage >= 2) { n.alive = false; n.respawnAt = w.tick + 45 * TICK_RATE; w.ev(Fx.Death, n.id, 0, n.x, n.y, 0, 1); continue; }
      let t = n.aggro ? w.hero(n.aggro) : undefined;
      if (t && (t.state !== 'play' || dist(n.hx, n.hy, t.m.x, t.m.y) > 13 || !canSeePoint(w, n.x, n.y, t.m.x, t.m.y))) { n.aggro = 0; t = undefined; }
      if (!t) {
        let bd = 5.5;
        for (const h of w.heroes) {
          if (h.state !== 'play' || h.st.stealthT > 0) continue;
          const d = dist(n.x, n.y, h.m.x, h.m.y);
          if (d < bd && canSeePoint(w, n.x, n.y, h.m.x, h.m.y)) { bd = d; t = h; }
        }
        if (t) n.aggro = t.id;
      }
      if (t) {
        const dx = t.m.x - n.x, dy = t.m.y - n.y, d = Math.hypot(dx, dy) || 1;
        n.facing = Math.atan2(dy, dx);
        if (d > 6) { n.x += (dx / d) * 3 / TICK_RATE; n.y += (dy / d) * 3 / TICK_RATE; }
        if (--n.shotCd <= 0) {
          n.shotCd = Math.round(1.15 * TICK_RATE);
          spawnSimpleProjectile(w, 0, n.x + (dx / d) * 0.6, n.y + (dy / d) * 0.6, dx / d, dy / d, 14, 9, 0.35, 24, 'drone', { neutral: true });
          n.anim = 1; n.animSeq = (n.animSeq + 1) & 255;
        }
      } else {
        const dx = n.hx - n.x, dy = n.hy - n.y, d = Math.hypot(dx, dy);
        if (d > 0.2) { n.x += (dx / d) * Math.min(d, 4 / TICK_RATE); n.y += (dy / d) * Math.min(d, 4 / TICK_RATE); }
        n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.08 / TICK_RATE);
        n.facing += 0.02;
      }
    }
  }

  private updatePickups() {
    const w = this.w;
    for (const p of w.pickups) {
      if (p.kind !== 'core' || p.used) continue;
      p.t++;
      for (const h of w.heroes) {
        if (h.state !== 'play') continue;
        if ((h.m.x - p.x) ** 2 + (h.m.y - p.y) ** 2 < 1.3) {
          p.used = true;
          gainXp(w, h, p.xp);
          w.ev(Fx.Pickup, h.id, 0, p.x, p.y);
          break;
        }
      }
      if (!p.used && this.zs && this.zs.stage >= 1 && outsideZone(this.zs, p.x, p.y)) p.used = true;
    }
    if (w.tick % 30 === 0) w.pickups = w.pickups.filter(p => !(p.used && p.kind === 'core'));
    if (!w.practice) {
      this.coreTimer++;
      if (this.coreTimer >= 2.5 * TICK_RATE) {
        this.coreTimer = 0;
        const active = w.pickups.filter(p => p.kind === 'core' && !p.used).length;
        if (active < 16) this.spawnCore(this.zs ? this.zs.r : MAP_RADIUS);
      }
    }
  }

  private updateZoneDamage() {
    const z = this.zs, w = this.w;
    if (!z || this.phase !== 'play') return;
    if (w.tick % 15 !== 0) return;
    for (const h of w.heroes) {
      if (h.state !== 'play') continue;
      if (outsideZone(z, h.m.x, h.m.y)) dealDamage(w, null, h, z.dps * 0.5, { kind: 'zone', skillName: '데이터 붕괴' });
    }
  }

  private updateSupply() {
    const w = this.w;
    for (const s of this.supply) {
      if (s.state === 0 && this.zoneTime >= s.at - SUPPLY_WARN) {
        const fz = w.zone ? zoneAt(w.zone, s.at + 20) : null;
        const cx = fz ? fz.x : 0, cy = fz ? fz.y : 0, rr = fz ? Math.max(1, fz.r * 0.6) : 15;
        const a = w.rng.range(0, Math.PI * 2), r = Math.sqrt(w.rng.next()) * rr;
        const spot = findFreeSpot(w.map, w.alive, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.0);
        s.x = spot.x; s.y = spot.y; s.state = 1;
        w.msgs.push({ to: 'all', type: 'supplyWarn', x: s.x, y: s.y, t: SUPPLY_WARN });
        w.msgs.push({ to: 'all', type: 'announce', text: '기업 보급품 낙하 예고! 15초 후 투하', tone: 'supply' });
      } else if (s.state === 1 && this.zoneTime >= s.at) {
        const id = w.allocId();
        w.pickups.push({ id, kind: 'crate', x: s.x, y: s.y, xp: 0, used: false, t: 0 });
        s.pickupId = id; s.state = 2;
        w.ev(Fx.Supply, id, 0, s.x, s.y);
      }
    }
  }

  private updatePassives() {
    const w = this.w;
    for (const h of w.heroes) {
      if (h.state !== 'play') continue;
      if (h.stats.regen > 0 && w.tick - h.lastDamagedTick > 4 * TICK_RATE && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp * h.stats.regen) / TICK_RATE);
      if (w.tick - h.lastDamagedTick > OOC_REGEN.delay * TICK_RATE && w.tick - h.lastDealtTick > OOC_REGEN.delay * TICK_RATE && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + (h.maxHp * OOC_REGEN.pctPerSec) / TICK_RATE);
      if (h.stats.autoBolt > 0 && w.tick >= h.autoBoltTick) {
        let best: Hero | null = null, bd = 6;
        for (const e of w.heroes) {
          if (!w.targetable(e, h) || !this.visible(h.id, e.id)) continue;
          const d = dist(h.m.x, h.m.y, e.m.x, e.m.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          w.ev(Fx.Bolt, h.id, best.id, best.m.x, best.m.y);
          dealDamage(w, h, best, h.stats.autoBolt, { kind: 'storm', skillName: '데이터 폭풍' });
          h.autoBoltTick = w.tick + Math.round(2.5 * TICK_RATE);
        }
      }
      // 궁극기 자연 충전
      if (w.tick % TICK_RATE === 0) h.ult = Math.min(1, h.ult + ULT_PASSIVE_PER_SEC * (1 + h.stats.ult));
    }
  }

  private autoPickAugments() {
    const w = this.w;
    for (const h of w.heroes) {
      if (h.pending.length && w.tick >= h.pending[0].deadline) chooseAugment(w, h, w.rng.int(0, h.pending[0].options.length - 1));
    }
  }

  private practiceUpkeep() {
    const w = this.w;
    for (const h of w.heroes) {
      if (h.dummy) {
        if (h.state === 'dead' && w.tick - h.deathTick > 60) {
          h.state = 'play'; h.hp = h.maxHp; h.st.dots = []; h.st.slows = [];
        } else if (h.state === 'play' && w.tick - h.lastDamagedTick > 90) h.hp = h.maxHp;
      } else if (h.state === 'play' && h.hp < h.maxHp && w.tick - h.lastDamagedTick > 60) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.02);
    }
  }

  private checkEnd() {
    if (this.cfg.mode === 'practice' || this.phase !== 'play') return;
    const w = this.w;
    const alive = aliveCount(w);
    if (alive <= 1) {
      const last = w.heroes.find(h => h.state !== 'dead');
      if (last) { last.placement = 1; this.winner = last.id; }
      else { const best = w.heroes.reduce((a, b) => (a.placement < b.placement ? a : b)); best.placement = 1; this.winner = best.id; }
      this.phase = 'end'; this.endTick = w.tick;
      const win = w.hero(this.winner)!;
      w.msgs.push({ to: 'all', type: 'announce', text: `${win.name} — 최후의 1인!`, tone: 'win' });
      w.msgs.push({ to: 'all', type: 'end', winner: this.winner });
    }
    // 안전장치: 너무 오래 끌면 구역이 끝낸다
    if (this.zoneTime > 420 && this.phase === 'play') {
      for (const h of w.heroes) if (h.state === 'play') dealDamage(w, null, h, 90, { kind: 'zone' });
    }
  }

  /** 결과 요약 */
  results() {
    const w = this.w;
    return w.heroes.map(h => ({
      id: h.id, pid: h.pid, name: h.name, heroId: h.heroId, isBot: h.isBot,
      placement: h.placement || 1, kills: h.kills, damage: Math.round(h.damageDealt),
      survival: Math.round(((h.state === 'dead' ? h.deathTick : w.tick) - this.startTick) / TICK_RATE),
      augments: [...h.augments], level: h.level,
    })).sort((a, b) => a.placement - b.placement);
  }

  scoreboard() {
    return this.w.heroes.map(h => ({ id: h.id, name: h.name, heroId: h.heroId, level: h.level, kills: h.kills, alive: h.state !== 'dead', augments: h.augments, placement: h.placement, title: h.cos.title, bot: h.isBot }));
  }
}

export { clamp, recomputeHero };
