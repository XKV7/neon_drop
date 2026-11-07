// Firebase Hosting용 클라이언트 빌드: 게임 서버(Cloud Run) 주소가 반드시 들어가야 한다.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let url = process.env.VITE_SERVER_URL ?? '';
const envFile = join(root, 'client', '.env.production');
if (!url && existsSync(envFile)) {
  const m = readFileSync(envFile, 'utf8').match(/^\s*VITE_SERVER_URL\s*=\s*(.+?)\s*$/m);
  if (m) url = m[1].replace(/^["']|["']$/g, '');
}
if (!/^https:\/\/[^\s/]+/.test(url) || url.includes('xxxxxxxxxx')) {
  console.error('\n✗ 게임 서버 주소가 없습니다.');
  console.error('  Cloud Run 배포 후 나온 주소를 client/.env.production 에 넣으세요:');
  console.error('    VITE_SERVER_URL=https://neon-drop-…-du.a.run.app');
  console.error('  (예시: client/.env.production.example)\n');
  process.exit(1);
}
console.log(`게임 서버 주소: ${url}`);
const r = spawnSync('npm', ['run', 'build', '-w', 'client'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_SERVER_URL: url }, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
