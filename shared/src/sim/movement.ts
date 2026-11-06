import { DODGE_DIST, DODGE_TICKS, DT } from './constants';
import { MapData, resolveCircle, findFreeSpot } from './map';

/** 이동 관련 상태. 서버와 클라이언트 예측이 동일하게 사용한다. */
export interface MoveState {
  x: number; y: number;
  fvx: number; fvy: number; // 강제 이동 속도 (m/s)
  ft: number; // 강제 이동 남은 틱
  ft0: number; // 강제 이동 총 틱
  fkind: number; // ForcedKind
  dodgeCd: number; // 틱
  gateCd: number; // 틱
  padCd: number; // 틱
}

export const enum ForcedKind { None = 0, Dodge = 1, Dash = 2, Knock = 3, Jump = 4, Leap = 5, Pull = 6 }

export interface MoveParams {
  speed: number; // m/s
  canMove: boolean;
  canDodge: boolean;
  invert: boolean;
  radius: number;
  dodgeCdTicks: number;
  dodgeDistMult: number;
}

export interface MoveInput { mx: number; my: number; ax: number; ay: number; dodge: boolean }

export interface MoveResult { wallHit: boolean; dodged: boolean; gate: boolean; pad: boolean; forcedEnded: boolean }

export function newMoveState(x: number, y: number): MoveState {
  return { x, y, fvx: 0, fvy: 0, ft: 0, ft0: 0, fkind: 0, dodgeCd: 0, gateCd: 0, padCd: 0 };
}

export function copyMoveState(s: MoveState): MoveState { return { ...s }; }

const PAD_TICKS = 24;

export function stepMove(ms: MoveState, inp: MoveInput, p: MoveParams, map: MapData, alive: Uint8Array): MoveResult {
  const res: MoveResult = { wallHit: false, dodged: false, gate: false, pad: false, forcedEnded: false };
  if (ms.dodgeCd > 0) ms.dodgeCd--;
  if (ms.gateCd > 0) ms.gateCd--;
  if (ms.padCd > 0) ms.padCd--;

  if (ms.ft > 0) {
    const nx = ms.x + ms.fvx * DT, ny = ms.y + ms.fvy * DT;
    if (ms.fkind === ForcedKind.Jump || ms.fkind === ForcedKind.Leap) {
      ms.x = nx; ms.y = ny;
    } else {
      const r = resolveCircle(map, alive, nx, ny, p.radius);
      ms.x = r.x; ms.y = r.y; res.wallHit = r.hit;
    }
    ms.ft--;
    if (ms.ft <= 0) {
      if (ms.fkind === ForcedKind.Jump || ms.fkind === ForcedKind.Leap) {
        const f = findFreeSpot(map, alive, ms.x, ms.y, p.radius);
        ms.x = f.x; ms.y = f.y;
      }
      ms.ft = 0; ms.fvx = 0; ms.fvy = 0; ms.fkind = 0; res.forcedEnded = true;
    }
  } else {
    let mx = inp.mx, my = inp.my;
    const ml = Math.sqrt(mx * mx + my * my);
    if (ml > 1) { mx /= ml; my /= ml; }
    if (p.invert) { mx = -mx; my = -my; }
    if (inp.dodge && p.canDodge && ms.dodgeCd <= 0) {
      let dx = mx, dy = my;
      let dl = Math.sqrt(dx * dx + dy * dy);
      if (dl < 0.1) { dx = inp.ax - ms.x; dy = inp.ay - ms.y; dl = Math.sqrt(dx * dx + dy * dy); }
      if (dl < 1e-6) { dx = 1; dy = 0; dl = 1; }
      const sp = (DODGE_DIST * p.dodgeDistMult) / (DODGE_TICKS * DT);
      ms.fvx = (dx / dl) * sp; ms.fvy = (dy / dl) * sp;
      ms.ft = DODGE_TICKS; ms.ft0 = DODGE_TICKS; ms.fkind = ForcedKind.Dodge;
      ms.dodgeCd = p.dodgeCdTicks;
      res.dodged = true;
      return res;
    }
    if (p.canMove && (mx !== 0 || my !== 0)) {
      const r = resolveCircle(map, alive, ms.x + mx * p.speed * DT, ms.y + my * p.speed * DT, p.radius);
      ms.x = r.x; ms.y = r.y; res.wallHit = r.hit;
    }
  }

  if (ms.ft <= 0) {
    if (ms.padCd <= 0) {
      for (const pad of map.pads) {
        if ((ms.x - pad.x) ** 2 + (ms.y - pad.y) ** 2 < 1.0) {
          ms.fkind = ForcedKind.Jump; ms.ft = PAD_TICKS; ms.ft0 = PAD_TICKS;
          ms.fvx = (pad.tx - ms.x) / (PAD_TICKS * DT); ms.fvy = (pad.ty - ms.y) / (PAD_TICKS * DT);
          ms.padCd = PAD_TICKS + 30; res.pad = true;
          break;
        }
      }
    }
    if (!res.pad && ms.gateCd <= 0) {
      const g = map.gates;
      if ((ms.x - g.ax) ** 2 + (ms.y - g.ay) ** 2 < 1.1) { ms.x = g.bx; ms.y = g.by; ms.gateCd = 75; res.gate = true; }
      else if ((ms.x - g.bx) ** 2 + (ms.y - g.by) ** 2 < 1.1) { ms.x = g.ax; ms.y = g.ay; ms.gateCd = 75; res.gate = true; }
    }
  }
  return res;
}
