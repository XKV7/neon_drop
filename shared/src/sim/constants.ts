/** 전역 시뮬레이션 상수. 밸런스 수치는 data/ 아래에 있다. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

export const MAP_RADIUS = 40; // 플레이 가능 구역 반경 (지름 80m)
export const HARD_RADIUS = 43; // 물리적 경계
export const HERO_RADIUS = 0.55;
export const VIEW_RADIUS = 15.5;
export const BUSH_REVEAL_DIST = 2.6;
export const STEALTH_REVEAL_DIST = 1.9;

export const MAX_PLAYERS = 10;
export const MAX_REWIND_TICKS = 4.5; // 150ms
export const HISTORY_TICKS = 32;

export const DODGE_DIST = 3.8;
export const DODGE_TICKS = 8;
export const DODGE_CD = 4.0;
export const DODGE_IFRAMES = 0.2;

export const DROP_PHASE_SEC = 10;
export const LANDING_SEC = 2;
export const RECONNECT_GRACE_SEC = 20;
export const AUGMENT_PICK_SEC = 10;
export const MAX_LEVEL = 8;
export const HERO_SELECT_SEC = 15;
export const QUEUE_WAIT_SEC = 20;

export const KILL_HEAL_PCT = 0.15;
export const ASSIST_WINDOW_SEC = 10;
