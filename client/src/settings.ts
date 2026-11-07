/** 플레이어 설정 (브라우저 저장소, 접근 실패 시 기본값) */
export type Quality = 'low' | 'mid' | 'high';
export interface Settings {
  quality: Quality; master: number; music: number; sfx: number; smartCast: boolean; shake: boolean; dmgNumbers: boolean; chat: boolean;
  keys: Record<string, string>;
}

export const ACTIONS: { id: string; label: string; group: string }[] = [
  { id: 'up', label: '위로 이동', group: '이동' }, { id: 'down', label: '아래로 이동', group: '이동' }, { id: 'left', label: '왼쪽 이동', group: '이동' }, { id: 'right', label: '오른쪽 이동', group: '이동' },
  { id: 'dodge', label: '구르기', group: '이동' },
  { id: 'basic', label: '기본 공격 / 조준 확인', group: '전투' }, { id: 's1', label: '스킬 1', group: '전투' }, { id: 's2', label: '스킬 2', group: '전투' }, { id: 's3', label: '스킬 3 (이동기)', group: '전투' }, { id: 'ult', label: '궁극기', group: '전투' },
  { id: 'interact', label: '상호작용', group: '기타' }, { id: 'score', label: '점수판 (누르고 있기)', group: '기타' }, { id: 'chat', label: '채팅', group: '기타' }, { id: 'wheel', label: '퀵 채팅/감정 표현 (누르고 있기)', group: '기타' },
];

/** 다른 기능에 고정된 키 (재설정 불가) */
export const RESERVED_KEYS: Record<string, string> = { Escape: '메뉴/취소', F3: '디버그', Digit1: '증강 선택 1', Digit2: '증강 선택 2', Digit3: '증강 선택 3' };

/**
 * 키 지정. 이미 다른 기능에 쓰이는 키면 두 기능의 키를 서로 바꾼다.
 * 반환: { ok, swapped(바뀐 다른 기능 id), reason }
 */
export function bindKey(action: string, code: string): { ok: boolean; swapped?: string; reason?: string } {
  if (!(action in DEFAULT_KEYS)) return { ok: false, reason: '알 수 없는 기능' };
  if (RESERVED_KEYS[code]) return { ok: false, reason: `${keyLabel(code)}는 ${RESERVED_KEYS[code]} 전용 키입니다` };
  const prev = settings.keys[action];
  if (prev === code) return { ok: true };
  const other = Object.keys(settings.keys).find(a => a !== action && settings.keys[a] === code);
  settings.keys[action] = code;
  if (other) settings.keys[other] = prev;
  saveSettings();
  return { ok: true, swapped: other };
}

export function actionLabel(id: string) { return ACTIONS.find(a => a.id === id)?.label ?? id; }

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
    // 손상되었거나 중복된 키 설정은 기본값으로 복구
    const used = new Set<string>();
    for (const a of Object.keys(DEFAULT_KEYS)) {
      const c = settings.keys[a];
      if (typeof c !== 'string' || !c || used.has(c) || RESERVED_KEYS[c]) settings.keys[a] = DEFAULT_KEYS[a];
      used.add(settings.keys[a]);
    }
    for (const a of Object.keys(settings.keys)) if (!(a in DEFAULT_KEYS)) delete settings.keys[a];
  } catch { /* 손상된 설정 무시 */ }
}

export function saveSettings() { storageSet('neon.settings', JSON.stringify(settings)); }

export function keyLabel(code: string): string {
  const mouse: Record<string, string> = { Mouse0: '좌클릭', Mouse1: '휠클릭', Mouse2: '우클릭', Mouse3: '마우스4', Mouse4: '마우스5' };
  if (mouse[code]) return mouse[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '넘패드 ' + code.slice(6);
  const map: Record<string, string> = {
    Space: 'Space', ShiftLeft: '왼Shift', ShiftRight: '오른Shift', ControlLeft: '왼Ctrl', ControlRight: '오른Ctrl', AltLeft: '왼Alt', AltRight: '오른Alt',
    Tab: 'Tab', Enter: 'Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', CapsLock: 'CapsLock', Backspace: 'Backspace', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  };
  return map[code] ?? code;
}

export const urlParams = new URLSearchParams(location.search);
export const netSim = {
  lag: Math.max(0, Math.min(1000, Number(urlParams.get('lag') ?? 0) || 0)),
  loss: Math.max(0, Math.min(50, Number(urlParams.get('loss') ?? 0) || 0)),
};
