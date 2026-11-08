import type { WebSocket } from 'ws';
import type { ServerMsg } from '@neon/shared';
import type { Account } from './db';
import type { MatchRunner } from './matchRunner';

export type SessionState = 'new' | 'idle' | 'queue' | 'room' | 'select' | 'match';

let nextId = 1;

export class Session {
  id = nextId++;
  ws: WebSocket;
  account: Account | null = null;
  state: SessionState = 'new';
  roomCode = '';
  selectId = '';
  runner: MatchRunner | null = null;
  /** 대기열에서 관전 중인 매치 */
  specRunner: MatchRunner | null = null;
  heroId = 0;
  alive = true;
  helloPending = false;
  msgCount = 0;
  msgWindow = Date.now();
  ip: string;

  constructor(ws: WebSocket, ip: string) { this.ws = ws; this.ip = ip; }

  get pid() { return this.account?.token ?? 'anon' + this.id; }
  get name() { return this.account?.name ?? '게스트'; }

  send(msg: ServerMsg | object) {
    if (!this.alive || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendBinary(data: Uint8Array) {
    if (!this.alive || this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > 512 * 1024) return; // 느린 연결: 스냅샷 건너뛰기 (델타 기준은 ack로 유지)
    this.ws.send(data, { binary: true });
  }

  /** 초당 메시지 수 제한 */
  allow(): boolean {
    const now = Date.now();
    if (now - this.msgWindow > 1000) { this.msgWindow = now; this.msgCount = 0; }
    return ++this.msgCount <= 80;
  }
}
