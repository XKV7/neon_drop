import { parentPort, workerData } from 'node:worker_threads';
import { Match, HERO_IDS, Rng } from '../shared/src/index';

/** 헤드리스 시뮬레이션: 렌더링 없이 서버 로직(공유 시뮬레이션)만 실행 */
const { from, to, botLevel, seedBase } = workerData as { from: number; to: number; botLevel: number; seedBase: number };
const rows: unknown[] = [];
for (let g = from; g < to; g++) {
  const rng = new Rng(seedBase + g * 7919);
  const players = Array.from({ length: 10 }, (_, i) => ({ pid: 'b' + i, name: 'bot' + i, heroId: rng.pick(HERO_IDS), isBot: true, botLevel }));
  const m = new Match({ seed: seedBase + g, players, mode: 'br' });
  while (m.phase !== 'end' && m.w.tick < 30 * 480) m.step();
  rows.push({ len: m.w.tick / 30, res: m.results().map(r => ({ h: r.heroId, p: r.placement, k: r.kills, a: r.augments, d: r.damage })) });
  if ((g - from) % 25 === 0) parentPort!.postMessage({ progress: 25 });
}
parentPort!.postMessage({ done: rows });
