/** 데이터 정의 타입. 모든 수치는 data/*.ts 에서만 정의된다 (코드 수정 없이 밸런싱). */

export type HeroId = 'hammerdog' | 'redline' | 'mirage' | 'silk' | 'rail' | 'hive' | 'glitch' | 'horizon';
export type Role = 'bruiser' | 'assassin' | 'ranged' | 'control';
export type Slot = 0 | 1 | 2 | 3 | 4; // 기본공격, 스킬1(우클릭), 스킬2(Q), 스킬3(E), 궁극기(R)

export type Effect =
  | { t: 'stun'; dur: number }
  | { t: 'slow'; pct: number; dur: number }
  | { t: 'root'; dur: number }
  | { t: 'silence'; dur: number }
  | { t: 'invert'; dur: number }
  | { t: 'knock'; dist: number; from?: 'caster' | 'center' | 'side'; wallStun?: number }
  | { t: 'pull'; dist: number }
  | { t: 'mark'; dur: number }
  | { t: 'dot'; dps: number; dur: number }
  | { t: 'reveal'; dur: number };

export type ProjVisual = 'bullet' | 'shock' | 'blade' | 'shuriken' | 'wire' | 'rail' | 'missile' | 'bolt' | 'code' | 'orb' | 'drone';
export type FxVisual = 'slam' | 'emp' | 'gravity' | 'spin' | 'web' | 'hack' | 'blackhole' | 'bomb' | 'override' | 'cone' | 'trap' | 'turret' | 'hammer';

export interface Explode { radius: number; dmg: number; onHit?: Effect[] }

export interface ProjectileAction {
  t: 'projectile';
  speed: number; range: number; radius: number; dmg: number;
  pierce?: number; count?: number; spread?: number;
  onHit?: Effect[]; explode?: Explode;
  bounce?: number; bounceOnFull?: number; returns?: boolean;
  chain?: { count: number; range: number; dmgMult: number };
  chargeScale?: { dmg: [number, number]; range: [number, number] };
  visual: ProjVisual;
}
export interface MeleeAction { t: 'melee'; range: number; angle: number; dmg: number; onHit?: Effect[] }
export interface DashAction {
  t: 'dash'; dist: number; speed: number;
  toPoint?: boolean; backward?: boolean; airborne?: boolean; untargetable?: boolean;
  hitRadius?: number; dmg?: number; onHit?: Effect[]; stopOnHit?: boolean;
  endAoe?: Explode; endShield?: number; haste?: { pct: number; dur: number }; empower?: number;
  wire?: { range: number; shortDist: number; clingBonus: number };
}
export interface BlinkAction { t: 'blink'; dist: number; trail?: { width: number; dmg: number; onHit?: Effect[] } }
export interface AoeAction { t: 'aoe'; at: 'self' | 'point'; radius: number; delay: number; dmg: number; cone?: number; onHit?: Effect[]; visual: FxVisual }
export interface ZoneAction {
  t: 'zone'; at: 'self' | 'point'; follow?: boolean; radius: number; duration: number; interval: number; dmg: number;
  delay?: number; onTick?: Effect[]; startEffects?: Effect[]; pull?: number; lifesteal?: number;
  endExplode?: Explode & { pullIn?: number }; selfHaste?: number; visual: FxVisual;
}
export interface BeamAction { t: 'beam'; length: number; width: number; delay: number; dmg: number; onHit?: Effect[]; count?: number; interval?: number }
export interface DeployAction {
  t: 'deploy'; kind: 'turret' | 'trap'; duration: number; max: number; range: number;
  interval?: number; dmg: number; projSpeed?: number; onHit?: Effect[]; arm?: number; zone?: boolean; visual: FxVisual;
}
export interface BuffAction { t: 'buff'; stealth?: number; haste?: { pct: number; dur: number }; shield?: { amt: number; dur: number }; ambush?: number }
export interface PullAllAction { t: 'pullAll'; radius: number; to: number }
export interface StrikesAction { t: 'strikes'; range: number; count: number; interval: number; dmg: number; onHit?: Effect[] }
export interface BombardAction { t: 'bombard'; radius: number; count: number; interval: number; delay: number; bombRadius: number; dmg: number; onHit?: Effect[] }
export interface AreaAllAction { t: 'areaAll'; radius: number; dmg: number; onHit?: Effect[]; visual: FxVisual }

export type Action =
  | ProjectileAction | MeleeAction | DashAction | BlinkAction | AoeAction | ZoneAction | BeamAction
  | DeployAction | BuffAction | PullAllAction | StrikesAction | BombardAction | AreaAllAction;

export type Indicator =
  | { shape: 'line'; width: number }
  | { shape: 'circle'; radius: number }
  | { shape: 'cone'; angle: number }
  | { shape: 'self'; radius: number };

export type AnimKind = 'punch' | 'slash' | 'shoot' | 'cast' | 'slam' | 'spin' | 'throw' | 'dash' | 'charge' | 'leap';

export interface SkillDef {
  id: string; name: string; desc: string;
  cd: number; charges?: number; cast: number; castMove?: number;
  target: 'dir' | 'point' | 'self';
  range: number; minRange?: number;
  indicator: Indicator;
  chargeUp?: { max: number; move: number };
  needsTarget?: boolean;
  repeat?: { count: number; interval: number };
  actions: Action[];
  anim: AnimKind;
  ai: { use: 'damage' | 'cc' | 'mobility' | 'zone' | 'buff' | 'engage'; range: number };
}

export interface HeroDef {
  id: HeroId; index: number; name: string; title: string; role: Role; difficulty: 1 | 2 | 3;
  hp: number; speed: number; ultReq: number; size: number;
  color: number; color2: number;
  basic: SkillDef; skills: [SkillDef, SkillDef, SkillDef]; ult: SkillDef;
  lines: string[]; lore: string; style: string;
}

export interface Stats {
  dmg: number; hp: number; cdr: number; speed: number; atkSpeed: number; dodgeCd: number; xp: number; regen: number;
  ult: number; lifesteal: number; proj: number; armor: number; size: number;
  killHeal: number; lowShield: number; thirdBolt: number; dashEmpower: number; burn: number; skillSlow: number;
  execute: number; killHaste: number; dodgeHaste: number; skillRefund: number; rage: number; opener: number;
  reflect: number; undying: number; killBlast: number; freeCast: number; ultReset: number; overheal: number;
  dodgeDmg: number; dodgeDist: number; autoBolt: number; stealthReset: number;
}

export type Tier = 'silver' | 'gold' | 'prism';

export interface Patch { skill: 0 | 1 | 2 | 3 | 4; path: string; op: 'set' | 'add' | 'mul' | 'push'; value: unknown }

export interface AugmentDef {
  id: string; name: string; desc: string; tier: Tier; hero?: HeroId;
  stats?: Partial<Stats>; patches?: Patch[]; tags: string[]; icon: string;
}
