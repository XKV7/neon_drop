import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@neon/shared';
import { netSim } from '../settings';

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
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
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
