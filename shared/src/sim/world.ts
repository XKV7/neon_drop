import type { Action, DashAction, DeployAction, HeroDef, HeroId, ProjectileAction, SkillDef, Stats, ZoneAction, ProjVisual, Explode, Effect } from '../data/types';
import type { Cosmetic } from '../data/cosmetics';
import { MapData } from './map';
import { MoveState } from './movement';
import { Rng } from './math';
import { HistoryBuffer } from './lagcomp';
import { ZoneSchedule } from './zone';

export const enum Btn { Basic = 1, S1 = 2, S2 = 4, S3 = 8, Ult = 16, Dodge = 32, Interact = 64 }
export const SLOT_BTN = [1, 2, 4, 8, 16];

export interface InputCmd {
  seq: number;
  mx: number; my: number;
  ax: number; ay: number;
  held: number; pressed: number;
  viewTick: number;
}
export const EMPTY_INPUT: InputCmd = { seq: 0, mx: 0, my: 0, ax: 0, ay: 0, held: 0, pressed: 0, viewTick: 0 };

export interface Timed { pct: number; t: number }
export interface Dot { dps: number; t: number; src: number }

export interface Status {
  stunT: number; rootT: number; silenceT: number; invertT: number;
  slows: Timed[]; hastes: Timed[];
  stealthT: number; untargetT: number; invulnT: number;
  markT: number; markBy: number; revealT: number;
  dots: Dot[];
  dodgeFrames: number;
  dmgBuffs: Timed[];
}

export function newStatus(): Status {
  return { stunT: 0, rootT: 0, silenceT: 0, invertT: 0, slows: [], hastes: [], stealthT: 0, untargetT: 0, invulnT: 0, markT: 0, markBy: 0, revealT: 0, dots: [], dodgeFrames: 0, dmgBuffs: [] };
}

export type HeroState = 'drop' | 'landing' | 'play' | 'dead';

export interface PendingAug { options: string[]; deadline: number; source: 'level' | 'supply' }

export interface DashState { act: DashAction; hit: number[]; slot: number; endAoe: boolean; wireCling: boolean }

export interface Hero {
  id: number; pid: string; name: string;
  heroId: HeroId; def: HeroDef; isBot: boolean; botLevel: number; dummy: boolean;
  cos: Cosmetic;
  m: MoveState; facing: number; radius: number;
  hp: number; maxHp: number; shield: number; shieldT: number;
  state: HeroState; landT: number; dropX: number; dropY: number;
  level: number; xp: number;
  cds: number[]; maxCds: number[]; charges: number[]; chargeMax: number[];
  ult: number;
  skills: SkillDef[];
  stats: Stats; augments: string[]; pending: PendingAug[];
  st: Status;
  cast: { slot: number; t: number; total: number; ax: number; ay: number } | null;
  charging: { slot: number; t: number } | null;
  channel: { kind: 'crate'; t: number; total: number; target: number } | null;
  input: InputCmd; lastSeq: number;
  anim: number; animSeq: number;
  dash: DashState | null;
  // 패시브 상태
  basicCount: number; lastDealtTick: number; lastDamagedTick: number; lowShieldReady: number; undyingUsed: boolean;
  empower: number; ambush: number; stealthEndTick: number; autoBoltTick: number;
  // 기록
  kills: number; damageDealt: number; damageTaken: number; deathTick: number; placement: number; killer: number;
  lastHitBy: number; lastHitTick: number; killTimes: number[]; streak: number; killSkill: string;
  disconnected: boolean; dcTick: number;
  emoteT: number;
  spawnTick: number;
  knockStun: number; lastBasicTick: number; queued: { slot: number; t: number } | null; ambushUntil: number;
  stealthSlot: number; dodgeHits: number[];
}

export interface Projectile {
  id: number; owner: number; x: number; y: number; dx: number; dy: number;
  speed: number; radius: number; rangeLeft: number; dmg: number; pierce: number; hit: number[];
  act: ProjectileAction | null; onHit: Effect[]; explode: Explode | null;
  bounce: number; returning: boolean; returns: boolean; chainLeft: number; visual: ProjVisual;
  slot: number; neutral: boolean; turret: boolean; lagTicks: number; full: boolean; skillName: string;
}

export interface Zone {
  id: number; owner: number; x: number; y: number; r: number; t: number; dur: number; interval: number;
  act: ZoneAction; slot: number; started: boolean; delay: number; skillName: string;
}

export interface Telegraph {
  id: number; owner: number; shape: 0 | 1 | 2; // 0=원, 1=부채꼴, 2=직선
  x: number; y: number; r: number; ang: number; len: number; w: number;
  t: number; delay: number; visual: number; fire: () => void;
}

export interface Deployable {
  id: number; owner: number; kind: 'turret' | 'trap'; x: number; y: number; t: number; dur: number;
  act: DeployAction; nextShot: number; armed: boolean; slot: number; facing: number;
}

export interface Neutral {
  id: number; x: number; y: number; hx: number; hy: number; hp: number; maxHp: number;
  aggro: number; shotCd: number; respawnAt: number; alive: boolean; facing: number; lastHitBy: number; anim: number; animSeq: number;
}

export interface Pickup { id: number; kind: 'core' | 'crate' | 'vending'; x: number; y: number; xp: number; used: boolean; t: number }

export interface SimEvent { k: number; a: number; b: number; x: number; y: number; p: number; f: number }

export const enum Fx {
  Dmg = 1, Heal = 2, Shield = 3, Death = 4, Cast = 5, Explode = 6, Blink = 7, Land = 8, LevelUp = 9, Destroy = 10,
  Spark = 11, Bolt = 12, Pickup = 13, Supply = 14, Dodge = 15, ProjHit = 16, Grab = 17, Emote = 18, Teleport = 20,
  Stealth = 21, Pad = 22, Beam = 23, Strike = 24, Revive = 25, Trap = 26, Wire = 27,
}

/** JSON으로 보내는 저빈도 메시지 */
export type MatchMsg =
  | { to: number | 'all'; type: 'feed'; killer: string; victim: string; skill: string; killerHero: string; victimHero: string }
  | { to: number | 'all'; type: 'announce'; text: string; tone: string }
  | { to: number; type: 'augOffer'; options: string[]; source: 'level' | 'supply'; deadline: number; queue: number }
  | { to: number; type: 'augGained'; id: string }
  | { to: number | 'all'; type: 'supplyWarn'; x: number; y: number; t: number }
  | { to: number; type: 'eliminated'; placement: number; killer: number }
  | { to: 'all'; type: 'end'; winner: number };

export interface ActionCtx {
  hero: Hero; slot: number; ax: number; ay: number; dx: number; dy: number; mult: number; lag: number; skill: SkillDef;
}

export class World {
  map: MapData;
  alive: Uint8Array; obHp: Float32Array; destroyed: number[] = [];
  tick = 0;
  heroes: Hero[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  telegraphs: Telegraph[] = [];
  deployables: Deployable[] = [];
  neutrals: Neutral[] = [];
  pickups: Pickup[] = [];
  events: SimEvent[] = [];
  msgs: MatchMsg[] = [];
  timers: { at: number; fn: () => void }[] = [];
  history: HistoryBuffer;
  rng: Rng;
  zone: ZoneSchedule | null = null;
  nextId = 100;
  practice = false;
  phaseStart = 0;
  playStart = 0;

  constructor(map: MapData, seed: number) {
    this.map = map;
    this.alive = new Uint8Array(map.obstacles.length).fill(1);
    this.obHp = new Float32Array(map.obstacles.length);
    map.obstacles.forEach(o => (this.obHp[o.id] = o.maxHp));
    this.rng = new Rng(seed ^ 0x5bd1e995);
    this.history = new HistoryBuffer();
  }

  allocId(): number {
    const id = this.nextId++;
    if (this.nextId > 65000) this.nextId = 100;
    return id;
  }

  hero(id: number): Hero | undefined { return id >= 1 && id <= this.heroes.length ? this.heroes[id - 1] : undefined; }

  ev(k: number, a: number, b: number, x: number, y: number, p = 0, f = 0) { this.events.push({ k, a, b, x, y, p, f }); }

  after(sec: number, fn: () => void) { this.timers.push({ at: this.tick + Math.max(1, Math.round(sec * 30)), fn }); }

  aliveHeroes(): Hero[] { return this.heroes.filter(h => h.state !== 'dead'); }

  /** 공격 대상이 될 수 있는 적 영웅 */
  targetable(h: Hero, by: Hero | null): boolean {
    if (h.state !== 'play') return false;
    if (by && h.id === by.id) return false;
    if (h.st.untargetT > 0) return false;
    return true;
  }

  enemiesInRadius(src: Hero | null, x: number, y: number, r: number): Hero[] {
    const out: Hero[] = [];
    for (const h of this.heroes) {
      if (!this.targetable(h, src)) continue;
      const rr = r + h.radius;
      if ((h.m.x - x) ** 2 + (h.m.y - y) ** 2 <= rr * rr) out.push(h);
    }
    return out;
  }
}

export type { Action, Stats, ZoneAction };
