import { Match, MatchHost, HERO_IDS, Rng, botName, TICK_MS, type HeroId, type ClientMsg, type ServerMsg, type RosterEntry, DEFAULT_COSMETIC, type Cosmetic, QUICK_CHATS, HERO_BY_ID } from '@neon/shared';
import type { GameTransport } from './connection';

/**
 * 브라우저 안에서 도는 로컬 매치 (영웅 도감 연습장, 타이틀 배경 데모).
 * 네트워크 매치와 똑같이 직렬화된 스냅샷을 주고받아 같은 클라이언트 코드 경로를 쓴다.
 */
export class LocalServer implements GameTransport {
  match: Match;
  host: MatchHost;
  onBinary: (d: Uint8Array) => void = () => {};
  onJson: (m: ServerMsg | { type: string; [k: string]: unknown }) => void = () => {};
  private timer = 0;
  private next = 0;
  you: number;
  roster: RosterEntry[];
  mode: 'practice' | 'demo' | 'solo';
  seed: number;
  ended = false;

  constructor(mode: 'practice' | 'demo' | 'solo', heroId: HeroId, cos: Cosmetic = DEFAULT_COSMETIC, name = '나', botLevel = 1) {
    this.mode = mode;
    this.seed = (Math.random() * 1e9) | 0;
    const rng = new Rng(this.seed);
    const solo = [{ pid: 'me', name, heroId, isBot: false, botLevel: 1, cos }, ...Array.from({ length: 9 }, (_, i) => ({ pid: 'b' + i, name: botName(() => rng.next()), heroId: rng.pick(HERO_IDS), isBot: true, botLevel, cos: { ...DEFAULT_COSMETIC, palette: rng.int(0, 4), skin: rng.int(0, 2) } }))];
    const players = mode === 'solo' ? solo : mode === 'practice'
      ? [{ pid: 'me', name, heroId, isBot: false, botLevel: 1, cos }, ...[0, 1, 2, 3].map(i => ({ pid: 'd' + i, name: `허수아비 ${i + 1}`, heroId: HERO_IDS[(i * 3 + 1) % 8], isBot: true, botLevel: 0, dummy: true, cos: { ...DEFAULT_COSMETIC } }))]
      : Array.from({ length: 10 }, (_, i) => ({ pid: 'b' + i, name: botName(() => rng.next()), heroId: rng.pick(HERO_IDS), isBot: true, botLevel: 1 + (i % 2), cos: { ...DEFAULT_COSMETIC, palette: rng.int(0, 4), skin: rng.int(0, 2) } }));
    this.match = new Match({ seed: this.seed, mode: mode === 'practice' ? 'practice' : 'br', players });
    this.host = new MatchHost(this.match);
    this.you = 1;
    this.roster = this.match.w.heroes.map(h => ({ id: h.id, name: h.name, heroId: h.heroId, cos: h.cos, isBot: h.isBot, title: 0 }));
    this.host.attach(1, d => this.onBinary(d), m => this.onJson(m as ServerMsg));
    if (mode === 'demo') {
      // 관전자: 1번 봇 시점, 입력은 봇이 생성
      this.host.clients.get(1)!.spectate = 1;
    }
  }

  start() {
    this.next = performance.now();
    const loop = () => {
      const now = performance.now();
      let n = 0;
      while (now >= this.next && n < 3) { this.step(); this.next += TICK_MS; n++; }
      if (now - this.next > 300) this.next = now;
      this.timer = window.setTimeout(loop, Math.max(1, this.next - performance.now()));
    };
    loop();
  }

  private step() {
    if (this.mode === 'demo') {
      // 데모: 봇 입력을 그대로 사용하도록 호스트의 입력 덮어쓰기를 막는다
      const c = this.host.clients.get(1)!;
      c.queue.length = 0;
      const h = this.match.w.hero(1)!;
      c.lastInput = { ...h.input };
    }
    this.host.step();
    if (this.match.phase === 'end' && !this.ended) this.ended = true;
  }

  stop() { clearTimeout(this.timer); }

  sendBinary(d: Uint8Array) { if (this.mode !== 'demo') this.host.receiveBinary(1, d); }

  send(m: ClientMsg) {
    const h = this.match.w.hero(1)!;
    switch (m.type) {
      case 'pickAug': this.match.pickAugment(1, m.idx); break;
      case 'emote': this.match.emote(1, m.idx); break;
      case 'chat': this.onJson({ type: 'chat', from: h.name, text: m.text.slice(0, 120) }); break;
      case 'quick': {
        const lines = HERO_BY_ID[h.heroId].lines;
        const text = m.idx < QUICK_CHATS.length ? QUICK_CHATS[m.idx] : lines[(m.idx - QUICK_CHATS.length) % lines.length];
        this.onJson({ type: 'chat', from: h.name, text, quick: true });
        break;
      }
      case 'spectate': this.host.setSpectate(1, m.target); break;
    }
  }

  cheat(what: 'level' | 'reset' | 'ult') { this.match.practiceCheat(1, what); }
}
