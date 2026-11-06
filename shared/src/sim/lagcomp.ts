import { HISTORY_TICKS, MAX_REWIND_TICKS } from './constants';

const MAX_IDS = 12;

/** 영웅 위치 이력 (지연 보상용 되감기) */
export class HistoryBuffer {
  ticks = new Int32Array(HISTORY_TICKS).fill(-1);
  pos = new Float32Array(HISTORY_TICKS * MAX_IDS * 2);
  valid = new Uint8Array(HISTORY_TICKS * MAX_IDS);

  record(tick: number, entries: { id: number; x: number; y: number; ok: boolean }[]) {
    const slot = tick % HISTORY_TICKS;
    this.ticks[slot] = tick;
    this.valid.fill(0, slot * MAX_IDS, slot * MAX_IDS + MAX_IDS);
    for (const e of entries) {
      if (e.id >= MAX_IDS) continue;
      const i = slot * MAX_IDS + e.id;
      this.pos[i * 2] = e.x; this.pos[i * 2 + 1] = e.y;
      this.valid[i] = e.ok ? 1 : 0;
    }
  }

  private at(id: number, tick: number): { x: number; y: number; ok: boolean } | null {
    const slot = ((tick % HISTORY_TICKS) + HISTORY_TICKS) % HISTORY_TICKS;
    if (this.ticks[slot] !== tick) return null;
    const i = slot * MAX_IDS + id;
    return { x: this.pos[i * 2], y: this.pos[i * 2 + 1], ok: this.valid[i] === 1 };
  }

  /** 소수 틱 위치 보간. 기록이 없으면 null */
  get(id: number, tick: number): { x: number; y: number; ok: boolean } | null {
    const t0 = Math.floor(tick), f = tick - t0;
    const a = this.at(id, t0);
    if (!a) return null;
    if (f < 1e-4) return a;
    const b = this.at(id, t0 + 1);
    if (!b) return a;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ok: a.ok && b.ok };
  }
}

/** 클라이언트가 보던 시점(viewTick)과 현재 틱 차이를 되감기 틱 수로 변환 (최대 150ms) */
export function rewindTicks(currentTick: number, viewTick: number): number {
  if (!isFinite(viewTick) || viewTick <= 0) return 0;
  const d = currentTick - viewTick;
  if (d < 0) return 0;
  return Math.min(MAX_REWIND_TICKS, d);
}
