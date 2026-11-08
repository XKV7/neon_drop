// 대기열·관전 테스트: 동시 진행 판을 1개로 제한한 서버에서
// A가 판을 차지 → B가 빠른 시작 → 만석이라 관전하며 대기 → A의 판이 끝나면 B가 자동으로 영웅 선택에 들어가는지 확인
// 사용: npm run build && npm run e2e:queue
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const WebSocket = require('ws');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(join(tmpdir(), 'neon-q-'));
const shots = join(root, 'docs', 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = false;
try {
  var srv = spawn(process.execPath, [join(root, 'server/dist/index.js')], { env: { ...process.env, PORT: '8799', DATA_DIR: dataDir, MAX_MATCHES: '1', NEON_TIME_SCALE: '6' } });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('서버 실행')) r(); }));
  // A: 웹소켓 클라이언트로 빠른 시작
  const a = new WebSocket('ws://localhost:8799/ws'); const amsgs = [];
  a.on('message', (d, bin) => { if (!bin) { const m = JSON.parse(d); amsgs.push(m.type); if (m.type === 'welcome') { a.send(JSON.stringify({ type: 'createRoom' })); a.send(JSON.stringify({ type: 'queue' })); } if (m.type === 'error') console.log('A 오류 메시지:', m.text); } });
  a.on('open', () => a.send(JSON.stringify({ type: 'hello', version: 3, name: '플레이어A' })));
  const t0 = Date.now();
  while (!amsgs.includes('matchStart')) await sleep(200);
  console.log(`A 매치 시작 (${((Date.now() - t0) / 1000).toFixed(0)}초) · 사설 방 시도 결과는 위 오류 메시지`);
  // B: 브라우저
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8799/');
  await p.waitForFunction(() => window.__neon.serverOk && window.__neon.profile, null, { timeout: 20000 });
  await p.click('[data-act=start]'); await p.waitForTimeout(500);
  console.log('사설 방 버튼:', (await p.textContent('.menu .btn:nth-child(2)')).trim());
  await p.click('[data-act=quick]');
  await p.waitForFunction(() => window.__neon.match?.spectator, null, { timeout: 20000 });
  await p.waitForTimeout(2500);
  console.log('B 상태:', await p.evaluate(() => JSON.stringify({ spectator: window.__neon.match.spectator, queue: window.__neon.queue, view: window.__neon.match.game.viewId(), ents: window.__neon.match.game.view.size })));
  console.log('관전 안내:', (await p.textContent('.spectate')).replace(/\s+/g, ' '));
  await p.screenshot({ path: join(shots, '6-queue-spectate.jpg'), type: 'jpeg', quality: 82 });
  await p.click('[data-a=next]'); await p.waitForTimeout(1500);
  console.log('관전 대상 변경 후 view:', await p.evaluate(() => window.__neon.match.game.viewId()));
  const health = await (await fetch('http://localhost:8799/health')).json();
  console.log('health:', JSON.stringify({ active: health.activeMatches, max: health.maxMatches, spectators: health.spectators, queue: health.queue }));
  // A의 판이 끝나면 B가 영웅 선택으로
  const t1 = Date.now();
  await p.waitForSelector('.hero-grid', { timeout: 200000 });
  console.log(`A의 판 종료 후 B 영웅 선택 진입 (${((Date.now() - t1) / 1000).toFixed(0)}초 대기)`);
  console.log('콘솔 에러', errs.length, '개');
  if (errs.length) failed = true;
  await b.close(); a.close(); srv.kill();
} catch (e) { console.error('실패:', e); failed = true; }
rmSync(dataDir, { recursive: true, force: true });
console.log(failed ? '\n대기열·관전 테스트: 실패 ❌' : '\n대기열·관전 테스트: 통과 ✅');
process.exit(failed ? 1 : 0);
