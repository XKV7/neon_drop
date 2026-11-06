import { HARD_RADIUS } from './constants';
import { Rng, clamp, dist, Vec2 } from './math';

export type ObKind =
  | 'building' | 'wall' | 'container' | 'crate' | 'car' | 'pillar' | 'tank' | 'stall' | 'planter' | 'tree' | 'statue' | 'barrier' | 'greenhouse';

export interface Obstacle {
  id: number;
  shape: 'box' | 'circle';
  x: number; y: number;
  hw: number; hh: number; // box half extents
  r: number; // circle radius
  h: number; // visual height
  kind: ObKind;
  blocksVision: boolean;
  destructible: boolean;
  maxHp: number;
  district: number;
}

export interface Rect { x: number; y: number; hw: number; hh: number }
export interface JumpPad { x: number; y: number; tx: number; ty: number }
export interface Gate { ax: number; ay: number; bx: number; by: number }
export interface Decor { kind: 'lamp' | 'sign' | 'puddle' | 'railBeam' | 'skyline' | 'neonStrip' | 'billboard' | 'grass'; x: number; y: number; a: number; s: number; c: number; h: number }

export const DISTRICTS = [
  { id: 0, name: '중앙 광장' },
  { id: 1, name: '네온 시장' },
  { id: 2, name: '고가 철도 아래' },
  { id: 3, name: '폐공장' },
  { id: 4, name: '옥상 정원' },
] as const;

export interface MapData {
  seed: number;
  obstacles: Obstacle[];
  bushes: Rect[];
  pads: JumpPad[];
  gates: Gate;
  vendings: Vec2[];
  camps: Vec2[];
  decor: Decor[];
  grid: { cell: number; n: number; origin: number; cells: number[][] };
}

const OB_PROPS: Record<ObKind, { h: number; vis: boolean; hp: number }> = {
  building: { h: 7, vis: true, hp: 0 },
  wall: { h: 2.6, vis: true, hp: 0 },
  container: { h: 2.6, vis: true, hp: 520 },
  crate: { h: 1.0, vis: false, hp: 220 },
  car: { h: 1.2, vis: false, hp: 380 },
  pillar: { h: 6, vis: true, hp: 0 },
  tank: { h: 3.5, vis: true, hp: 0 },
  stall: { h: 1.3, vis: false, hp: 260 },
  planter: { h: 0.8, vis: false, hp: 0 },
  tree: { h: 3.2, vis: false, hp: 0 },
  statue: { h: 4.5, vis: true, hp: 0 },
  barrier: { h: 1.0, vis: false, hp: 300 },
  greenhouse: { h: 3.6, vis: true, hp: 0 },
};

export function districtAt(x: number, y: number): number {
  if (x * x + y * y < 10 * 10) return 0;
  if (x > Math.abs(y)) return 1;
  if (y > Math.abs(x)) return 2;
  if (-x > Math.abs(y)) return 3;
  return 4;
}

export function generateMap(seed: number): MapData {
  const rng = new Rng(seed);
  const obs: Obstacle[] = [];
  const j = (v: number) => v + rng.range(-0.6, 0.6);
  const box = (kind: ObKind, x: number, y: number, hw: number, hh: number, h?: number) => {
    const p = OB_PROPS[kind];
    obs.push({ id: 0, shape: 'box', x, y, hw, hh, r: 0, h: h ?? p.h, kind, blocksVision: p.vis, destructible: p.hp > 0, maxHp: p.hp, district: districtAt(x, y) });
  };
  const circ = (kind: ObKind, x: number, y: number, r: number, h?: number) => {
    const p = OB_PROPS[kind];
    obs.push({ id: 0, shape: 'circle', x, y, hw: r, hh: r, r, h: h ?? p.h, kind, blocksVision: p.vis, destructible: p.hp > 0, maxHp: p.hp, district: districtAt(x, y) });
  };

  // ── 중앙 광장 ──
  circ('statue', 0, 0, 1.5);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2 + rng.range(-0.15, 0.15);
    const horiz = k % 2 === 0;
    box('barrier', Math.cos(a) * 5.2, Math.sin(a) * 5.2, horiz ? 1.3 : 0.35, horiz ? 0.35 : 1.3);
  }

  // ── 네온 시장 (동) ──
  for (const sx of [14, 19.5, 25]) {
    for (const sy of [-9, -3.5, 3.5, 9]) {
      if (rng.chance(0.22)) continue;
      box('stall', j(sx), j(sy), rng.range(0.9, 1.3), rng.range(0.6, 0.8));
    }
  }
  box('building', 33.5, -10, 2.6, 4.5, rng.range(6, 9));
  box('building', 33, 6, 2.4, 3.5, rng.range(6, 9));
  box('wall', 29.5, -1.5, 0.35, 2.2);
  if (rng.chance(0.6)) box('container', 22, 14.5, 1.8, 0.9);
  box('crate', j(30), j(13), 0.6, 0.6);
  box('crate', j(16), j(-14), 0.6, 0.6);

  // ── 고가 철도 아래 (북) ──
  for (const py of [17, 23.5]) {
    for (let px = -15; px <= 15; px += 5.5) {
      circ('pillar', px + rng.range(-0.3, 0.3), py, 0.7);
    }
  }
  const cars = [[-7, 20.2], [4.5, 27], [10, 14.2], [-12, 13.5], [1, 20.2], [-3, 30]];
  for (const [cx, cy] of cars) if (rng.chance(0.8)) box('car', j(cx), j(cy), rng.chance(0.5) ? 1.1 : 0.55, rng.chance(0.5) ? 0.55 : 1.1);
  box('building', -6, 34, 4, 2.5, 8);
  box('building', 8, 33.5, 3, 2.2, 7);
  box('wall', 14.5, 29, 2.2, 0.35);

  // ── 폐공장 (서) ──
  box('building', -24, -8, 3.8, 4.4, rng.range(6.5, 8));
  box('building', -25, 9, 3.6, 3.6, rng.range(6.5, 8));
  box('wall', -15.5, -3.5, 0.35, 2.6);
  box('wall', -15.5, 5, 0.35, 2.0);
  box('wall', -19, 18, 2.6, 0.35);
  for (let k = 0; k < 5; k++) {
    if (rng.chance(0.25)) continue;
    const vert = rng.chance(0.5);
    box('container', j(-33 + (k % 2) * 3.5), j(-17 + k * 6.5), vert ? 0.9 : 1.8, vert ? 1.8 : 0.9);
  }
  circ('tank', -32.5, 2, 1.6);
  circ('tank', -29, -16.5, 1.4);
  box('crate', j(-19), j(-12), 0.6, 0.6);
  box('crate', j(-12), j(-18), 0.6, 0.6);

  // ── 옥상 정원 (남) ──
  for (const py of [-15, -21.5, -28]) {
    for (const px of [-11, -3.5, 4, 11.5]) {
      if (rng.chance(0.28)) continue;
      box('planter', j(px), py + rng.range(-0.4, 0.4), rng.range(1.4, 2.0), 0.4);
    }
  }
  for (let k = 0; k < 7; k++) {
    const x = rng.range(-14, 14), y = rng.range(-31, -13);
    circ('tree', x, y, 0.65);
  }
  box('greenhouse', 13, -17.5, 2.6, 2.2);
  box('building', -12, -33.5, 3.5, 2.4, 7);
  box('building', 7, -35, 3, 2, 6.5);

  // ── 외곽 산재물 ──
  for (let k = 0; k < 10; k++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(30, 38);
    if (rng.chance(0.5)) box('crate', Math.cos(a) * r, Math.sin(a) * r, 0.6, 0.6);
    else box('car', Math.cos(a) * r, Math.sin(a) * r, 1.1, 0.55);
  }

  // 특수 지점
  const pads: JumpPad[] = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    pads.push({ x: Math.cos(a) * 8.2, y: Math.sin(a) * 8.2, tx: Math.cos(a) * 24, ty: Math.sin(a) * 24 });
  }
  const gates: Gate = { ax: -29, ay: 25, bx: 29, by: -25 };
  const vendings: Vec2[] = [
    { x: 21, y: 11.5 }, { x: 12.5, y: -6.5 }, { x: -10.5, y: 27.5 }, { x: -20, y: 0.5 }, { x: 0.5, y: -32 }, { x: 31, y: 22 },
  ];
  const camps: Vec2[] = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 2 + rng.range(-0.15, 0.15);
    camps.push({ x: Math.cos(a) * 28, y: Math.sin(a) * 28 });
  }
  camps.push({ x: 0, y: 12.5 }, { x: 0, y: -11.5 });

  const keyPoints: (Vec2 & { r: number })[] = [
    ...pads.map(p => ({ x: p.x, y: p.y, r: 2 })), ...pads.map(p => ({ x: p.tx, y: p.ty, r: 2.2 })),
    { x: gates.ax, y: gates.ay, r: 2.2 }, { x: gates.bx, y: gates.by, r: 2.2 },
    ...vendings.map(v => ({ ...v, r: 1.6 })), ...camps.map(c => ({ ...c, r: 3 })),
  ];
  // 중요 지점과 겹치는 장애물 제거, 경계 밖 제거
  const filtered = obs.filter(o => {
    if (Math.hypot(o.x, o.y) > HARD_RADIUS - 1.5) return false;
    for (const k of keyPoints) {
      if (o.shape === 'circle') { if (dist(o.x, o.y, k.x, k.y) < o.r + k.r) return false; }
      else {
        const cx = clamp(k.x, o.x - o.hw, o.x + o.hw), cy = clamp(k.y, o.y - o.hh, o.y + o.hh);
        if (dist(cx, cy, k.x, k.y) < k.r) return false;
      }
    }
    return true;
  });
  // 서로 겹치는 장애물 제거 (뒤쪽 것)
  const final: Obstacle[] = [];
  for (const o of filtered) {
    let bad = false;
    for (const p of final) {
      if (Math.abs(o.x - p.x) < o.hw + p.hw + 0.9 && Math.abs(o.y - p.y) < o.hh + p.hh + 0.9) { bad = true; break; }
    }
    if (!bad) final.push(o);
  }
  final.forEach((o, i) => (o.id = i));

  const bushes: Rect[] = [
    { x: 18, y: 0, hw: 2.4, hh: 1.7 }, { x: 27, y: -12.5, hw: 2.2, hh: 2.0 },
    { x: 0, y: 30, hw: 2.8, hh: 1.6 }, { x: -6.5, y: 17, hw: 1.6, hh: 2.2 },
    { x: -17, y: 12, hw: 2.0, hh: 2.0 }, { x: -30, y: -8, hw: 1.8, hh: 2.6 },
    { x: -6, y: -24.7, hw: 2.4, hh: 1.8 }, { x: 8, y: -31, hw: 2.4, hh: 1.6 },
  ];

  const decor: Decor[] = [];
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2 + rng.range(-0.05, 0.05);
    decor.push({ kind: 'lamp', x: Math.cos(a) * 36.5, y: Math.sin(a) * 36.5, a, s: 1, c: k % 3, h: 4.5 });
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    decor.push({ kind: 'lamp', x: Math.cos(a) * 11, y: Math.sin(a) * 11, a, s: 1, c: (k + 1) % 3, h: 4 });
  }
  for (let k = 0; k < 40; k++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * 38;
    decor.push({ kind: 'puddle', x: Math.cos(a) * r, y: Math.sin(a) * r, a: rng.range(0, 6.28), s: rng.range(1, 3.2), c: 0, h: 0 });
  }
  // 고가 철도 상판 (시각 전용)
  decor.push({ kind: 'railBeam', x: 0, y: 20.25, a: 0, s: 36, c: 0, h: 6.2 });
  // 외곽 스카이라인
  for (let k = 0; k < 44; k++) {
    const a = (k / 44) * Math.PI * 2 + rng.range(-0.04, 0.04);
    const r = rng.range(48, 62);
    decor.push({ kind: 'skyline', x: Math.cos(a) * r, y: Math.sin(a) * r, a, s: rng.range(3, 7), c: rng.int(0, 2), h: rng.range(10, 34) });
  }
  // 홀로그램 광고판 (부시 위)
  bushes.forEach((b, i) => decor.push({ kind: 'billboard', x: b.x, y: b.y, a: 0, s: Math.max(b.hw, b.hh), c: i % 3, h: 3.2 }));
  // 건물 간판
  final.forEach((o, i) => {
    if (o.kind === 'building' || o.kind === 'greenhouse') decor.push({ kind: 'sign', x: o.x, y: o.y, a: i, s: Math.min(o.hw, o.hh), c: i % 3, h: o.h * rng.range(0.45, 0.8) });
  });
  for (let k = 0; k < 30; k++) {
    const x = rng.range(-14, 14), y = rng.range(-32, -13);
    decor.push({ kind: 'grass', x, y, a: rng.range(0, 6.28), s: rng.range(0.6, 1.4), c: 0, h: 0 });
  }

  const map: MapData = { seed, obstacles: final, bushes, pads, gates, vendings, camps, decor, grid: { cell: 4, n: 24, origin: -48, cells: [] } };
  buildGrid(map);
  return map;
}

export function buildGrid(map: MapData) {
  const g = map.grid;
  g.cells = Array.from({ length: g.n * g.n }, () => []);
  for (const o of map.obstacles) {
    const x0 = Math.floor((o.x - o.hw - g.origin) / g.cell), x1 = Math.floor((o.x + o.hw - g.origin) / g.cell);
    const y0 = Math.floor((o.y - o.hh - g.origin) / g.cell), y1 = Math.floor((o.y + o.hh - g.origin) / g.cell);
    for (let cy = Math.max(0, y0); cy <= Math.min(g.n - 1, y1); cy++)
      for (let cx = Math.max(0, x0); cx <= Math.min(g.n - 1, x1); cx++) g.cells[cy * g.n + cx].push(o.id);
  }
}

let stampArr = new Uint32Array(512);
let stampVal = 1;
function nextStamp(n: number) {
  if (stampArr.length < n) stampArr = new Uint32Array(n * 2);
  stampVal++;
  if (stampVal > 0xfffffff0) { stampArr.fill(0); stampVal = 1; }
  return stampVal;
}

/** 영역(AABB)과 겹칠 수 있는 장애물들에 대해 콜백 */
export function forObstaclesIn(map: MapData, minX: number, minY: number, maxX: number, maxY: number, fn: (o: Obstacle) => void | boolean) {
  const g = map.grid;
  const x0 = Math.max(0, Math.floor((minX - g.origin) / g.cell)), x1 = Math.min(g.n - 1, Math.floor((maxX - g.origin) / g.cell));
  const y0 = Math.max(0, Math.floor((minY - g.origin) / g.cell)), y1 = Math.min(g.n - 1, Math.floor((maxY - g.origin) / g.cell));
  const st = nextStamp(map.obstacles.length);
  for (let cy = y0; cy <= y1; cy++)
    for (let cx = x0; cx <= x1; cx++) {
      const cell = g.cells[cy * g.n + cx];
      for (let i = 0; i < cell.length; i++) {
        const id = cell[i];
        if (stampArr[id] === st) continue;
        stampArr[id] = st;
        if (fn(map.obstacles[id]) === true) return;
      }
    }
}

/** 원을 장애물 밖으로 밀어낸다. alive[id]==0 인 장애물은 무시. */
export function resolveCircle(map: MapData, alive: Uint8Array, x: number, y: number, r: number): { x: number; y: number; hit: boolean } {
  let hit = false;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    forObstaclesIn(map, x - r, y - r, x + r, y + r, o => {
      if (!alive[o.id]) return;
      if (o.shape === 'circle') {
        const dx = x - o.x, dy = y - o.y;
        const d = Math.sqrt(dx * dx + dy * dy), m = o.r + r;
        if (d < m) {
          if (d < 1e-6) { x = o.x + m; }
          else { x = o.x + (dx / d) * m; y = o.y + (dy / d) * m; }
          moved = hit = true;
        }
      } else {
        const cx = clamp(x, o.x - o.hw, o.x + o.hw), cy = clamp(y, o.y - o.hh, o.y + o.hh);
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            x = cx + (dx / d) * r; y = cy + (dy / d) * r;
          } else {
            // 중심이 상자 내부: 최소 침투 축으로
            const px = o.hw - Math.abs(x - o.x), py = o.hh - Math.abs(y - o.y);
            if (px < py) x = o.x + Math.sign(x - o.x || 1) * (o.hw + r);
            else y = o.y + Math.sign(y - o.y || 1) * (o.hh + r);
          }
          moved = hit = true;
        }
      }
    });
    if (!moved) break;
  }
  const d = Math.sqrt(x * x + y * y), lim = HARD_RADIUS - r;
  if (d > lim) { x = (x / d) * lim; y = (y / d) * lim; hit = true; }
  return { x, y, hit };
}

/** 장애물 내부 여부 */
export function overlapsObstacle(map: MapData, alive: Uint8Array, x: number, y: number, r: number): boolean {
  let res = false;
  forObstaclesIn(map, x - r, y - r, x + r, y + r, o => {
    if (!alive[o.id]) return;
    if (o.shape === 'circle') { if (dist(x, y, o.x, o.y) < o.r + r) { res = true; return true; } }
    else {
      const cx = clamp(x, o.x - o.hw, o.x + o.hw), cy = clamp(y, o.y - o.hh, o.y + o.hh);
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) { res = true; return true; }
    }
  });
  if (!res && Math.hypot(x, y) > HARD_RADIUS - r) res = true;
  return res;
}

export interface RayHit { t: number; ob: Obstacle | null; nx: number; ny: number }

/** 선분 A→B 레이캐스트. mode: 'vision'이면 시야 차단 장애물만. */
export function raycast(map: MapData, alive: Uint8Array, ax: number, ay: number, bx: number, by: number, mode: 'vision' | 'all', pad = 0): RayHit {
  const res: RayHit = { t: 1, ob: null, nx: 0, ny: 0 };
  const dx = bx - ax, dy = by - ay;
  forObstaclesIn(map, Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad, o => {
    if (!alive[o.id]) return;
    if (mode === 'vision' && !o.blocksVision) return;
    if (o.shape === 'circle') {
      const r = o.r + pad;
      const fx = ax - o.x, fy = ay - o.y;
      const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
      if (c < 0) { if (0 < res.t) { res.t = 0; res.ob = o; const l = Math.hypot(fx, fy) || 1; res.nx = fx / l; res.ny = fy / l; } return; }
      const disc = b * b - 4 * a * c;
      if (disc < 0 || a < 1e-12) return;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t < res.t) {
        res.t = t; res.ob = o;
        const hx = ax + dx * t - o.x, hy = ay + dy * t - o.y; const l = Math.hypot(hx, hy) || 1;
        res.nx = hx / l; res.ny = hy / l;
      }
    } else {
      const minX = o.x - o.hw - pad, maxX = o.x + o.hw + pad, minY = o.y - o.hh - pad, maxY = o.y + o.hh + pad;
      let tmin = 0, tmax = 1, nx = 0, ny = 0;
      if (Math.abs(dx) < 1e-12) { if (ax < minX || ax > maxX) return; }
      else {
        let t1 = (minX - ax) / dx, t2 = (maxX - ax) / dx, n = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; n = 1; }
        if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return;
      }
      if (Math.abs(dy) < 1e-12) { if (ay < minY || ay > maxY) return; }
      else {
        let t1 = (minY - ay) / dy, t2 = (maxY - ay) / dy, n = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; n = 1; }
        if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return;
      }
      if (tmin < res.t) { res.t = tmin; res.ob = o; res.nx = nx; res.ny = ny; }
    }
  });
  return res;
}

export function inRect(r: Rect, x: number, y: number) {
  return Math.abs(x - r.x) <= r.hw && Math.abs(y - r.y) <= r.hh;
}

export function bushAt(map: MapData, x: number, y: number): number {
  for (let i = 0; i < map.bushes.length; i++) if (inRect(map.bushes[i], x, y)) return i;
  return -1;
}

/** 장애물과 겹치지 않는 가장 가까운 지점 찾기 */
export function findFreeSpot(map: MapData, alive: Uint8Array, x: number, y: number, r: number, maxR = 6): Vec2 {
  if (!overlapsObstacle(map, alive, x, y, r)) return { x, y };
  for (let rad = 0.5; rad <= maxR; rad += 0.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (!overlapsObstacle(map, alive, px, py, r)) return { x: px, y: py };
    }
  }
  return { x: 0, y: 3 };
}
