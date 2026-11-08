// 종단 간 테스트: 서로 다른 게스트 2명이 같은 사설 방에서 한 판을 진행한다.
// 사용: npm run build && npm run e2e   (Playwright와 Chromium 필요)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('playwright 패키지가 필요합니다: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8790;
const shotsDir = join(root, 'docs', 'screenshots');
mkdirSync(shotsDir, { recursive: true });
const dataDir = join(tmpdir(), 'neon-e2e-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn(process.execPath, [join(root, 'server/dist/index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NEON_XP_MULT: '6', NEON_TIME_SCALE: '3', PRIVATE_ROOM_MIN_LEVEL: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', d => process.stderr.write('[서버] ' + d));
await new Promise(r => server.stdout.on('data', d => { if (String(d).includes('서버 실행')) r(); }));

const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({ args: launchArgs, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

async function run(query, shots) {
  const label = query ? `네트워크 시뮬레이션(${query})` : '기본';
  console.log(`\n=== E2E 실행: ${label} ===`);
  const errors = [];
  const mk = async name => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
    page.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
    await page.goto(`http://localhost:${PORT}/${query}`);
    await page.waitForFunction(() => window.__neon && window.__neon.serverOk && window.__neon.profile, null, { timeout: 20000 });
    await page.fill('#nick', name);
    await page.click('[data-act=start]');
    await page.waitForFunction(n => window.__neon.profile?.name === n, name, { timeout: 10000 });
    return page;
  };
  const A = await mk('플레이어A'), B = await mk('플레이어B');
  if (shots) await A.screenshot({ path: join(shotsDir, '1-lobby.jpg'), type: 'jpeg', quality: 82 });

  // 사설 방
  await A.click('[data-act=room-menu]'); await A.click('[data-act=create-room]');
  await A.waitForSelector('.room-code');
  const code = (await A.textContent('.room-code')).trim();
  console.log('방 코드', code);
  await B.click('[data-act=room-menu]'); await B.fill('#roomCode', code); await B.click('[data-act=join-room]');
  await A.waitForFunction(() => window.__neon.room?.players.length === 2);
  await A.click('[data-act=start-room]');

  // 영웅 선택
  await A.waitForSelector('.hero-grid'); await B.waitForSelector('.hero-grid');
  await A.click('[data-hero=rail]'); await B.click('[data-hero=hammerdog]');
  await sleep(500);
  await A.hover('.skill-row[data-skill="1"]'); await sleep(600);
  if (shots) await A.screenshot({ path: join(shotsDir, '2-hero-select.jpg'), type: 'jpeg', quality: 82 });
  await A.click('[data-act=lock]'); await B.click('[data-act=lock]');

  // 낙하
  await A.waitForFunction(() => window.__neon.match?.game.self, null, { timeout: 30000 });
  await B.waitForFunction(() => window.__neon.match?.game.self, null, { timeout: 30000 });
  await sleep(1500);
  const clickWorld = async (page, x, y) => {
    const p = await page.evaluate(([x, y]) => window.__neon.r3.worldToScreen(x, y, 0), [x, y]);
    await page.mouse.click(p.x, p.y);
  };
  await clickWorld(A, 0, -3.4); await clickWorld(B, 1.5, -3.8);
  await A.waitForFunction(() => window.__neon.match.game.selfState === 2, null, { timeout: 20000 });
  await B.waitForFunction(() => window.__neon.match.game.selfState === 2, null, { timeout: 20000 });
  console.log('착지 완료');

  // 증강: 데이터 코어 줍기
  const walkToCore = async page => {
    for (let i = 0; i < 80; i++) {
      const st = await page.evaluate(() => {
        const g = window.__neon.match?.game; if (!g || !g.self) return null;
        if (window.__neon.match.hud.offer) return { offer: true };
        let best = null, bd = 1e9;
        for (const v of g.view.values()) if (v.type === 7 && v.sub === 0) { const d = Math.hypot(v.x - g.self.x, v.y - g.self.y); if (d < bd) { bd = d; best = v; } }
        return best ? { x: best.x - g.self.x, y: best.y - g.self.y, state: g.self.state } : { x: -g.self.x, y: -g.self.y, state: g.self.state };
      });
      if (!st || st.offer || st.state !== 2) { console.log('  코어 탐색 종료', JSON.stringify(st)); return !!st?.offer; }
      const keys = [];
      if (st.x > 0.4) keys.push('KeyD'); if (st.x < -0.4) keys.push('KeyA'); if (st.y > 0.4) keys.push('KeyS'); if (st.y < -0.4) keys.push('KeyW');
      for (const k of keys) await page.keyboard.down(k);
      await sleep(180);
      for (const k of keys) await page.keyboard.up(k);
    }
    console.log('  코어 탐색 시간 초과');
    return false;
  };
  const gotA = await walkToCore(A);
  await walkToCore(B);
  if (gotA) {
    await A.waitForSelector('.aug-card', { timeout: 5000 }).catch(async e => {
      console.log('  진단:', await A.evaluate(() => JSON.stringify({ state: window.__neon.match?.game.selfState, offer: !!window.__neon.match?.hud.offer, cards: document.querySelectorAll('.aug-card').length, augs: window.__neon.match?.augments, hp: window.__neon.match?.game.view.get(window.__neon.match.game.you)?.hp })));
      throw e;
    });
    if (shots) await A.screenshot({ path: join(shotsDir, '4-augment.jpg'), type: 'jpeg', quality: 82 });
    await A.keyboard.press('Digit1');
    await A.waitForFunction(() => window.__neon.match.augments.length > 0, null, { timeout: 5000 });
    console.log('증강 선택 성공:', await A.evaluate(() => window.__neon.match.augments.join(',')));
  } else errors.push('증강 선택 화면에 도달하지 못함');
  // B는 마우스 클릭으로 선택
  const bOffer = await B.evaluate(() => !!window.__neon.match?.hud.offer);
  if (bOffer) { await B.click('.aug-card >> nth=1'); await sleep(500); }

  const snap = page => page.evaluate(() => {
    const g = window.__neon.match?.game; if (!g || !g.self) return null;
    const heroes = {}; for (const v of g.view.values()) if (v.type === 1) heroes[v.id] = [v.x, v.y];
    return { you: g.you, tick: g.newestTick, alive: g.match.alive, zr: g.match.zr, self: [g.self.x, g.self.y, g.self.state], heroes, corrections: g.corrections, ping: g.ping };
  });

  // 전투 입력: 서로를 향해 이동하며 공격/스킬/구르기
  const act = async (page, other) => {
    const st = await page.evaluate(id => { const g = window.__neon.match.game; const o = g.view.get(id); const me = g.self; return { me: [me.x, me.y], o: o ? [o.x, o.y] : null }; }, other);
    const tx = st.o ? st.o[0] : 0, ty = st.o ? st.o[1] : 0;
    const dx = tx - st.me[0], dy = ty - st.me[1];
    const scr = await page.evaluate(([x, y]) => window.__neon.r3.worldToScreen(x, y, 0), [tx, ty]);
    await page.mouse.move(scr.x, scr.y);
    const keys = [];
    if (dx > 1.5) keys.push('KeyD'); if (dx < -1.5) keys.push('KeyA'); if (dy > 1.5) keys.push('KeyS'); if (dy < -1.5) keys.push('KeyW');
    for (const k of keys) await page.keyboard.down(k);
    await sleep(450);
    for (const k of keys) await page.keyboard.up(k);
    await page.mouse.down(); await sleep(400); await page.mouse.up();
    await page.mouse.click(scr.x, scr.y, { button: 'right' }); await sleep(250);
    await page.keyboard.press('KeyQ'); await sleep(250);
    await page.keyboard.press('Space'); await sleep(300);
  };
  let syncChecks = 0, syncOk = 0, maxErr = 0;
  for (let round = 0; round < 5; round++) {
    const [ya, yb] = await Promise.all([A.evaluate(() => window.__neon.match.game.you), B.evaluate(() => window.__neon.match.game.you)]);
    await Promise.all([act(A, yb), act(B, ya)]);
    // 정지 후 동기화 확인: 700ms 간격 두 번 측정해 멈춰 있는 상태만 비교 (보간 지연 이후)
    await sleep(600);
    const [a1, b1] = await Promise.all([snap(A), snap(B)]);
    await sleep(700);
    const [sa, sb] = await Promise.all([snap(A), snap(B)]);
    if (sa && sb && a1 && b1) {
      for (const [me, prev, other] of [[sa, a1, sb], [sb, b1, sa]]) {
        const seen = other.heroes[me.you];
        if (process.env.E2E_DEBUG) console.log('  sample', me.you, JSON.stringify(me.self), JSON.stringify(prev.self), 'seen', JSON.stringify(seen));
        if (!seen || me.self[2] !== 2) continue;
        if (Math.hypot(me.self[0] - prev.self[0], me.self[1] - prev.self[1]) > 0.05) continue;
        syncChecks++;
        if (process.env.E2E_DEBUG) console.log('  sync', me.you, me.self, seen);
        const err = Math.hypot(seen[0] - me.self[0], seen[1] - me.self[1]);
        maxErr = Math.max(maxErr, err);
        if (err < 0.5) syncOk++;
      }
      if (Math.abs(sa.alive - sb.alive) > 1) errors.push(`생존 인원 불일치 A=${sa.alive} B=${sb.alive}`);
      if (Math.abs(sa.tick - sb.tick) <= 1 && Math.abs(sa.zr - sb.zr) > 0.5) errors.push(`구역 반경 불일치 A=${sa.zr} B=${sb.zr} (틱 ${sa.tick}/${sb.tick})`);
    }
  }
  if (shots) await A.screenshot({ path: join(shotsDir, '3-combat.jpg'), type: 'jpeg', quality: 82 });
  console.log(`위치 동기화: ${syncOk}/${syncChecks} 일치 (최대 오차 ${maxErr.toFixed(2)}m)`);
  if (syncChecks > 0 && syncOk < syncChecks) errors.push(`두 화면의 위치가 어긋남 (최대 ${maxErr.toFixed(2)}m)`);

  // 판 종료까지 (가속된 구역)
  console.log('판 종료 대기…');
  for (const page of [A, B]) {
    await page.waitForFunction(() => { const m = window.__neon.match; return !m || m.game.selfState === 3 || m.results || document.querySelector('.overlay.res'); }, null, { timeout: 150000 });
  }
  for (const page of [A, B]) {
    const hasOverlay = await page.evaluate(() => !!document.querySelector('.overlay.res'));
    if (!hasOverlay) {
      // 결과창이 자동으로 뜨는 중일 수 있으므로 클릭 실패는 무시하고 결과창을 기다린다
      const btn = await page.$('[data-a=res]');
      if (btn) await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForSelector('.overlay.res', { timeout: 120000 });
    }
  }
  await sleep(800);
  if (shots) await A.screenshot({ path: join(shotsDir, '5-results.jpg'), type: 'jpeg', quality: 82 });
  const credits = await A.evaluate(() => window.__neon.match?.results?.credits ?? -1);
  console.log('결과 화면 도달, 획득 크레딧', credits);
  const net = await A.evaluate(() => ({ corrections: window.__neon.match?.game.corrections, ping: window.__neon.match?.game.ping }));
  console.log('보정 횟수', net.corrections, '핑', Math.round(net.ping), 'ms');
  await A.context().close(); await B.context().close();
  return errors;
}

let failed = false;
try {
  const e1 = await run('', true);
  const e2 = await run('?lag=150&loss=5', false);
  for (const [n, e] of [['기본', e1], ['지연/손실', e2]]) {
    console.log(`\n[${n}] 콘솔 에러/문제: ${e.length}개`);
    for (const x of e) console.log('  - ' + x);
    if (e.length) failed = true;
  }
} catch (err) {
  console.error('E2E 실패:', err);
  failed = true;
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? '\nE2E 결과: 실패 ❌' : '\nE2E 결과: 통과 ✅ (스크린샷: docs/screenshots/)');
process.exit(failed ? 1 : 0);
