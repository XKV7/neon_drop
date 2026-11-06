import { HEROES } from './heroes';
import type { HeroId } from './types';

export interface Palette { name: string; c1: number; c2: number; body: number }
export interface ShopItem { id: string; kind: 'palette' | 'skin' | 'kill' | 'drop' | 'emote' | 'title'; name: string; price: number; hero?: HeroId; idx: number; desc: string }

const PALETTE_POOL: Palette[] = [
  { name: '크롬 펄스', c1: 0xe8f6ff, c2: 0x22f3ff, body: 0x6b7382 },
  { name: '독성 폐기물', c1: 0x9dff2b, c2: 0xffe14d, body: 0x2b3322 },
  { name: '황혼 신스', c1: 0xff7a1a, c2: 0xff2bd6, body: 0x2c1a33 },
  { name: '핏빛 네온', c1: 0xff1f3d, c2: 0xff9a9a, body: 0x240d12 },
  { name: '딥 사이언', c1: 0x00e1ff, c2: 0x3d7bff, body: 0x0f1d2e },
  { name: '로열 퍼플', c1: 0xb36bff, c2: 0xffd84d, body: 0x1f1430 },
  { name: '골든 코어', c1: 0xffd700, c2: 0xffffff, body: 0x332a12 },
  { name: '빙결 프로토콜', c1: 0xbfefff, c2: 0x7ad7ff, body: 0x24323d },
];

/** 영웅별 팔레트: 0번은 기본, 1~4번 상점 판매 */
export function heroPalettes(hero: HeroId): Palette[] {
  const h = HEROES.find(x => x.id === hero)!;
  const list: Palette[] = [{ name: '기본', c1: h.color, c2: h.color2, body: 0x1d2030 }];
  for (let k = 0; k < 4; k++) list.push(PALETTE_POOL[(h.index * 3 + k * 2) % PALETTE_POOL.length]);
  return list;
}

export const SKIN_NAMES: Record<HeroId, string[]> = {
  hammerdog: ['기본', '중장갑 폭동진압', '야간 순찰'],
  redline: ['기본', '레이서 헬멧', '해골 라이더'],
  mirage: ['기본', '여우 가면', '사무라이 투구'],
  silk: ['기본', '여왕 거미', '크롬 독거미'],
  rail: ['기본', '스텔스 망토', '중포병'],
  hive: ['기본', '정찰 고글', '공수 부대'],
  glitch: ['기본', '스트리머', '바이러스'],
  horizon: ['기본', '궤도 연구원', '암흑 물질'],
};

export const KILL_EFFECTS = ['디지털 분해', '네온 폭죽', '글리치 붕괴', '번개 낙인', '픽셀 하트'];
export const DROP_EFFECTS = ['기본 낙하', '유성 낙하', '홀로그램 전송', '번개 강하', '분홍 혜성'];
export const EMOTES = [
  { name: '손 흔들기', text: '👋' }, { name: '도발', text: '덤벼!' }, { name: '춤', text: '♪' },
  { name: '박수', text: '👏' }, { name: '분노', text: '💢' }, { name: '하트', text: '💖' },
];
export const TITLES = ['신입 참가자', '네온 사냥꾼', '구역의 지배자', '데이터 유령', '불사신', '데스게임 스타', '최후의 1인', '붕괴 생존자', '메가코프의 적', '신서울 전설'];

export const QUICK_CHATS = ['GG', '도망쳐!', '덤벼', '도와줘!', '조심해!', '잘했어', '고마워', '하하'];

export const STARTING_CREDITS = 400;
export const CREDIT_RULES = {
  placement: [0, 200, 140, 110, 90, 75, 60, 50, 40, 32, 25],
  perKill: 18,
  perSurvivalMinute: 12,
};

export function computeCredits(placement: number, kills: number, survivalSec: number): number {
  const base = CREDIT_RULES.placement[Math.max(1, Math.min(10, placement))] ?? 20;
  return Math.round(base + kills * CREDIT_RULES.perKill + (survivalSec / 60) * CREDIT_RULES.perSurvivalMinute);
}

export function buildShop(): ShopItem[] {
  const items: ShopItem[] = [];
  for (const h of HEROES) {
    heroPalettes(h.id).forEach((p, i) => { if (i > 0) items.push({ id: `pal:${h.id}:${i}`, kind: 'palette', name: p.name, price: 250, hero: h.id, idx: i, desc: `${h.name} 네온 색상` }); });
    SKIN_NAMES[h.id].forEach((s, i) => { if (i > 0) items.push({ id: `skin:${h.id}:${i}`, kind: 'skin', name: s, price: 600, hero: h.id, idx: i, desc: `${h.name} 스킨 변형` }); });
  }
  KILL_EFFECTS.forEach((n, i) => { if (i > 0) items.push({ id: `kill:${i}`, kind: 'kill', name: n, price: 400, idx: i, desc: '처치 효과' }); });
  DROP_EFFECTS.forEach((n, i) => { if (i > 0) items.push({ id: `drop:${i}`, kind: 'drop', name: n, price: 350, idx: i, desc: '낙하 효과' }); });
  EMOTES.forEach((e, i) => { if (i > 1) items.push({ id: `emote:${i}`, kind: 'emote', name: e.name, price: 200, idx: i, desc: `감정 표현 ${e.text}` }); });
  TITLES.forEach((t, i) => { if (i > 0) items.push({ id: `title:${i}`, kind: 'title', name: t, price: 150 + i * 60, idx: i, desc: '닉네임 칭호' }); });
  return items;
}

export const SHOP_ITEMS = buildShop();
export const SHOP_BY_ID: Record<string, ShopItem> = Object.fromEntries(SHOP_ITEMS.map(i => [i.id, i]));

/** 기본 보유 아이템 (무료) */
export function isFreeItem(id: string): boolean {
  return /^(pal|skin):[a-z]+:0$/.test(id) || id === 'kill:0' || id === 'drop:0' || id === 'emote:0' || id === 'emote:1' || id === 'title:0';
}

export interface Loadout { palette: Partial<Record<HeroId, number>>; skin: Partial<Record<HeroId, number>>; kill: number; drop: number; title: number; emotes: number[] }
export const DEFAULT_LOADOUT: Loadout = { palette: {}, skin: {}, kill: 0, drop: 0, title: 0, emotes: [0, 1] };

/** 판에 들어가는 플레이어별 꾸미기 정보 */
export interface Cosmetic { palette: number; skin: number; kill: number; drop: number; title: number; emotes: number[] }
export const DEFAULT_COSMETIC: Cosmetic = { palette: 0, skin: 0, kill: 0, drop: 0, title: 0, emotes: [0, 1] };

export const PROFANITY = ['씨발', '시발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새끼', '좆', '지랄', 'fuck', 'shit', 'bitch', '니애미', '느금마', '닥쳐', '꺼져', 'asshole', 'retard'];

export function filterChat(text: string): string {
  let out = text.slice(0, 120);
  for (const w of PROFANITY) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, '*'.repeat(w.length));
  }
  return out;
}

const BOT_PREFIX = ['Neon', 'Zero', 'Byte', 'Hex', 'Null', 'Vox', 'Kilo', 'Dusk', 'Volt', 'Ghost', 'Rogue', 'Static', 'Chrome', 'Pixel', 'Sync', 'Glyph', 'Proxy', 'Nova', 'Echo', 'Cipher'];
const BOT_SUFFIX = ['Fang', 'Wire', 'Drift', 'Spike', 'Shade', 'Core', 'Blade', 'Pulse', 'Jack', 'Viper', 'Rush', 'Loop', 'Bit', 'Wraith', 'Flux', 'Crash'];

export function botName(rng: () => number): string {
  const a = BOT_PREFIX[Math.floor(rng() * BOT_PREFIX.length)];
  const b = BOT_SUFFIX[Math.floor(rng() * BOT_SUFFIX.length)];
  const style = Math.floor(rng() * 4);
  const n = Math.floor(rng() * 99);
  if (style === 0) return `${a}${b}`;
  if (style === 1) return `${a}_${b}${n}`;
  if (style === 2) return `x${a}${b}x`;
  return `${a.toLowerCase()}.${b.toLowerCase()}`;
}
