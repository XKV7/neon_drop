import { randomBytes } from 'node:crypto';
import {
  HERO_IDS, HERO_SELECT_SEC, accountLevel, QUEUE_WAIT_SEC, MAX_PLAYERS, PROTOCOL_VERSION, RECONNECT_GRACE_SEC, Rng, SHOP_BY_ID, botName, filterChat, isFreeItem, heroPalettes, SKIN_NAMES,
  type ClientMsg, type Cosmetic, type HeroId, type ResultRow, type ServerMsg, type ServerInfo,
} from '@neon/shared';
import { applyResult, toProfile, type Account, type AccountStore } from './db';
import { MatchRunner, type Participant } from './matchRunner';
import { Session } from './session';

interface Room { code: string; host: string; members: Session[]; botFill: boolean; botLevel: number }
interface SelectSlot { pid: string; name: string; session: Session | null; heroId: HeroId | null; locked: boolean; isBot: boolean; botLevel: number; cos: Cosmetic | null }
interface Select { id: string; slots: SelectSlot[]; deadline: number; botFill: boolean; botLevel: number; started: boolean }

const NAME_RE = /^[\p{L}\p{N}_\-. ]{2,12}$/u;

export interface LobbyOptions {
  /** 동시에 진행할 수 있는 판 수 (무료 서버 CPU 기준 기본 2) */
  maxMatches: number;
  /** 사설 방을 열 수 있는 계정 레벨. null 이면 사설 방은 '준비 중' */
  privateMinLevel: number | null;
}

export class Lobby {
  store: AccountStore;
  opts: LobbyOptions;
  sessions = new Set<Session>();
  queue: Session[] = [];
  queueDeadline = 0;
  rooms = new Map<string, Room>();
  selects = new Map<string, Select>();
  runners = new Map<string, MatchRunner>();
  /** 재접속 대기: 토큰 → (매치, 끊긴 시각) */
  graces = new Map<string, { runner: MatchRunner; at: number }>();
  rng = new Rng(Date.now() & 0xffffffff);
  private timer: NodeJS.Timeout;

  constructor(store: AccountStore, opts: LobbyOptions = { maxMatches: 2, privateMinLevel: null }) {
    this.store = store;
    this.opts = opts;
    this.timer = setInterval(() => this.update(), 250);
  }

  close() { clearInterval(this.timer); for (const r of this.runners.values()) r.stop(); }

  stats() {
    return { sessions: this.sessions.size, queue: this.queue.length, rooms: this.rooms.size, selects: this.selects.size, matches: this.runners.size,
      activeMatches: this.activeSlots(), maxMatches: this.opts.maxMatches, spectators: [...this.runners.values()].reduce((n, r) => n + r.spectators.size, 0),
      tickMs: [...this.runners.values()].map(r => Number(r.tickCost.toFixed(3))) };
  }

  connect(s: Session) { this.sessions.add(s); }

  get serverInfo(): ServerInfo { return { maxMatches: this.opts.maxMatches, privateMinLevel: this.opts.privateMinLevel }; }

  /** 자리를 차지한 판 수: 영웅 선택 중 + 진행 중(결과 처리 전) */
  activeSlots(): number {
    let n = 0;
    for (const sel of this.selects.values()) if (!sel.started) n++;
    for (const r of this.runners.values()) if (!r.finished) n++;
    return n;
  }
  private hasCapacity() { return this.activeSlots() < this.opts.maxMatches; }

  /** 대기 중인 사람을 진행 중인 판의 관전자로 붙인다 (사람이 많이 살아 있는 판 우선) */
  private attachSpectate(s: Session) {
    if (s.specRunner?.spectatable) return;
    const cands = [...this.runners.values()].filter(r => r.spectatable).sort((a, b) => b.aliveHumans() - a.aliveHumans());
    // 옮겨 갈 판이 없으면 관전 종료를 알려 대기 화면으로
    if (s.specRunner) s.specRunner.detachSpectator(s, !cands[0]);
    if (cands[0]) cands[0].attachSpectator(s);
  }

  private stopSpectate(s: Session, notify: boolean) { s.specRunner?.detachSpectator(s, notify); s.specRunner = null; }

  disconnect(s: Session) {
    s.alive = false;
    this.sessions.delete(s);
    this.leaveQueue(s);
    this.stopSpectate(s, false);
    this.leaveRoom(s);
    this.leaveSelect(s);
    if (s.runner) {
      const r = s.runner;
      r.detach(s);
      const h = r.match.w.hero(s.heroId);
      if (!r.finished && h && h.state !== 'dead' && s.account) this.graces.set(s.account.token, { runner: r, at: Date.now() });
      s.runner = null;
    }
  }

  // ───────── 메시지 처리 ─────────
  handle(s: Session, msg: ClientMsg) {
    if (msg.type === 'hello') { void this.hello(s, msg); return; }
    if (!s.account) return s.send({ type: 'error', text: '먼저 접속 인사(hello)가 필요합니다.' });
    switch (msg.type) {
      case 'setName': {
        const name = String(msg.name ?? '').trim();
        if (!NAME_RE.test(name) || filterChat(name) !== name) return s.send({ type: 'error', text: '닉네임은 2~12자, 금칙어 없이 입력하세요.' });
        s.account.name = name; this.persist(s.account);
        return s.send({ type: 'profile', profile: toProfile(s.account) });
      }
      case 'queue': return this.joinQueue(s);
      case 'leaveQueue': this.leaveQueue(s); s.state = 'idle'; return;
      case 'createRoom': return this.createRoom(s);
      case 'joinRoom': return this.joinRoom(s, String(msg.code ?? ''));
      case 'leaveRoom': this.leaveRoom(s); s.state = 'idle'; return;
      case 'roomSettings': {
        const r = this.rooms.get(s.roomCode);
        if (!r || r.host !== s.pid) return;
        r.botFill = !!msg.botFill; r.botLevel = Math.max(0, Math.min(2, Number(msg.botLevel) | 0));
        return this.broadcastRoom(r);
      }
      case 'startRoom': {
        const r = this.rooms.get(s.roomCode);
        if (!r || r.host !== s.pid) return;
        if (!r.botFill && r.members.length < 2) return s.send({ type: 'error', text: '봇 채우기를 끄면 2명 이상이 필요합니다.' });
        if (!this.hasCapacity()) return s.send({ type: 'error', text: `서버의 동시 진행 판이 가득 찼습니다 (${this.opts.maxMatches}판). 잠시 후 다시 시작해 주세요.` });
        this.rooms.delete(r.code);
        return this.startSelect(r.members, r.botFill, r.botLevel);
      }
      case 'pickHero': case 'lockHero': return this.selectAction(s, msg);
      case 'buy': return this.buy(s, msg.item);
      case 'equip': return this.equip(s, msg);
      case 'rematch': return this.rematch(s);
      case 'leaveMatch': {
        if (s.runner) { const r = s.runner; r.detach(s); s.runner = null; }
        s.state = 'idle'; s.heroId = 0;
        return s.send({ type: 'profile', profile: toProfile(s.account) });
      }
      default:
        if (s.runner) s.runner.handle(s, msg as { type: string });
        else if (s.specRunner && msg.type === 'spectate') s.specRunner.host.setSpectatorTarget(s.id, Number(msg.target) | 0);
    }
  }

  /** 저장 실패는 게임 진행을 막지 않고 기록만 남긴다 */
  private persist(a: Account) { this.store.save(a).catch(e => console.error('계정 저장 실패', a.token.slice(0, 6), e)); }

  /** 접속 중이면 메모리 계정, 아니면 저장소에서 로드 */
  private async accountFor(token: string): Promise<Account | null> {
    for (const s of this.sessions) if (s.account?.token === token) return s.account;
    return this.store.load(token);
  }

  private async hello(s: Session, msg: { token?: string; name?: string; version: number }) {
    if (msg.version !== PROTOCOL_VERSION) return s.send({ type: 'error', text: '게임이 업데이트되었습니다. 새로고침 해주세요.' });
    if (s.helloPending) return;
    s.helloPending = true;
    let acc: Account | null;
    try {
      acc = msg.token ? await this.accountFor(String(msg.token)) : null;
      if (!acc) {
        let name = String(msg.name ?? '').trim();
        if (!NAME_RE.test(name) || filterChat(name) !== name) name = '게스트' + Math.floor(1000 + Math.random() * 9000);
        acc = await this.store.create(name);
      }
    } catch (e) {
      console.error('계정 로드 실패', e);
      s.helloPending = false;
      return s.send({ type: 'error', text: '계정 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.' });
    }
    s.helloPending = false;
    if (!s.alive) return;
    // 같은 계정의 다른 연결은 종료
    for (const o of this.sessions) if (o !== s && o.account?.token === acc.token) { o.send({ type: 'error', text: '다른 곳에서 접속했습니다.' }); o.ws.close(); }
    s.account = acc; s.state = 'idle';
    s.send({ type: 'welcome', token: acc.token, profile: toProfile(acc), server: this.serverInfo });
    // 재접속
    const g = this.graces.get(acc.token);
    if (g && !g.runner.finished && Date.now() - g.at < RECONNECT_GRACE_SEC * 1000) {
      this.graces.delete(acc.token);
      g.runner.attach(s, true);
    } else {
      // 진행 중 매치에 아직 살아있는 캐릭터가 있으면 복귀 (끊김 감지 전 재접속)
      for (const r of this.runners.values()) {
        const hid = r.heroOf.get(acc.token);
        if (hid && !r.finished && r.match.w.hero(hid)!.state !== 'dead' && !r.sessions.get(hid)?.alive) { r.attach(s, true); break; }
      }
    }
  }

  // ───────── 빠른 시작 대기열 ─────────
  private joinQueue(s: Session) {
    if (s.state !== 'idle') return;
    if (this.queue.length === 0) this.queueDeadline = Date.now() + QUEUE_WAIT_SEC * 1000;
    this.queue.push(s); s.state = 'queue';
    if (this.queue.length >= MAX_PLAYERS) this.flushQueue();
    if (s.state === 'queue' && !this.hasCapacity()) this.attachSpectate(s);
    this.broadcastQueue();
  }

  private leaveQueue(s: Session) {
    const i = this.queue.indexOf(s);
    if (i >= 0) { this.queue.splice(i, 1); this.stopSpectate(s, false); this.broadcastQueue(); }
  }

  private broadcastQueue() {
    const full = !this.hasCapacity();
    const timeLeft = full ? 0 : Math.max(0, Math.ceil((this.queueDeadline - Date.now()) / 1000));
    const active = this.activeSlots();
    this.queue.forEach((q, i) => q.send({ type: 'queueStatus', count: this.queue.length, timeLeft, position: i + 1, full, active, max: this.opts.maxMatches }));
  }

  private flushQueue() {
    if (!this.hasCapacity()) return;
    const group = this.queue.splice(0, MAX_PLAYERS);
    for (const s of group) this.stopSpectate(s, false);
    if (group.length) this.startSelect(group, true, 1);
    if (this.queue.length) this.queueDeadline = Date.now() + QUEUE_WAIT_SEC * 1000;
  }

  // ───────── 사설 방 ─────────
  /** 사설 방 이용 가능 여부 (null 이면 문제없음, 아니면 안내 문구) */
  private privateBlocked(s: Session): string | null {
    const min = this.opts.privateMinLevel;
    if (min === null) return '사설 방은 준비 중입니다. 빠른 시작이나 혼자 하기를 이용해 주세요.';
    const lv = accountLevel(s.account?.stats.xp ?? 0).level;
    if (lv < min) return `사설 방은 계정 레벨 ${min} 이상부터 열 수 있습니다 (현재 ${lv}).`;
    return null;
  }

  private createRoom(s: Session) {
    if (s.state !== 'idle') return;
    const blocked = this.privateBlocked(s);
    if (blocked) return s.send({ type: 'error', text: blocked });
    let code = '';
    do code = String(Math.floor(1000 + Math.random() * 9000)); while (this.rooms.has(code));
    const r: Room = { code, host: s.pid, members: [s], botFill: true, botLevel: 1 };
    this.rooms.set(code, r);
    s.state = 'room'; s.roomCode = code;
    this.broadcastRoom(r);
  }

  private joinRoom(s: Session, code: string) {
    if (s.state !== 'idle') return;
    const blocked = this.privateBlocked(s);
    if (blocked) return s.send({ type: 'error', text: blocked });
    const r = this.rooms.get(code.trim());
    if (!r) return s.send({ type: 'error', text: '존재하지 않는 방 코드입니다.' });
    if (r.members.length >= MAX_PLAYERS) return s.send({ type: 'error', text: '방이 가득 찼습니다.' });
    r.members.push(s); s.state = 'room'; s.roomCode = code;
    this.broadcastRoom(r);
  }

  private leaveRoom(s: Session) {
    const r = this.rooms.get(s.roomCode);
    s.roomCode = '';
    if (!r) return;
    r.members = r.members.filter(m => m !== s);
    if (r.members.length === 0) { this.rooms.delete(r.code); return; }
    if (r.host === s.pid) r.host = r.members[0].pid;
    this.broadcastRoom(r);
  }

  private broadcastRoom(r: Room) {
    const hostName = r.members.find(m => m.pid === r.host)?.name ?? '';
    for (const m of r.members) m.send({ type: 'room', code: r.code, host: hostName, you: m.pid === r.host ? 'host' : 'member', players: r.members.map(x => ({ pid: x.pid.slice(0, 8), name: x.name })), botFill: r.botFill, botLevel: r.botLevel } satisfies ServerMsg);
  }

  // ───────── 영웅 선택 ─────────
  private startSelect(humans: Session[], botFill: boolean, botLevel: number) {
    const id = randomBytes(6).toString('hex');
    const slots: SelectSlot[] = humans.slice(0, MAX_PLAYERS).map(h => ({ pid: h.pid, name: h.name, session: h, heroId: null, locked: false, isBot: false, botLevel: 0, cos: null }));
    if (botFill) {
      const used = new Set(slots.map(s => s.name));
      while (slots.length < MAX_PLAYERS) {
        let n = botName(() => this.rng.next());
        while (used.has(n)) n = botName(() => this.rng.next());
        used.add(n);
        slots.push({ pid: 'bot:' + randomBytes(4).toString('hex'), name: n, session: null, heroId: null, locked: false, isBot: true, botLevel, cos: null });
      }
    }
    const sel: Select = { id, slots, deadline: Date.now() + HERO_SELECT_SEC * 1000, botFill, botLevel, started: false };
    this.selects.set(id, sel);
    for (const h of humans) { h.state = 'select'; h.selectId = id; h.roomCode = ''; }
    // 봇은 조금씩 시간차를 두고 선택
    sel.slots.filter(x => x.isBot).forEach((b, i) => setTimeout(() => { if (!sel.started) { b.heroId = this.rng.pick(HERO_IDS); b.locked = true; this.broadcastSelect(sel); } }, 1200 + i * 700 + this.rng.next() * 3000));
    this.broadcastSelect(sel);
  }

  private broadcastSelect(sel: Select) {
    const timeLeft = Math.max(0, Math.ceil((sel.deadline - Date.now()) / 1000));
    for (const sl of sel.slots) {
      if (!sl.session || !sl.session.alive) continue;
      sl.session.send({
        type: 'heroSelect', timeLeft, you: sl.pid.slice(0, 8),
        players: sel.slots.map(x => ({ pid: x.pid.slice(0, 8), name: x.name, heroId: x.heroId, locked: x.locked, isBot: x.isBot })),
        loadout: sl.session.account!.loadout,
      } satisfies ServerMsg);
    }
  }

  private selectAction(s: Session, msg: ClientMsg) {
    const sel = this.selects.get(s.selectId);
    if (!sel || sel.started) return;
    const slot = sel.slots.find(x => x.session === s);
    if (!slot || slot.locked) return;
    if (msg.type === 'pickHero') { if (HERO_IDS.includes(msg.heroId)) slot.heroId = msg.heroId; }
    else if (msg.type === 'lockHero' && slot.heroId) slot.locked = true;
    this.broadcastSelect(sel);
    if (sel.slots.every(x => x.isBot || x.locked)) sel.deadline = Math.min(sel.deadline, Date.now() + 1500);
  }

  private leaveSelect(s: Session) {
    const sel = this.selects.get(s.selectId);
    if (!sel || sel.started) return;
    const slot = sel.slots.find(x => x.session === s);
    if (slot) { slot.session = null; slot.isBot = true; slot.botLevel = sel.botLevel || 1; slot.name = slot.name + ' (봇)'; if (!slot.heroId) slot.heroId = this.rng.pick(HERO_IDS); slot.locked = true; }
    if (sel.slots.every(x => x.isBot)) this.selects.delete(sel.id);
    else this.broadcastSelect(sel);
  }

  private cosFor(acc: Account | null, hero: HeroId): Cosmetic {
    if (!acc) return { palette: this.rng.int(0, 4), skin: this.rng.int(0, 2), kill: this.rng.int(0, 4), drop: this.rng.int(0, 4), title: 0, emotes: [0, 1, 2] };
    const l = acc.loadout;
    return { palette: l.palette[hero] ?? 0, skin: l.skin[hero] ?? 0, kill: l.kill, drop: l.drop, title: l.title, emotes: l.emotes.length ? l.emotes : [0, 1] };
  }

  private launch(sel: Select) {
    sel.started = true;
    this.selects.delete(sel.id);
    for (const sl of sel.slots) if (!sl.heroId) sl.heroId = this.rng.pick(HERO_IDS);
    const parts: Participant[] = sel.slots.map(sl => ({
      session: sl.session && sl.session.alive ? sl.session : null, pid: sl.pid, name: sl.name, heroId: sl.heroId!, isBot: sl.isBot || !sl.session,
      botLevel: sl.isBot ? sl.botLevel : 1, cos: this.cosFor(sl.session?.account ?? null, sl.heroId!),
    }));
    if (parts.every(p => p.isBot)) return;
    const id = randomBytes(6).toString('hex');
    const runner = new MatchRunner(id, (Math.random() * 0x7fffffff) | 0, parts, {
      onResult: (r, pid, row, credits) => this.onResult(r, pid, row, credits),
      onFinished: r => this.onFinished(r),
    }, { botFill: sel.botFill, botLevel: sel.botLevel });
    this.runners.set(id, runner);
    runner.start();
  }

  private onResult(_r: MatchRunner, pid: string, row: ResultRow, credits: number) {
    void (async () => {
      const acc = await this.accountFor(pid);
      if (!acc) return;
      applyResult(acc, row.heroId, row.placement, row.kills, credits, row.survival);
      this.persist(acc);
      for (const s of this.sessions) if (s.account === acc) s.send({ type: 'profile', profile: toProfile(acc) });
    })().catch(e => console.error('결과 저장 실패', e));
  }

  private onFinished(r: MatchRunner) {
    const win = r.match.w.hero(r.match.winner);
    this.store.recordMatch(r.id, win?.name ?? '', r.parts.length, r.match.w.tick / 30).catch(e => console.error('매치 기록 실패', e));
    // 매치 객체는 재대결 대기를 위해 잠시 유지
    setTimeout(() => { this.runners.delete(r.id); for (const [k, g] of this.graces) if (g.runner === r) this.graces.delete(k); }, 60_000);
  }

  // ───────── 재대결 ─────────
  private rematch(s: Session) {
    const r = s.runner;
    if (!r) return;
    if (!r.rematch) r.rematch = { pids: new Set(), deadline: Date.now() + 15_000 };
    r.rematch.pids.add(s.pid);
    this.broadcastRematch(r);
  }

  private broadcastRematch(r: MatchRunner) {
    if (!r.rematch) return;
    const humans = r.connectedHumans().filter(x => x.runner === r);
    const timeLeft = Math.max(0, Math.ceil((r.rematch.deadline - Date.now()) / 1000));
    for (const h of humans) h.send({ type: 'rematchStatus', count: r.rematch.pids.size, total: humans.length, timeLeft });
    if (humans.length > 0 && humans.every(h => r.rematch!.pids.has(h.pid))) this.launchRematch(r);
  }

  private launchRematch(r: MatchRunner) {
    const group = r.connectedHumans().filter(h => r.rematch!.pids.has(h.pid) && h.runner === r);
    r.rematch = null;
    for (const h of group) { r.detach(h); h.runner = null; h.heroId = 0; h.state = 'idle'; }
    if (!group.length) return;
    if (this.hasCapacity()) { this.startSelect(group, r.botFill || group.length < 2, r.botLevel); return; }
    // 자리가 없으면 대기열 맨 앞에서 관전하며 기다린다
    if (this.queue.length === 0) this.queueDeadline = Date.now();
    this.queue.unshift(...group);
    for (const h of group) { h.state = 'queue'; this.attachSpectate(h); }
    this.broadcastQueue();
  }

  // ───────── 상점 ─────────
  private buy(s: Session, itemId: string) {
    const acc = s.account!;
    const item = SHOP_BY_ID[itemId];
    if (!item) return s.send({ type: 'error', text: '존재하지 않는 상품입니다.' });
    if (acc.owned.includes(item.id)) return s.send({ type: 'error', text: '이미 보유한 상품입니다.' });
    if (acc.credits < item.price) return s.send({ type: 'error', text: '크레딧이 부족합니다.' });
    acc.credits -= item.price;
    acc.owned.push(item.id);
    this.persist(acc);
    s.send({ type: 'toast', text: `「${item.name}」 구매 완료!` });
    s.send({ type: 'profile', profile: toProfile(acc) });
  }

  private equip(s: Session, msg: Extract<ClientMsg, { type: 'equip' }>) {
    const acc = s.account!;
    const idx = Number(msg.idx) | 0;
    const owns = (id: string) => isFreeItem(id) || acc.owned.includes(id);
    const l = acc.loadout;
    switch (msg.kind) {
      case 'palette':
        if (!msg.hero || !HERO_IDS.includes(msg.hero) || idx < 0 || idx >= heroPalettes(msg.hero).length || !owns(`pal:${msg.hero}:${idx}`)) return;
        l.palette[msg.hero] = idx; break;
      case 'skin':
        if (!msg.hero || !HERO_IDS.includes(msg.hero) || idx < 0 || idx >= SKIN_NAMES[msg.hero].length || !owns(`skin:${msg.hero}:${idx}`)) return;
        l.skin[msg.hero] = idx; break;
      case 'kill': if (!owns(`kill:${idx}`)) return; l.kill = idx; break;
      case 'drop': if (!owns(`drop:${idx}`)) return; l.drop = idx; break;
      case 'title': if (!owns(`title:${idx}`)) return; l.title = idx; break;
      case 'emote': {
        if (!owns(`emote:${idx}`)) return;
        const set = new Set(l.emotes);
        if (set.has(idx)) set.delete(idx); else set.add(idx);
        l.emotes = [...set].slice(0, 6); break;
      }
      default: return;
    }
    this.persist(acc);
    s.send({ type: 'profile', profile: toProfile(acc) });
  }

  // ───────── 주기 업데이트 ─────────
  private lastBroadcast = 0;
  private update() {
    const now = Date.now();
    if (this.queue.length && (now >= this.queueDeadline || this.queue.length >= MAX_PLAYERS)) this.flushQueue();
    // 아직 자리가 없으면 대기자는 관전 (관전하던 판이 끝났으면 다른 판으로)
    if (this.queue.length && !this.hasCapacity()) for (const q of this.queue) if (!q.specRunner || q.specRunner.finished) this.attachSpectate(q);
    for (const sel of [...this.selects.values()]) if (!sel.started && now >= sel.deadline) this.launch(sel);
    if (now - this.lastBroadcast >= 1000) {
      this.lastBroadcast = now;
      if (this.queue.length) this.broadcastQueue();
      for (const sel of this.selects.values()) this.broadcastSelect(sel);
      for (const r of this.runners.values()) {
        if (r.rematch) {
          if (now >= r.rematch.deadline && r.rematch.pids.size) this.launchRematch(r);
          else this.broadcastRematch(r);
        }
      }
    }
    for (const [k, g] of this.graces) if (now - g.at > RECONNECT_GRACE_SEC * 1000 + 2000) this.graces.delete(k);
    // 사람이 모두 나간 매치 정리
    for (const r of this.runners.values()) {
      if (!r.finished && r.connectedHumans().length === 0 && now - r.createdAt > 5000) {
        const anyGrace = [...this.graces.values()].some(g => g.runner === r);
        if (!anyGrace) { r.stop(); r.finished = true; this.runners.delete(r.id); }
      }
    }
  }
}
