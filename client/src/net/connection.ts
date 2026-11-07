import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@neon/shared';
import { netSim, urlParams } from '../settings';

/**
 * 게임 서버 WebSocket 주소.
 * - 빌드 시 VITE_SERVER_URL (예: https://neon-drop-xxxx.a.run.app) — Firebase Hosting처럼 서버가 다른 도메인일 때
 * - ?server=주소 로 임시 지정 가능 (테스트용)
 * - 없으면 페이지와 같은 호스트의 /ws
 */
/** 서버가 다른 도메인(무료 호스팅 등)인지 */
export function isRemoteServer(): boolean { return !!(urlParams.get('server') || import.meta.env.VITE_SERVER_URL); }

/** 잠든 무료 서버를 HTTP 요청으로 미리 깨운다 (응답 내용은 필요 없음) */
export function wakeServer() {
  try { void fetch(serverWsUrl().replace(/^ws/, 'http').replace(/\/ws$/, '/health'), { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch { /* 무시 */ }
}

export function serverWsUrl(): string {
  const base = (urlParams.get('server') || import.meta.env.VITE_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (base) {
    const u = base.replace(/^http(s?):\/\//, 'ws$1://');
    return /^wss?:\/\//.test(u) ? `${u}/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${u}/ws`;
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export interface GameTransport {
  sendBinary(d: Uint8Array): void;
  send(m: ClientMsg): void;
  onBinary: (d: Uint8Array) => void;
  onJson: (m: ServerMsg | { type: string; [k: string]: unknown }) => void;
}

/**
 * 서버 연결. HTTPS면 자동으로 WSS.
 * ?lag=ms 는 왕복 지연을 추가하고(편도 절반씩), ?loss=% 는 게임 패킷(바이너리)을 무작위로 버린다.
 */
export class Connection implements GameTransport {
  ws: WebSocket | null = null;
  onBinary: (d: Uint8Array) => void = () => {};
  onJson: (m: ServerMsg | { type: string; [k: string]: unknown }) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  connected = false;
  private retry = 0;
  private closedByUser = false;
  bytesIn = 0;
  bytesOut = 0;
  lastPacketSize = 0;

  connect() {
    const ws = new WebSocket(serverWsUrl());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.retry = 0; this.onOpen(); };
    ws.onclose = () => {
      this.connected = false;
      this.onClose();
      if (!this.closedByUser) {
        const delay = Math.min(5000, 500 * 2 ** this.retry++);
        setTimeout(() => this.connect(), delay);
      }
    };
    ws.onerror = () => { /* onclose에서 재시도 */ };
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') {
        let m: ServerMsg;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.delayIn(() => this.onJson(m), false);
      } else {
        const d = new Uint8Array(ev.data as ArrayBuffer);
        this.bytesIn += d.byteLength; this.lastPacketSize = d.byteLength;
        this.delayIn(() => this.onBinary(d), true);
      }
    };
  }

  private delayIn(fn: () => void, droppable: boolean) {
    if (droppable && netSim.loss > 0 && Math.random() * 100 < netSim.loss) return;
    if (netSim.lag > 0) setTimeout(fn, netSim.lag / 2 + Math.random() * Math.min(20, netSim.lag * 0.1));
    else fn();
  }

  private delayOut(fn: () => void, droppable: boolean) {
    if (droppable && netSim.loss > 0 && Math.random() * 100 < netSim.loss) return;
    if (netSim.lag > 0) setTimeout(fn, netSim.lag / 2);
    else fn();
  }

  send(m: ClientMsg) {
    const text = JSON.stringify(m);
    this.delayOut(() => { if (this.ws?.readyState === 1) this.ws.send(text); }, false);
  }

  sendBinary(d: Uint8Array) {
    this.bytesOut += d.byteLength;
    this.delayOut(() => { if (this.ws?.readyState === 1) this.ws.send(d); }, true);
  }

  hello(token: string | null, name: string | null) {
    this.send({ type: 'hello', token: token ?? undefined, name: name ?? undefined, version: PROTOCOL_VERSION });
  }
}
