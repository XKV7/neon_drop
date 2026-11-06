/** 플레이어 설정 (브라우저 저장소, 접근 실패 시 기본값) */
export type Quality = 'low' | 'mid' | 'high';
export interface Settings {
  quality: Quality; master: number; music: number; sfx: number; smartCast: boolean; shake: boolean; dmgNumbers: boolean; chat: boolean;
  keys: Record<string, string>;
}

export const ACTIONS: { id: string; label: string }[] = [
  { id: 'up', label: '위로 이동' }, { id: 'down', label: '아래로 이동' }, { id: 'left', label: '왼쪽 이동' }, { id: 'right', label: '오른쪽 이동' },
  { id: 'basic', label: '기본 공격' }, { id: 's1', label: '스킬 1' }, { id: 's2', label: '스킬 2' }, { id: 's3', label: '스킬 3 (이동기)' }, { id: 'ult', label: '궁극기' },
  { id: 'dodge', label: '구르기' }, { id: 'interact', label: '상호작용' }, { id: 'score', label: '점수판' }, { id: 'chat', label: '채팅' }, { id: 'wheel', label: '퀵 채팅/감정 표현' },
];

export const DEFAULT_KEYS: Record<string, string> = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', basic: 'Mouse0', s1: 'Mouse2', s2: 'KeyQ', s3: 'KeyE', ult: 'KeyR',
  dodge: 'Space', interact: 'KeyF', score: 'Tab', chat: 'Enter', wheel: 'KeyT',
};

export function guessQuality(): Quality {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (/Mobi|Android/i.test(navigator.userAgent) || mem <= 2 || cores <= 2) return 'low';
  return 'mid';
}

export const settings: Settings = {
  quality: guessQuality(), master: 0.8, music: 0.5, sfx: 0.8, smartCast: true, shake: true, dmgNumbers: true, chat: true, keys: { ...DEFAULT_KEYS },
};

export function storageGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function storageSet(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* 저장 불가 환경 */ }
}
export function storageDel(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* 저장 불가 환경 */ }
}

export function loadSettings() {
  const raw = storageGet('neon.settings');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    Object.assign(settings, s, { keys: { ...DEFAULT_KEYS, ...(s.keys ?? {}) } });
  } catch { /* 손상된 설정 무시 */ }
}

export function saveSettings() { storageSet('neon.settings', JSON.stringify(settings)); }

export function keyLabel(code: string): string {
  if (code === 'Mouse0') return '좌클릭';
  if (code === 'Mouse1') return '휠클릭';
  if (code === 'Mouse2') return '우클릭';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: 'Space', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', Tab: 'Tab', Enter: 'Enter', Backquote: '`' };
  return map[code] ?? code;
}

export const urlParams = new URLSearchParams(location.search);
export const netSim = {
  lag: Math.max(0, Math.min(1000, Number(urlParams.get('lag') ?? 0) || 0)),
  loss: Math.max(0, Math.min(50, Number(urlParams.get('loss') ?? 0) || 0)),
};
