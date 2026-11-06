import { MAP_RADIUS, DROP_PHASE_SEC } from './constants';
import { Rng } from './math';

/**
 * 데이터 붕괴(안전 구역) 일정. 순수 함수로만 구성되어 테스트 가능하다.
 * 시간 t는 낙하 단계 시작부터의 초.
 */
export const ZONE_RULES = {
  interval: 60, // 60초마다 축소
  warn: 20, // 다음 구역은 20초 전에 표시
  shrinkDur: 8,
  radii: [MAP_RADIUS, 29, 20, 13, 7.5, 3.8],
  dps: [10, 15, 24, 34, 48, 64, 90],
  movingStart: 320, // 마지막 1분: 마지막 축소가 끝난 뒤 구역이 계속 움직인다
  movingEnd: 390,
  movingSpeed: 1.3,
  endRadius: 0,
};

export interface ZoneStage { start: number; end: number; x0: number; y0: number; r0: number; x1: number; y1: number; r1: number }
export interface ZoneSchedule { stages: ZoneStage[]; drift: { x: number; y: number }[] }
export interface ZoneState { x: number; y: number; r: number; nx: number; ny: number; nr: number; showNext: boolean; dps: number; stage: number; nextShrinkIn: number; moving: boolean }

export function makeZoneSchedule(seed: number): ZoneSchedule {
  const rng = new Rng(seed ^ 0x2f6b);
  const stages: ZoneStage[] = [];
  let x = 0, y = 0, r = ZONE_RULES.radii[0];
  for (let i = 1; i < ZONE_RULES.radii.length; i++) {
    const nr = ZONE_RULES.radii[i];
    const maxOff = Math.max(0, r - nr) * 0.85;
    const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * maxOff;
    let nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
    // 맵 안쪽 유지
    const dc = Math.hypot(nx, ny);
    if (dc + nr > MAP_RADIUS - 1) { const s = Math.max(0, MAP_RADIUS - 1 - nr) / (dc || 1); nx *= s; ny *= s; }
    const start = DROP_PHASE_SEC + ZONE_RULES.interval * i;
    stages.push({ start, end: start + ZONE_RULES.shrinkDur, x0: x, y0: y, r0: r, x1: nx, y1: ny, r1: nr });
    x = nx; y = ny; r = nr;
  }
  const drift: { x: number; y: number }[] = [{ x, y }];
  let cx = x, cy = y;
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, Math.PI * 2);
    cx = cx + Math.cos(a) * 6; cy = cy + Math.sin(a) * 6;
    const dc = Math.hypot(cx, cy);
    if (dc > MAP_RADIUS - 8) { cx *= (MAP_RADIUS - 8) / dc; cy *= (MAP_RADIUS - 8) / dc; }
    drift.push({ x: cx, y: cy });
  }
  return { stages, drift };
}

function driftPos(s: ZoneSchedule, dt: number): { x: number; y: number } {
  let remaining = dt * ZONE_RULES.movingSpeed;
  for (let i = 0; i < s.drift.length - 1; i++) {
    const a = s.drift[i], b = s.drift[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= l) { const f = l > 0 ? remaining / l : 0; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
    remaining -= l;
  }
  return s.drift[s.drift.length - 1];
}

export function zoneAt(s: ZoneSchedule, t: number): ZoneState {
  const R = ZONE_RULES;
  let x = 0, y = 0, r = R.radii[0], stage = 0;
  let nx = 0, ny = 0, nr = r, showNext = false, nextShrinkIn = 0;
  for (let i = 0; i < s.stages.length; i++) {
    const st = s.stages[i];
    if (t >= st.end) { x = st.x1; y = st.y1; r = st.r1; stage = i + 1; continue; }
    if (t >= st.start) {
      const f = (t - st.start) / (st.end - st.start);
      x = st.x0 + (st.x1 - st.x0) * f; y = st.y0 + (st.y1 - st.y0) * f; r = st.r0 + (st.r1 - st.r0) * f;
      stage = i + 1;
      nx = st.x1; ny = st.y1; nr = st.r1; showNext = true; nextShrinkIn = 0;
      return { x, y, r, nx, ny, nr, showNext, dps: R.dps[stage], stage, nextShrinkIn, moving: false };
    }
    // 아직 시작 전 단계
    nx = st.x1; ny = st.y1; nr = st.r1; showNext = t >= st.start - R.warn; nextShrinkIn = st.start - t;
    return { x, y, r, nx, ny, nr, showNext, dps: R.dps[stage], stage, nextShrinkIn, moving: false };
  }
  // 모든 축소 단계 이후: 움직이는 구역
  if (t >= R.movingStart) {
    const dt = t - R.movingStart;
    const p = driftPos(s, dt);
    const f = Math.min(1, dt / (R.movingEnd - R.movingStart));
    const lastR = R.radii[R.radii.length - 1];
    const cr = lastR + (R.endRadius - lastR) * f;
    return { x: p.x, y: p.y, r: Math.max(0, cr), nx: p.x, ny: p.y, nr: Math.max(0, cr), showNext: false, dps: R.dps[R.dps.length - 1] * (1 + f), stage: R.radii.length, nextShrinkIn: 0, moving: true };
  }
  return { x, y, r, nx: x, ny: y, nr: r, showNext: false, dps: R.dps[stage], stage, nextShrinkIn: R.movingStart - t, moving: false };
}

export function outsideZone(z: ZoneState, x: number, y: number): boolean {
  return (x - z.x) ** 2 + (y - z.y) ** 2 > z.r * z.r;
}
