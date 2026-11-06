import type { AugmentDef, Stats, Tier } from './types';

/** 기본 스탯 (증강이 이 값에 더해진다) */
export const BASE_STATS: Stats = {
  dmg: 0, hp: 0, cdr: 0, speed: 0, atkSpeed: 0, dodgeCd: 0, xp: 0, regen: 0, ult: 0, lifesteal: 0, proj: 0, armor: 0, size: 0,
  killHeal: 0, lowShield: 0, thirdBolt: 0, dashEmpower: 0, burn: 0, skillSlow: 0, execute: 0, killHaste: 0, dodgeHaste: 0,
  skillRefund: 0, rage: 0, opener: 0, reflect: 0, undying: 0, killBlast: 0, freeCast: 0, ultReset: 0, overheal: 0,
  dodgeDmg: 0, dodgeDist: 0, autoBolt: 0, stealthReset: 0,
};

export const STAT_CAPS: Partial<Record<keyof Stats, number>> = { cdr: 0.45, armor: 0.45, lifesteal: 0.3, dodgeCd: 0.7, freeCast: 0.35 };

/** 레벨별 증강 등급 확률 [실버, 골드, 프리즘] (인덱스 = 레벨) */
export const TIER_ODDS: [number, number, number][] = [
  [1, 0, 0], [1, 0, 0],
  [0.72, 0.25, 0.03], [0.62, 0.32, 0.06], [0.5, 0.4, 0.1], [0.38, 0.46, 0.16], [0.28, 0.5, 0.22], [0.2, 0.5, 0.3],
];
export const TIER_NAMES: Record<Tier, string> = { silver: '실버', gold: '골드', prism: '프리즘' };
export const HERO_AUG_CHANCE = 0.3; // 카드 한 장이 영웅 전용 증강일 확률 (해당 등급에 남은 것이 있을 때)

export const AUGMENTS: AugmentDef[] = [
  // ───── 실버: 스탯 ─────
  { id: 'servo', name: '강화 서보', desc: '공격력 +10%', tier: 'silver', stats: { dmg: 0.1 }, tags: ['공격'], icon: '⚔' },
  { id: 'nanoarmor', name: '나노 장갑', desc: '최대 체력 +12%', tier: 'silver', stats: { hp: 0.12 }, tags: ['생존'], icon: '⛨' },
  { id: 'overclock', name: '오버클럭', desc: '스킬 쿨타임 -10%', tier: 'silver', stats: { cdr: 0.1 }, tags: ['쿨감'], icon: '⟳' },
  { id: 'lightframe', name: '경량 프레임', desc: '이동 속도 +7%', tier: 'silver', stats: { speed: 0.07 }, tags: ['기동'], icon: '➶' },
  { id: 'neural', name: '신경 가속', desc: '기본 공격 속도 +15%', tier: 'silver', stats: { atkSpeed: 0.15 }, tags: ['기본공격'], icon: '⚡' },
  { id: 'evasion', name: '회피 회로', desc: '구르기 쿨타임 -30%', tier: 'silver', stats: { dodgeCd: 0.3 }, tags: ['구르기'], icon: '↯' },
  { id: 'absorb', name: '데이터 흡수', desc: '경험치 획득 +40%, 이동 속도 +3%', tier: 'silver', stats: { xp: 0.4, speed: 0.03 }, tags: ['성장'], icon: '◈' },
  { id: 'regen', name: '재생 셀', desc: '4초간 피해를 받지 않으면 초당 체력 2.5% 재생', tier: 'silver', stats: { regen: 0.025 }, tags: ['생존'], icon: '✚' },
  { id: 'ultamp', name: '궁극 증폭기', desc: '궁극기 충전 속도 +30%', tier: 'silver', stats: { ult: 0.3 }, tags: ['궁극기'], icon: '✦' },
  { id: 'leech', name: '흡혈 코드', desc: '가한 피해의 7% 회복', tier: 'silver', stats: { lifesteal: 0.07 }, tags: ['흡혈'], icon: '♥' },
  { id: 'scope', name: '정밀 조준', desc: '투사체 속도와 사거리 +12%', tier: 'silver', stats: { proj: 0.12 }, tags: ['투사체'], icon: '⌖' },
  { id: 'plating', name: '반응 장갑', desc: '받는 피해 -8%', tier: 'silver', stats: { armor: 0.08 }, tags: ['생존'], icon: '▣' },
  // ───── 골드: 효과 ─────
  { id: 'killheal', name: '처치 회로', desc: '적 처치 시 최대 체력의 30% 회복', tier: 'gold', stats: { killHeal: 0.3 }, tags: ['처치', '생존'], icon: '✪' },
  { id: 'emshield', name: '비상 보호막', desc: '체력 30% 이하가 되면 최대 체력 28% 보호막 (20초 쿨)', tier: 'gold', stats: { lowShield: 0.28 }, tags: ['생존'], icon: '◎' },
  { id: 'thunder', name: '삼연 번개', desc: '기본 공격 3타마다 주변 적 2명에게 번개 65 피해', tier: 'gold', stats: { thirdBolt: 65 }, tags: ['기본공격', '번개'], icon: 'ϟ' },
  { id: 'dashcharge', name: '돌진 충전', desc: '이동기(E) 사용 후 다음 기본 공격 피해 +90%', tier: 'gold', stats: { dashEmpower: 0.9 }, tags: ['기동', '기본공격'], icon: '⇶' },
  { id: 'burn', name: '화상 탄두', desc: '스킬 적중 시 3초간 초당 16 화상 피해', tier: 'gold', stats: { burn: 16 }, tags: ['스킬', '지속피해'], icon: '♨' },
  { id: 'frost', name: '냉각 코팅', desc: '스킬 적중 시 1초간 25% 둔화', tier: 'gold', stats: { skillSlow: 0.25 }, tags: ['스킬', '제어'], icon: '❄' },
  { id: 'execute', name: '처형자', desc: '체력 30% 이하의 적에게 주는 피해 +22%', tier: 'gold', stats: { execute: 0.22 }, tags: ['공격', '처치'], icon: '☠' },
  { id: 'hunt', name: '사냥 본능', desc: '처치 시 4초간 이동 속도 +35%', tier: 'gold', stats: { killHaste: 0.35 }, tags: ['처치', '기동'], icon: '➹' },
  { id: 'afterimage', name: '잔상 질주', desc: '구르기 후 1.2초간 이동 속도 +40%', tier: 'gold', stats: { dodgeHaste: 0.4 }, tags: ['구르기', '기동'], icon: '≋' },
  { id: 'combo', name: '스킬 연계', desc: '스킬 적중 시 다른 스킬 쿨타임 0.6초 감소', tier: 'gold', stats: { skillRefund: 0.6 }, tags: ['스킬', '쿨감'], icon: '∞' },
  { id: 'stim', name: '전투 자극제', desc: '피해를 받을 때마다 3초간 공격력 +5% (최대 5중첩)', tier: 'gold', stats: { rage: 0.05 }, tags: ['공격', '생존'], icon: '✸' },
  { id: 'opener', name: '전투 개시자', desc: '5초간 피해를 주지 않았다면 다음 공격 피해 +65%', tier: 'gold', stats: { opener: 0.65 }, tags: ['공격'], icon: '➤' },
  { id: 'thorns', name: '가시 장갑', desc: '받은 피해의 18%를 공격자에게 반사', tier: 'gold', stats: { reflect: 0.18 }, tags: ['생존'], icon: '✷' },
  { id: 'rollstrike', name: '충격 구르기', desc: '구르기 거리 +35%, 구르기 경로의 적에게 50 피해', tier: 'gold', stats: { dodgeDist: 0.35, dodgeDmg: 50 }, tags: ['구르기'], icon: '◐' },
  // ───── 프리즘: 판도를 바꾸는 효과 ─────
  { id: 'overdrive', name: '오버드라이브', desc: '공격력 +18%, 스킬 쿨타임 -15%', tier: 'prism', stats: { dmg: 0.18, cdr: 0.15 }, tags: ['공격', '쿨감'], icon: '☄' },
  { id: 'undying', name: '불사 프로토콜', desc: '치명상을 입으면 1회 2초간 무적이 되고 체력 30%로 버틴다', tier: 'prism', stats: { undying: 1 }, tags: ['생존'], icon: '☥' },
  { id: 'chainblast', name: '연쇄 폭발', desc: '적 처치 시 시체가 폭발해 반경 4.5m에 160 피해', tier: 'prism', stats: { killBlast: 160 }, tags: ['처치'], icon: '✹' },
  { id: 'quantum', name: '양자 이중화', desc: '스킬 사용 시 25% 확률로 쿨타임을 소모하지 않는다', tier: 'prism', stats: { freeCast: 0.25 }, tags: ['스킬', '쿨감'], icon: '⧉' },
  { id: 'ultloop', name: '궁극 회로', desc: '궁극기 사용 시 모든 스킬 쿨타임 초기화, 궁극기 충전 +20%', tier: 'prism', stats: { ultReset: 1, ult: 0.2 }, tags: ['궁극기', '쿨감'], icon: '✺' },
  { id: 'titan', name: '거인화', desc: '최대 체력 +26%, 받는 피해 -5%, 크기 +15%, 이동 속도 -5%', tier: 'prism', stats: { hp: 0.26, armor: 0.05, size: 0.15, speed: -0.05 }, tags: ['생존'], icon: '⬢' },
  { id: 'vampire', name: '흡혈 군주', desc: '흡혈 +14%, 초과 회복은 보호막으로 전환', tier: 'prism', stats: { lifesteal: 0.14, overheal: 1 }, tags: ['흡혈', '생존'], icon: '♛' },
  { id: 'storm', name: '데이터 폭풍', desc: '2.5초마다 주변 6m 안의 적 1명에게 자동 번개 55 피해', tier: 'prism', stats: { autoBolt: 55 }, tags: ['번개'], icon: '⛈' },

  // ───── 영웅 전용 ─────
  { id: 'hd_a1', hero: 'hammerdog', name: '강화 유압', desc: '유압 돌진 거리 +3m, 기절 시간 +0.5초', tier: 'gold', tags: ['기동', '제어'], icon: '⛓',
    patches: [{ skill: 3, path: 'actions.0.dist', op: 'add', value: 3 }, { skill: 3, path: 'range', op: 'add', value: 3 }, { skill: 3, path: 'actions.0.onHit.0.dur', op: 'add', value: 0.5 }] },
  { id: 'hd_a2', hero: 'hammerdog', name: '여진', desc: '지면 강타가 0.6초 후 한 번 더 발동한다', tier: 'gold', tags: ['스킬'], icon: '≈',
    patches: [{ skill: 2, path: 'repeat', op: 'set', value: { count: 2, interval: 0.6 } }] },
  { id: 'hd_a3', hero: 'hammerdog', name: '중력 해머', desc: '낙하 해머 범위 +40%, 시전 시 220 보호막', tier: 'prism', tags: ['궁극기', '생존'], icon: '⚒',
    patches: [{ skill: 4, path: 'actions.0.radius', op: 'mul', value: 1.4 }, { skill: 4, path: 'indicator.radius', op: 'mul', value: 1.4 }, { skill: 4, path: 'actions.1.radius', op: 'mul', value: 1.25 },
      { skill: 4, path: 'actions', op: 'push', value: { t: 'buff', shield: { amt: 220, dur: 4 } } }] },
  { id: 'rl_a1', hero: 'redline', name: '흡혈 톱날', desc: '회전 베기 피해의 45%만큼 회복', tier: 'gold', tags: ['흡혈'], icon: '✂',
    patches: [{ skill: 1, path: 'actions.0.lifesteal', op: 'set', value: 0.45 }] },
  { id: 'rl_a2', hero: 'redline', name: '부메랑 체인', desc: '체인 블레이드가 끝에 도달하면 되돌아온다', tier: 'gold', tags: ['스킬'], icon: '↺',
    patches: [{ skill: 2, path: 'actions.0.returns', op: 'set', value: true }] },
  { id: 'rl_a3', hero: 'redline', name: '니트로', desc: '번아웃 2회 충전, 피해 +30', tier: 'prism', tags: ['기동'], icon: '⛽',
    patches: [{ skill: 3, path: 'charges', op: 'set', value: 2 }, { skill: 3, path: 'actions.0.dmg', op: 'add', value: 30 }] },
  { id: 'mr_a1', hero: 'mirage', name: '그림자 수확', desc: '은신 중 또는 은신 해제 후 1.5초 안에 처치하면 모든 스킬 쿨타임 초기화', tier: 'prism', tags: ['처치', '쿨감'], icon: '☾',
    stats: { stealthReset: 1 } },
  { id: 'mr_a2', hero: 'mirage', name: '삼중 수리검', desc: '수리검을 부채꼴로 3개 던진다', tier: 'gold', tags: ['스킬'], icon: '✶',
    patches: [{ skill: 1, path: 'actions.0.count', op: 'set', value: 3 }, { skill: 1, path: 'actions.0.spread', op: 'set', value: 16 }] },
  { id: 'mr_a3', hero: 'mirage', name: '무한 잔상', desc: '천 개의 잔상 타격 횟수 +3', tier: 'prism', tags: ['궁극기'], icon: '❖',
    patches: [{ skill: 4, path: 'actions.0.count', op: 'add', value: 3 }] },
  { id: 'sk_a1', hero: 'silk', name: '덫 공장', desc: '나노 덫 최대 5개, 쿨타임 -2초', tier: 'gold', tags: ['스킬'], icon: '⌘',
    patches: [{ skill: 1, path: 'actions.0.max', op: 'set', value: 5 }, { skill: 1, path: 'cd', op: 'add', value: -2 }] },
  { id: 'sk_a2', hero: 'silk', name: '강철 와이어', desc: '와이어 스윙 후 130 보호막', tier: 'gold', tags: ['생존', '기동'], icon: '⛨',
    patches: [{ skill: 3, path: 'actions.0.endShield', op: 'set', value: 130 }] },
  { id: 'sk_a3', hero: 'silk', name: '포식', desc: '거미줄 영역이 끝날 때 적을 중심으로 끌어당기며 130 피해', tier: 'prism', tags: ['궁극기', '제어'], icon: '❂',
    patches: [{ skill: 4, path: 'actions.0.endExplode', op: 'set', value: { radius: 8.5, dmg: 130, pullIn: 5 } }] },
  { id: 'ra_a1', hero: 'rail', name: '반사 회로', desc: '끝까지 충전한 차지 사격이 벽에 2회 반사된다', tier: 'prism', tags: ['스킬'], icon: '⟁',
    patches: [{ skill: 1, path: 'actions.0.bounceOnFull', op: 'set', value: 2 }] },
  { id: 'ra_a2', hero: 'rail', name: '이중 추진', desc: '후퇴 점프 2회 충전', tier: 'gold', tags: ['기동'], icon: '⇈',
    patches: [{ skill: 3, path: 'charges', op: 'set', value: 2 }] },
  { id: 'ra_a3', hero: 'rail', name: '연속 조사', desc: '궤도 레이저를 0.7초 간격으로 2번 발사한다', tier: 'prism', tags: ['궁극기'], icon: '☰',
    patches: [{ skill: 4, path: 'actions.0.count', op: 'set', value: 2 }, { skill: 4, path: 'actions.0.interval', op: 'set', value: 0.7 }] },
  { id: 'hv_a1', hero: 'hive', name: '드론 군단', desc: '전투 드론 최대 3대, 사격 속도 +33%', tier: 'gold', tags: ['스킬'], icon: '⬡',
    patches: [{ skill: 2, path: 'actions.0.max', op: 'set', value: 3 }, { skill: 2, path: 'actions.0.interval', op: 'mul', value: 0.75 }] },
  { id: 'hv_a2', hero: 'hive', name: '미사일 포드', desc: '마이크로 미사일 5발 발사', tier: 'gold', tags: ['스킬'], icon: '⋔',
    patches: [{ skill: 1, path: 'actions.0.count', op: 'set', value: 5 }, { skill: 1, path: 'actions.0.spread', op: 'set', value: 34 }] },
  { id: 'hv_a3', hero: 'hive', name: '융단 폭격', desc: '편대 폭격 폭탄 +5, 범위 +1m', tier: 'prism', tags: ['궁극기'], icon: '⁂',
    patches: [{ skill: 4, path: 'actions.0.count', op: 'add', value: 5 }, { skill: 4, path: 'actions.0.radius', op: 'add', value: 1 }, { skill: 4, path: 'indicator.radius', op: 'add', value: 1 }] },
  { id: 'gl_a1', hero: 'glitch', name: '연쇄 감염', desc: '봉인 코드가 근처 적 1명에게 튕긴다', tier: 'gold', tags: ['스킬', '제어'], icon: '⌬',
    patches: [{ skill: 1, path: 'actions.0.chain', op: 'set', value: { count: 1, range: 6, dmgMult: 0.8 } }] },
  { id: 'gl_a2', hero: 'glitch', name: '이중 해킹', desc: '해킹 장판 포탑의 사격 속도 +80%', tier: 'gold', tags: ['스킬'], icon: '⌗',
    patches: [{ skill: 2, path: 'actions.0.interval', op: 'mul', value: 0.55 }] },
  { id: 'gl_a3', hero: 'glitch', name: '커널 패닉', desc: '시스템 오버라이드 범위 +3m, 반전 시간 +1.5초', tier: 'prism', tags: ['궁극기', '제어'], icon: '⚠',
    patches: [{ skill: 4, path: 'actions.0.radius', op: 'add', value: 3 }, { skill: 4, path: 'indicator.radius', op: 'add', value: 3 }, { skill: 4, path: 'actions.0.onHit.0.dur', op: 'add', value: 1.5 }] },
  { id: 'hz_a1', hero: 'horizon', name: '사건의 지평선', desc: '특이점이 끝날 때 폭발해 반경 4.5m에 190 피해', tier: 'prism', tags: ['궁극기'], icon: '◉',
    patches: [{ skill: 4, path: 'actions.0.endExplode', op: 'set', value: { radius: 4.5, dmg: 190 } }] },
  { id: 'hz_a2', hero: 'horizon', name: '관성 서핑', desc: '중력장 안에서 자신의 이동 속도 +35%', tier: 'gold', tags: ['기동'], icon: '∿',
    patches: [{ skill: 1, path: 'actions.0.selfHaste', op: 'set', value: 0.35 }] },
  { id: 'hz_a3', hero: 'horizon', name: '충돌 계산', desc: '척력파로 벽에 부딪힌 적은 1.2초 기절', tier: 'gold', tags: ['제어'], icon: '⊠',
    patches: [{ skill: 2, path: 'actions.0.onHit.0.wallStun', op: 'set', value: 1.2 }] },
];

export const AUGMENT_BY_ID: Record<string, AugmentDef> = Object.fromEntries(AUGMENTS.map(a => [a.id, a]));
export const AUGMENT_INDEX: Record<string, number> = Object.fromEntries(AUGMENTS.map((a, i) => [a.id, i]));
