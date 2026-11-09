import { Match, MatchHost, TICK_MS, computeCredits, accountXpGain, filterChat, QUICK_CHATS, HERO_BY_ID, type Cosmetic, type HeroId, type MatchMsg, type RosterEntry, type ResultRow, type ServerMsg } from '@neon/shared';
import type { Session } from './session';

export interface Participant { session: Session | null; pid: string; name: string; heroId: HeroId; isBot: boolean; botLevel: number; cos: Cosmetic }

export interface RunnerHooks {
  onResult(runner: MatchRunner, pid: string, row: ResultRow, credits: number): void;
  onFinished(runner: MatchRunner): void;
}

/** 매치 하나의 독립 루프 (30Hz) */
const SNAPSHOT_EVERY = Math.max(1, Math.min(3, Number(process.env.SNAPSHOT_EVERY ?? 2) || 2));

export class MatchRunner {
  id: string;
  match: Match;
  host: MatchHost;
  parts: Participant[];
  heroOf = new Map<string, number>(); // pid → hero id
  sessions = new Map<number, Session>();
  /** 대기열 관전자 */
  spectators = new Set<Session>();
  private timer: NodeJS.Timeout | null = null;
  private nextAt = 0;
  awarded = new Set<string>();
  ended = false;
  endAt = 0;
  finished = false;
  createdAt = Date.now();
  rematch: { pids: Set<string>; deadline: number } | null = null;
  botFill: boolean;
  botLevel: number;
  private chatTimes = new Map<string, number>();
  private hooks: RunnerHooks;
  tickCost = 0;

  constructor(id: string, seed: number, parts: Participant[], hooks: RunnerHooks, opts: { botFill: boolean; botLevel: number }) {
    this.id = id;
    this.parts = parts;
    this.hooks = hooks;
    this.botFill = opts.botFill; this.botLevel = opts.botLevel;
    this.match = new Match({
      seed, mode: 'br', players: parts.map(p => ({ pid: p.pid, name: p.name, heroId: p.heroId, isBot: p.isBot, botLevel: p.botLevel, cos: p.cos })),
      timeScale: Number(process.env.NEON_TIME_SCALE ?? 1) || 1, xpMult: Number(process.env.NEON_XP_MULT ?? 1) || 1,
    });
    this.host = new MatchHost(this.match);
    this.host.onMsg = m => this.onMatchMsg(m);
    parts.forEach((p, i) => this.heroOf.set(p.pid, i + 1));
    for (const p of parts) if (p.session) this.attach(p.session, false);
  }

  roster(): RosterEntry[] {
    return this.match.w.heroes.map(h => ({ id: h.id, name: h.name, heroId: h.heroId, cos: h.cos, isBot: h.isBot, title: h.cos.title }));
  }

  attach(s: Session, reconnect: boolean) {
    const heroId = this.heroOf.get(s.pid);
    if (!heroId) return;
    this.sessions.set(heroId, s);
    s.runner = this; s.heroId = heroId; s.state = 'match';
    s.send({ type: 'matchStart', matchId: this.id, seed: this.match.cfg.seed, you: heroId, roster: this.roster(), mode: 'br', reconnect } satisfies ServerMsg);
    this.host.attach(heroId, d => s.sendBinary(d), m => s.send(m as ServerMsg));
    if (this.ended) this.sendResults(s);
  }

  attachSpectator(s: Session) {
    this.spectators.add(s);
    s.specRunner = this;
    s.send({ type: 'matchStart', matchId: this.id, seed: this.match.cfg.seed, you: 0, roster: this.roster(), mode: 'br', reconnect: false, spectator: true } satisfies ServerMsg);
    this.host.attachSpectator(s.id, d => s.sendBinary(d), m => s.send(m as ServerMsg));
  }

  detachSpectator(s: Session, notify = true) {
    if (!this.spectators.delete(s)) return;
    this.host.detachSpectator(s.id);
    if (s.specRunner === this) s.specRunner = null;
    if (notify) s.send({ type: 'spectateEnd' } satisfies ServerMsg);
  }

  /** 관전자를 받을 수 있는 상태 (끝나지 않은 판) */
  get spectatable() { return !this.finished && !this.ended; }
  aliveHumans() { return this.match.w.heroes.filter(h => !h.isBot && h.state !== 'dead').length; }

  detach(s: Session) {
    if (s.heroId) {
      this.host.detach(s.heroId);
      if (this.sessions.get(s.heroId) === s) this.sessions.delete(s.heroId);
    }
  }

  start() {
    this.nextAt = performance.now();
    const loop = () => {
      const now = performance.now();
      let n = 0;
      // 밀린 틱 수 (최대 4). 따라잡는 동안에는 마지막 틱에만 스냅샷을 보낸다
      const due = Math.min(4, Math.floor((now - this.nextAt) / TICK_MS) + 1);
      while (now >= this.nextAt && n < 4) {
        const t0 = performance.now();
        // 스냅샷은 SNAPSHOT_EVERY틱마다(기본 2 = 15Hz) — 무료 서버(CPU 0.1개)의 부담을 절반으로
        const last = n === due - 1 || n === 3;
        this.host.step(last && this.match.w.tick % SNAPSHOT_EVERY === 0);
        this.tickCost = this.tickCost * 0.95 + (performance.now() - t0) * 0.05;
        this.nextAt += TICK_MS; n++;
      }
      if (now - this.nextAt > 500) this.nextAt = now; // 큰 지연은 따라잡지 않음
      if (this.ended && Date.now() > this.endAt + 1500 && !this.finished) this.finish();
      if (!this.finished) this.timer = setTimeout(loop, Math.max(1, this.nextAt - performance.now()));
    };
    loop();
  }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  humanCount() { return this.parts.filter(p => !p.isBot).length; }
  connectedHumans() { return [...this.sessions.values()].filter(s => s.alive); }

  private onMatchMsg(m: MatchMsg) {
    if (m.type === 'eliminated') {
      const h = this.match.w.hero(m.to);
      if (h && !h.isBot) this.award(h.id);
    }
    if (m.type === 'end') {
      this.ended = true;
      this.endAt = Date.now() + 3500;
      for (const h of this.match.w.heroes) if (!h.isBot) this.award(h.id);
    }
  }

  private award(heroId: number) {
    const h = this.match.w.hero(heroId)!;
    if (this.awarded.has(h.pid)) return;
    this.awarded.add(h.pid);
    const rows = this.match.results();
    const row = rows.find(r => r.id === heroId)!;
    const credits = computeCredits(row.placement, row.kills, row.survival);
    this.hooks.onResult(this, h.pid, row as ResultRow, credits);
  }

  creditsFor(heroId: number) {
    const row = this.match.results().find(r => r.id === heroId)!;
    return computeCredits(row.placement, row.kills, row.survival);
  }

  sendResults(s: Session) {
    if (!s.heroId) return;
    const h = this.match.w.hero(s.heroId)!;
    if (h.state !== 'dead' && !this.ended) return;
    const rows = this.match.results().map(r => ({ ...r, placement: this.ended || this.match.w.hero(r.id)!.state === 'dead' ? r.placement : 0 }));
    const mine = this.match.results().find(r => r.id === s.heroId)!;
    s.send({ type: 'results', rows: rows as ResultRow[], you: s.heroId, credits: this.creditsFor(s.heroId), total: s.account?.credits ?? 0, rematch: this.id, xpGained: accountXpGain(mine.placement, mine.kills, mine.survival) });
  }

  private finish() {
    this.finished = true;
    for (const s of [...this.spectators]) this.detachSpectator(s, true);
    for (const s of this.sessions.values()) if (s.alive && s.runner === this) this.sendResults(s);
    this.stop();
    this.hooks.onFinished(this);
  }

  handle(s: Session, msg: { type: string; [k: string]: unknown }) {
    const heroId = s.heroId;
    if (!heroId) return;
    const h = this.match.w.hero(heroId);
    if (!h) return;
    switch (msg.type) {
      case 'pickAug': this.match.pickAugment(heroId, Number(msg.idx) | 0); break;
      case 'spectate': this.host.setSpectate(heroId, Number(msg.target) | 0); break;
      case 'emote': {
        const idx = Number(msg.idx) | 0;
        if (h.cos.emotes.includes(idx)) this.match.emote(heroId, idx);
        break;
      }
      case 'chat': case 'quick': {
        const now = Date.now();
        if (now - (this.chatTimes.get(s.pid) ?? 0) < 700) return;
        this.chatTimes.set(s.pid, now);
        let text = '';
        if (msg.type === 'chat') text = filterChat(String(msg.text ?? '').trim());
        else {
          const idx = Number(msg.idx) | 0;
          const lines = HERO_BY_ID[h.heroId].lines;
          text = idx < QUICK_CHATS.length ? QUICK_CHATS[idx] : lines[(idx - QUICK_CHATS.length) % lines.length] ?? '';
        }
        if (!text) return;
        const out: ServerMsg = { type: 'chat', from: h.name, text, heroId: h.heroId, quick: msg.type === 'quick' };
        for (const o of this.sessions.values()) if (o.alive) o.send(out);
        break;
      }
      case 'results': this.sendResults(s); break;
    }
  }
}
