import { BUSH_REVEAL_DIST, STEALTH_REVEAL_DIST, VIEW_RADIUS } from './constants';
import { bushAt, raycast } from './map';
import type { Hero, World } from './world';

/**
 * 서버 측 시야 판정. 클라이언트에는 보이는 엔티티만 전송된다 (맵핵 방지).
 * 봇도 동일한 함수로만 적을 인식한다.
 */
export function canSeeHero(w: World, a: Hero, b: Hero): boolean {
  if (a.id === b.id) return true;
  if (b.state === 'dead' || b.state === 'drop') return false;
  const dx = b.m.x - a.m.x, dy = b.m.y - a.m.y;
  const d2 = dx * dx + dy * dy;
  if (b.state === 'landing') return d2 <= (VIEW_RADIUS + 6) ** 2;
  if (d2 > VIEW_RADIUS * VIEW_RADIUS) return false;
  const revealed = b.st.revealT > 0;
  if (!revealed && b.st.stealthT > 0 && d2 > STEALTH_REVEAL_DIST * STEALTH_REVEAL_DIST) return false;
  if (!revealed) {
    const bb = bushAt(w.map, b.m.x, b.m.y);
    if (bb >= 0 && bushAt(w.map, a.m.x, a.m.y) !== bb && d2 > BUSH_REVEAL_DIST * BUSH_REVEAL_DIST) return false;
  }
  if (raycast(w.map, w.alive, a.m.x, a.m.y, b.m.x, b.m.y, 'vision').ob) return false;
  return true;
}

/** 점(투사체, 드론, 아이템)이 관찰자 시야에 있는지 */
export function canSeePoint(w: World, ox: number, oy: number, x: number, y: number, extra = 0): boolean {
  const d2 = (x - ox) ** 2 + (y - oy) ** 2;
  const R = VIEW_RADIUS + extra;
  if (d2 > R * R) return false;
  if (d2 < 9) return true;
  return !raycast(w.map, w.alive, ox, oy, x, y, 'vision').ob;
}

/** 경고 표시(장판/텔레그래프)는 위험을 알리기 위해 시야 거리 안이면 보인다 */
export function canSeeArea(ox: number, oy: number, x: number, y: number, r: number): boolean {
  const R = VIEW_RADIUS + r + 3;
  return (x - ox) ** 2 + (y - oy) ** 2 <= R * R;
}

/** 이번 틱의 영웅 간 시야 행렬 (vis[a*16+b]) */
export function computeVisMatrix(w: World, out: Uint8Array) {
  out.fill(0);
  const hs = w.heroes;
  for (let i = 0; i < hs.length; i++) {
    const a = hs[i];
    out[a.id * 16 + a.id] = 1;
    for (let j = 0; j < hs.length; j++) {
      if (i === j) continue;
      const b = hs[j];
      if (a.state === 'dead' || a.state === 'drop') continue;
      if (canSeeHero(w, a, b)) out[a.id * 16 + b.id] = 1;
    }
  }
}
