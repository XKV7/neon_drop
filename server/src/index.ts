import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { ClientMsg } from '@neon/shared';
import { openStore } from './db';
import { Lobby } from './lobby';
import { Session } from './session';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR ?? resolve(here, '../../data');
const STATIC_DIR = process.env.STATIC_DIR ?? resolve(here, '../../client/dist');
const startedAt = Date.now();

const store = await openStore(process.env, join(DATA_DIR, 'neon-drop.db'));
const lobby = new Lobby(store);
/** 다른 도메인(예: Firebase Hosting)에서 접속을 허용할 출처 목록. 비우면 모두 허용 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const originAllowed = (origin: string | undefined) => !ALLOWED_ORIGINS.length || !origin || ALLOWED_ORIGINS.includes(origin);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = normalize(join(STATIC_DIR, p));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end(); }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const data = await readFile(file);
    const cache = p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    const index = join(STATIC_DIR, 'index.html');
    if (existsSync(index) && !extname(p)) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(await readFile(index));
    } else { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('찾을 수 없습니다'); }
  }
}

const server = createServer((req, res) => {
  if (req.url === '/health' || req.url?.startsWith('/health?')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000), store: store.kind, ...lobby.stats(), memoryMB: Math.round(process.memoryUsage().rss / 1048576) }));
  }
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('네온 낙하 서버 실행 중. 개발 모드에서는 Vite 주소(기본 5173)로 접속하세요.');
  }
  void serveStatic(req, res);
});

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false,
  verifyClient: (info: { origin?: string }) => originAllowed(info.origin),
});
wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '';
  const s = new Session(ws, ip);
  lobby.connect(s);
  ws.on('message', (data, isBinary) => {
    if (!s.allow()) return;
    if (isBinary) {
      if (!s.runner || !s.heroId) return;
      const buf = data instanceof Buffer ? data : Buffer.concat(data as Buffer[]);
      if (buf.byteLength > 512) return;
      s.runner.host.receiveBinary(s.heroId, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      return;
    }
    const text = data.toString();
    if (text.length > 2048) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    try { lobby.handle(s, msg); } catch (e) { console.error('메시지 처리 오류', e); }
  });
  ws.on('close', () => lobby.disconnect(s));
  ws.on('error', () => lobby.disconnect(s));
});

// 끊긴 연결 감지
setInterval(() => { for (const c of wss.clients) { const x = c as typeof c & { _alive?: boolean }; if (x._alive === false) { c.terminate(); continue; } x._alive = false; c.ping(); } }, 10_000);
wss.on('connection', ws => { const x = ws as typeof ws & { _alive?: boolean }; x._alive = true; ws.on('pong', () => (x._alive = true)); });

server.listen(PORT, HOST, () => {
  console.log(`\n  ▶ 네온 낙하 서버 실행: http://localhost:${PORT}`);
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) console.log(`    LAN: http://${n.address}:${PORT}`);
  console.log(`    상태 확인: http://localhost:${PORT}/health`);
  console.log(`    계정 저장소: ${store.kind}${ALLOWED_ORIGINS.length ? ` · 허용 출처: ${ALLOWED_ORIGINS.join(', ')}` : ''}\n`);
});

const shutdown = () => { lobby.close(); wss.close(); server.close(); store.close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
