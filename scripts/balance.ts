import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HEROES, AUGMENTS, TIER_NAMES } from '../shared/src/index';

const args = process.argv.slice(2);
const getArg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const GAMES = Number(getArg('--games', '2000'));
const LEVEL = Number(getArg('--level', '2'));
const SEED = Number(getArg('--seed', '20990'));
const WRITE = args.includes('--write');
const here = dirname(fileURLToPath(import.meta.url));

interface Row { len: number; res: { h: string; p: number; k: number; a: string[]; d: number }[] }

async function main() {
  const nw = Math.max(1, Math.min(cpus().length, 8));
  const per = Math.ceil(GAMES / nw);
  const t0 = Date.now();
  let progress = 0;
  console.log(`네온 낙하 밸런스 시뮬레이션: 어려움 봇 10명 × ${GAMES}판 (워커 ${nw}개)`);
  const parts = await Promise.all(Array.from({ length: nw }, (_, i) => new Promise<Row[]>((resolve, reject) => {
    const from = i * per, to = Math.min(GAMES, from + per);
    if (from >= to) return resolve([]);
    const w = new Worker(join(here, 'balanceWorkerBoot.mjs'), { workerData: { from, to, botLevel: LEVEL, seedBase: SEED } });
    w.on('message', (m: { progress?: number; done?: Row[] }) => {
      if (m.progress) { progress += m.progress; process.stdout.write(`\r  진행: ${Math.min(GAMES, progress)}/${GAMES}`); }
      if (m.done) resolve(m.done);
    });
    w.on('error', reject);
  })));
  const rows = parts.flat();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\r  완료: ${rows.length}판, ${secs}초`);

  // ── 영웅별 ──
  const hs = new Map<string, { n: number; win: number; place: number; kills: number; dmg: number }>();
  for (const h of HEROES) hs.set(h.id, { n: 0, win: 0, place: 0, kills: 0, dmg: 0 });
  const as = new Map<string, { n: number; win: number; place: number }>();
  for (const a of AUGMENTS) as.set(a.id, { n: 0, win: 0, place: 0 });
  let lenSum = 0; const lens: number[] = [];
  for (const r of rows) {
    lenSum += r.len; lens.push(r.len);
    for (const p of r.res) {
      const s = hs.get(p.h)!; s.n++; s.place += p.p; s.kills += p.k; s.dmg += p.d; if (p.p === 1) s.win++;
      for (const a of p.a) { const x = as.get(a); if (x) { x.n++; x.place += p.p; if (p.p === 1) x.win++; } }
    }
  }
  const expected = 1 / 10;
  const heroTable = HEROES.map(h => {
    const s = hs.get(h.id)!;
    const wr = s.win / Math.max(1, s.n);
    return { id: h.id, name: h.name, n: s.n, wr, rel: wr / expected, place: s.place / Math.max(1, s.n), kills: s.kills / Math.max(1, s.n), dmg: s.dmg / Math.max(1, s.n) };
  });
  lens.sort((a, b) => a - b);
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  console.log(`\n평균 판 길이: ${(lenSum / rows.length / 60).toFixed(2)}분 (중앙값 ${(lens[Math.floor(lens.length / 2)] / 60).toFixed(2)}분)`);
  console.log(`기대 1위 비율(무작위 선택 기준): ${pct(expected)}  허용 범위: ${pct(expected * 0.75)} ~ ${pct(expected * 1.25)}\n`);
  const heroLines = ['| 영웅 | 출전 | 1위 비율 | 기대 대비 | 평균 순위 | 평균 처치 | 평균 피해 | 판정 |', '|---|---:|---:|---:|---:|---:|---:|:---:|'];
  for (const t of heroTable) {
    const ok = t.rel >= 0.75 && t.rel <= 1.25;
    heroLines.push(`| ${t.name} | ${t.n} | ${pct(t.wr)} | ${(t.rel * 100 - 100 >= 0 ? '+' : '') + (t.rel * 100 - 100).toFixed(1)}% | ${t.place.toFixed(2)} | ${t.kills.toFixed(2)} | ${Math.round(t.dmg)} | ${ok ? '✅' : '❌'} |`);
  }
  console.log(heroLines.join('\n'));

  // ── 증강: 1위 기여도 = 실제 1위 수 ÷ 기대 1위 수 (같은 영웅·같은 증강 개수 플레이어의 1위 비율로 기대값 산출) ──
  const base = new Map<string, { n: number; w: number }>();
  for (const r of rows) for (const p of r.res) {
    const k = p.h + ':' + p.a.length; const b = base.get(k) ?? { n: 0, w: 0 }; b.n++; if (p.p === 1) b.w++; base.set(k, b);
  }
  const expW = new Map<string, number>();
  for (const r of rows) for (const p of r.res) {
    const b = base.get(p.h + ':' + p.a.length)!; const e = b.w / b.n;
    for (const a of p.a) expW.set(a, (expW.get(a) ?? 0) + e);
  }
  const augTable = AUGMENTS.map(a => {
    const s = as.get(a.id)!;
    const wr = s.win / Math.max(1, s.n);
    return { id: a.id, name: a.name, tier: a.tier, hero: a.hero, n: s.n, wr, idx: s.win / Math.max(1e-6, expW.get(a.id) ?? 0), place: s.place / Math.max(1, s.n) };
  }).sort((a, b) => b.idx - a.idx);
  const augLines = ['| 증강 | 등급 | 전용 | 획득 수 | 보유 시 1위 비율 | 1위 기여도 (실제÷기대) | 평균 순위 |', '|---|---|---|---:|---:|---:|---:|'];
  for (const t of augTable) {
    const flag = t.n >= 150 && (t.idx > 1.35 || t.idx < 0.7) ? ' ⚠' : '';
    augLines.push(`| ${t.name} | ${TIER_NAMES[t.tier]} | ${t.hero ? HEROES.find(h => h.id === t.hero)!.name : '-'} | ${t.n} | ${pct(t.wr)} | ${t.idx.toFixed(2)}${flag} | ${t.place.toFixed(2)} |`);
  }
  console.log('\n증강별 1위 기여도 (실제 1위 수 ÷ 같은 영웅·같은 증강 수 기준 기대 1위 수)');
  console.log(augLines.join('\n'));
  const pass = heroTable.every(t => t.rel >= 0.75 && t.rel <= 1.25);
  console.log(`\n결과: ${pass ? '모든 영웅이 기대값 ±25% 이내 ✅' : '기준 미달 영웅 있음 ❌ — shared/src/data/heroes.ts 수치를 조정하세요'}`);

  const resultPath = join(here, 'balance-result.json');
  writeFileSync(resultPath, JSON.stringify({ games: rows.length, level: LEVEL, seed: SEED, avgLenMin: lenSum / rows.length / 60, heroes: heroTable, augments: augTable, pass }, null, 2));
  if (WRITE) {
    const readme = join(here, '..', 'README.md');
    if (existsSync(readme)) {
      const md = readFileSync(readme, 'utf8');
      const block = `<!-- BALANCE:START -->\n\n**${rows.length}판, 어려움 봇 10명, 시드 ${SEED}** · 평균 판 길이 ${(lenSum / rows.length / 60).toFixed(2)}분 · 기대 1위 비율 10.0% (허용 7.5%~12.5%)\n\n${heroLines.join('\n')}\n\n<details><summary>증강별 1위 기여도 (전체 ${augTable.length}종, 1.0 = 평균)</summary>\n\n${augLines.join('\n')}\n\n</details>\n\n<!-- BALANCE:END -->`;
      writeFileSync(readme, md.replace(/<!-- BALANCE:START -->[\s\S]*<!-- BALANCE:END -->/, block));
      console.log('README.md 밸런스 표를 갱신했습니다.');
    }
  }
  process.exitCode = pass ? 0 : 1;
}
main();
