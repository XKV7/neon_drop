// 개발 모드: 게임 서버(8787)와 Vite(5173)를 함께 실행
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const procs = [];
const run = (name, args, color) => {
  const p = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '1' } });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const out = d => process.stdout.write(d.toString().split('\n').filter(Boolean).map(l => tag + l).join('\n') + '\n');
  p.stdout.on('data', out); p.stderr.on('data', out);
  p.on('exit', code => { console.log(`${tag}종료 (${code})`); shutdown(); });
  procs.push(p);
};
let down = false;
function shutdown() { if (down) return; down = true; for (const p of procs) p.kill('SIGTERM'); setTimeout(() => process.exit(0), 300); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

run('서버', ['run', 'dev', '-w', 'server'], '35');
run('클라', ['run', 'dev', '-w', 'client'], '36');

setTimeout(() => {
  console.log('\n\x1b[95m  ▶ 네온 낙하 개발 서버\x1b[0m');
  console.log('    로컬:  http://localhost:5173');
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) console.log(`    LAN:   http://${n.address}:5173   (같은 네트워크의 친구가 접속)`);
  console.log('    네트워크 테스트: http://localhost:5173/?lag=150&loss=5\n');
}, 2500);
