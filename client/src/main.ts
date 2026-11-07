import './style.css';
import {
  HEROES, HERO_BY_ID, ROLE_NAMES, AUGMENT_BY_ID, SHOP_ITEMS, heroPalettes, SKIN_NAMES, KILL_EFFECTS, DROP_EFFECTS, EMOTES, TITLES, isFreeItem, BOT_LEVELS,
  type HeroId, type Profile, type ServerMsg, type ResultRow, type ShopItem, TIER_NAMES, Btn,
} from '@neon/shared';
import { Connection, type GameTransport } from './net/connection';
import { LocalServer } from './net/local';
import { ClientGame } from './game/clientGame';
import { Input } from './game/input';
import { Renderer3D } from './render/renderer';
import { WorldView } from './render/worldView';
import { Hud } from './ui/hud';
import { el, esc, hex, stars, skillIcon, heroGlyph, toast, augTip } from './ui/util';
import { audio, music } from './audio/audio';
import { settings, loadSettings, saveSettings, storageGet, storageSet, keyLabel, ACTIONS, DEFAULT_KEYS, netSim, bindKey, actionLabel, type Quality } from './settings';

type Screen = 'title' | 'lobby' | 'queue' | 'room' | 'select' | 'game' | 'shop' | 'profile' | 'settings' | 'codex';

interface MatchCtx { transport: GameTransport; game: ClientGame; world: WorldView; hud: Hud; local: LocalServer | null; results: Extract<ServerMsg, { type: 'results' }> | null; augments: string[] }

class App {
  r3: Renderer3D;
  conn = new Connection();
  input: Input;
  ui = document.getElementById('ui')!;
  screen: Screen = 'title';
  profile: Profile | null = null;
  token: string | null = storageGet('neon.token');
  serverOk = false;
  demo: { local: LocalServer; game: ClientGame; world: WorldView } | null = null;
  match: MatchCtx | null = null;
  room: Extract<ServerMsg, { type: 'room' }> | null = null;
  select: Extract<ServerMsg, { type: 'heroSelect' }> | null = null;
  selHero: HeroId = (storageGet('neon.lastHero') as HeroId) || 'hammerdog';
  queue = { count: 0, timeLeft: 20 };
  rematch: Extract<ServerMsg, { type: 'rematchStatus' }> | null = null;
  shopTab = 'palette';
  shopHero: HeroId = 'hammerdog';
  codexHero: HeroId = 'hammerdog';
  private last = performance.now();
  private rebinding: string | null = null;
  private ignoreClickUntil = 0;
  private lastSolo: HeroId | null = null;
  private soloLevel = 1;
  readonly offline = !!import.meta.env.VITE_OFFLINE;
  private scoreHeld = false;

  constructor() {
    loadSettings();
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.r3 = new Renderer3D(canvas);
    this.input = new Input(canvas);
    this.input.enabled = false;
    this.input.onKey = (code, e) => this.onKey(code, e);
    window.addEventListener('keyup', e => this.onKeyUp(e.code));
    document.addEventListener('pointerdown', () => { audio.init(); audio.applyVolumes(); music.start(); }, { capture: true });
    this.ui.addEventListener('click', e => this.onClick(e));
    // 키 재설정 중에는 마우스 버튼도 지정할 수 있다 (캡처 단계에서 가로챔)
    window.addEventListener('mousedown', e => {
      if (!this.rebinding) return;
      e.preventDefault(); e.stopPropagation();
      this.ignoreClickUntil = performance.now() + 400;
      this.finishRebind('Mouse' + e.button);
    }, { capture: true });
    window.addEventListener('contextmenu', e => { if (this.rebinding || performance.now() < this.ignoreClickUntil) e.preventDefault(); }, { capture: true });
    this.ui.addEventListener('mouseover', e => { const t = (e.target as HTMLElement).closest('.btn,.hero-card,.tab'); if (t && !(t as HTMLElement).dataset.hovered) { (t as HTMLElement).dataset.hovered = '1'; audio.play('uiHover'); setTimeout(() => delete (t as HTMLElement).dataset.hovered, 300); } });
    // 쇼케이스 드래그 회전
    let drag = false, lx = 0;
    canvas.addEventListener('pointerdown', e => { if (this.r3.mode === 'showcase') { drag = true; lx = e.clientX; this.r3.showcase.dragging = true; } });
    window.addEventListener('pointerup', () => { drag = false; this.r3.showcase.dragging = false; });
    window.addEventListener('pointermove', e => { if (drag) { this.r3.showcase.rotate(e.clientX - lx); lx = e.clientX; } });
    this.setupConnection();
    this.startDemo();
    document.getElementById('boot')?.remove();
    this.go('title');
    requestAnimationFrame(t => this.loop(t));
  }

  // ───────────────── 연결 ─────────────────
  private setupConnection() {
    this.conn.onOpen = () => { this.serverOk = true; this.conn.hello(this.token, storageGet('neon.name')); };
    this.conn.onClose = () => { this.serverOk = false; if (this.screen === 'lobby') this.render(); };
    this.conn.onJson = m => this.onServer(m as ServerMsg);
    this.conn.onBinary = d => { if (this.match && !this.match.local) this.match.game.handleBinary(d); };
    if (!this.offline) this.conn.connect();
  }

  private onServer(m: ServerMsg) {
    switch (m.type) {
      case 'welcome':
        this.token = m.token; storageSet('neon.token', m.token); storageSet('neon.name', m.profile.name);
        this.profile = m.profile;
        if (this.screen === 'lobby' || this.screen === 'title') this.render();
        break;
      case 'profile': this.profile = m.profile; storageSet('neon.name', m.profile.name); if (['lobby', 'shop', 'profile'].includes(this.screen)) this.render(); break;
      case 'error': toast(m.text); audio.play('error'); break;
      case 'toast': toast(m.text); audio.play('aug_silver'); break;
      case 'queueStatus': this.queue = { count: m.count, timeLeft: m.timeLeft }; if (this.screen === 'queue') this.render(); else this.go('queue'); break;
      case 'room': this.room = m; this.go('room'); break;
      case 'roomClosed': this.room = null; this.go('lobby'); break;
      case 'heroSelect': {
        const first = this.screen !== 'select';
        this.select = m;
        if (first) { this.endMatch(); this.go('select'); const me = m.players.find(p => p.pid === m.you); if (!me?.heroId) this.conn.send({ type: 'pickHero', heroId: this.selHero }); }
        else this.renderSelectDynamic();
        break;
      }
      case 'matchStart': this.startNetMatch(m); break;
      case 'results': if (this.match) { this.match.results = m; this.showResults(); } break;
      case 'rematchStatus': this.rematch = m; this.updateResultsRematch(); break;
      case 'chat': this.match?.hud.addChat(m.from, m.text, !!m.quick); break;
      case 'scoreboard': this.match?.hud.setScoreboard(m.rows); break;
      default: this.onMatchMsg(m as { type: string; [k: string]: unknown });
    }
  }

  private onMatchMsg(m: { type: string; [k: string]: unknown }) {
    const ctx = this.match;
    if (!ctx) return;
    switch (m.type) {
      case 'feed': ctx.hud.addFeed(m as never); break;
      case 'announce': ctx.hud.announce(String(m.text), String(m.tone)); break;
      case 'augOffer': ctx.hud.setOffer({ options: m.options as string[], deadline: m.deadline as number, source: String(m.source), queue: m.queue as number }); break;
      case 'augGained': {
        ctx.augments.push(String(m.id)); ctx.game.augments = [...ctx.augments];
        ctx.hud.setAugments(ctx.augments); ctx.hud.setOffer(null);
        const a = AUGMENT_BY_ID[String(m.id)]; if (a) toast(`증강 획득: ${a.name}`);
        break;
      }
      case 'augList': ctx.augments = [...(m.ids as string[])]; ctx.game.augments = [...ctx.augments]; ctx.hud.setAugments(ctx.augments); break;
      case 'supplyWarn': audio.play('siren'); break;
      case 'eliminated': ctx.hud.setEliminated(m.placement as number); ctx.hud.setOffer(null); break;
      case 'end': setTimeout(() => { if (this.match === ctx && ctx.local) this.showResults(); }, 3000); break;
      case 'scoreboard': ctx.hud.setScoreboard(m.rows as never); break;
      case 'chat': ctx.hud.addChat(String(m.from), String(m.text), !!m.quick); break;
    }
  }

  // ───────────────── 배경 데모 (타이틀/로비) ─────────────────
  private startDemo() {
    this.stopDemo();
    const local = new LocalServer('demo', 'hammerdog');
    const game = new ClientGame(local, { seed: local.seed, you: 1, roster: local.roster, mode: 'demo' }, null, true);
    local.onBinary = d => game.handleBinary(d);
    local.onJson = () => {};
    const world = new WorldView(game, this.r3.camera, { dmgNumber: () => {}, shake: () => {}, hitstop: () => {}, hurt: () => {}, levelUp: () => {}, onEmote: () => {} }, settings.quality);
    world.orbit = true;
    local.start();
    this.demo = { local, game, world };
  }

  private stopDemo() {
    if (!this.demo) return;
    this.demo.local.stop();
    this.demo.world.dispose();
    this.demo = null;
  }

  // ───────────────── 매치 ─────────────────
  private startNetMatch(m: Extract<ServerMsg, { type: 'matchStart' }>) {
    this.endMatch();
    this.stopDemo();
    const game = new ClientGame(this.conn, { seed: m.seed, you: m.you, roster: m.roster, mode: m.mode }, this.input);
    this.beginMatch(game, this.conn, null);
    if (m.reconnect) toast('진행 중인 판으로 복귀했습니다!');
  }

  startPractice(hero: HeroId, solo = false) {
    this.endMatch();
    this.stopDemo();
    this.lastSolo = solo ? hero : null;
    const cos = { palette: this.profile?.loadout.palette[hero] ?? 0, skin: this.profile?.loadout.skin[hero] ?? 0, kill: this.profile?.loadout.kill ?? 0, drop: this.profile?.loadout.drop ?? 0, title: 0, emotes: this.profile?.loadout.emotes ?? [0, 1] };
    const local = new LocalServer(solo ? 'solo' : 'practice', hero, cos, this.profile?.name ?? storageGet('neon.name') ?? '나', this.soloLevel);
    const game = new ClientGame(local, { seed: local.seed, you: 1, roster: local.roster, mode: solo ? 'br' : 'practice' }, this.input);
    local.onBinary = d => game.handleBinary(d);
    local.onJson = msg => { if ((msg as { type: string }).type === 'chat') this.match?.hud.addChat(String((msg as { from: string }).from), String((msg as { text: string }).text), !!(msg as { quick?: boolean }).quick); else this.onMatchMsg(msg as never); };
    this.beginMatch(game, local, local);
    local.start();
  }

  private beginMatch(game: ClientGame, transport: GameTransport, local: LocalServer | null) {
    const world = new WorldView(game, this.r3.camera, {
      dmgNumber: (x, y, h, amount, kind) => { const p = this.r3.worldToScreen(x, y, h); if (p.vis) this.match?.hud.dmgNumber(p.x, p.y, amount, kind); },
      shake: a => this.match?.world.addShake(a),
      hitstop: ms => this.match?.world.hitstop(ms),
      hurt: amt => { this.r3.hurt = Math.min(1, this.r3.hurt + (amt <= 0 ? 0.06 : 0.25 + amt / 300)); },
      levelUp: () => {},
      onEmote: (id, n) => this.match?.hud.showEmote(id, n),
    }, settings.quality);
    this.ui.innerHTML = '';
    const hud = new Hud(this.ui, game, this.r3, {
      pickAug: i => { transport.send({ type: 'pickAug', idx: i }); audio.play('ui'); },
      spectate: dir => this.cycleSpectate(dir),
      toResults: () => { if (this.match?.results || local) this.showResults(); else this.conn.send({ type: 'results' } as never); },
      chat: t => transport.send({ type: 'chat', text: t }),
      quick: i => transport.send({ type: 'quick', idx: i }),
      emote: i => transport.send({ type: 'emote', idx: i }),
      leave: () => this.leaveMatch(),
      practice: w => local?.cheat(w),
    });
    this.match = { transport, game, world, hud, local, results: null, augments: [] };
    this.input.isChargeSlot = slot => !!game.mySkills()[slot]?.chargeUp;
    this.input.enabled = true;
    this.r3.world = world; this.r3.mode = 'world';
    this.screen = 'game';
    music.theme = 'battle';
    if (game.mode !== 'practice') audio.play('drop');
  }

  private cycleSpectate(dir: number) {
    const m = this.match; if (!m) return;
    const alive = [...m.game.view.values()].filter(v => v.type === 1).map(v => v.id).sort((a, b) => a - b);
    if (!alive.length) return;
    const cur = m.game.viewId();
    const i = alive.indexOf(cur);
    const next = alive[(i + dir + alive.length) % alive.length] ?? alive[0];
    m.transport.send({ type: 'spectate', target: next });
  }

  private endMatch() {
    if (!this.match) return;
    this.match.local?.stop();
    this.match.world.dispose();
    this.match.hud.destroy();
    this.match = null;
    this.r3.world = null;
    this.input.enabled = false;
    this.input.aiming = -1;
    this.r3.lowHp = 0; this.r3.outside = 0; this.r3.hurt = 0;
    music.theme = 'menu'; music.intensity = 0;
  }

  leaveMatch() {
    if (this.match && !this.match.local) this.conn.send({ type: 'leaveMatch' });
    this.endMatch();
    this.startDemo();
    this.go('lobby');
  }

  private showResults() {
    const m = this.match;
    if (!m) return;
    const old = this.ui.querySelector('.overlay.res'); old?.remove();
    const ov = el('div', 'overlay res');
    let rows: ResultRow[], you = m.game.you, credits = 0, total = this.profile?.credits ?? 0;
    if (m.results) { rows = m.results.rows; you = m.results.you; credits = m.results.credits; total = m.results.total; }
    else rows = (m.local!.match.results() as ResultRow[]);
    const me = rows.find(r => r.id === you)!;
    const p = me?.placement ?? 0;
    const head = p === 1 ? '<div class="place glow-pink">#1</div><h2 class="glow-cyan" style="margin:6px 0">최후의 1인! 생중계 우승</h2>' : p ? `<div class="place glow-cyan">#${p}</div><h2 style="margin:6px 0">${p <= 3 ? '아깝다! 상위권 진입' : '다음 드롭을 노려라'}</h2>` : '<h2>결과</h2>';
    const augList = (me?.augments ?? []).map(a => `<span class="aug-ic ${AUGMENT_BY_ID[a]?.tier}" title="${esc(augTip(a))}" style="display:inline-grid">${AUGMENT_BY_ID[a]?.icon}</span>`).join(' ');
    ov.innerHTML = `<div class="panel results">
      ${head}
      <div class="stat-grid"><div class="stat">처치<b>${me?.kills ?? 0}</b></div><div class="stat">가한 피해<b>${me?.damage ?? 0}</b></div><div class="stat">생존 시간<b>${Math.floor((me?.survival ?? 0) / 60)}:${String((me?.survival ?? 0) % 60).padStart(2, '0')}</b></div><div class="stat">레벨<b>${me?.level ?? 1}</b></div></div>
      <div class="row" style="flex-wrap:wrap;gap:6px"><span class="dim">획득 증강</span> ${augList || '<span class="dim">없음</span>'}</div>
      ${m.local ? '' : `<p>획득 크레딧 <span class="credits">+${credits}</span> <span class="dim">(보유 ${total})</span></p>`}
      <table class="res-table"><tr><th>순위</th><th>플레이어</th><th>영웅</th><th>처치</th><th>피해</th></tr>${rows.map(r => `<tr class="${r.id === you ? 'me' : ''}"><td>${r.placement ? '#' + r.placement : '생존 중'}</td><td>${esc(r.name)}</td><td style="color:${hex(HERO_BY_ID[r.heroId].color)}">${HERO_BY_ID[r.heroId].name}</td><td>${r.kills}</td><td>${r.damage}</td></tr>`).join('')}</table>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <span class="dim rematch-status"></span>
        ${m.local ? (this.lastSolo ? '<button class="btn pink big" data-act="solo-again">한 판 더!</button>' : '') : '<button class="btn pink big" data-act="rematch">한 판 더! (같은 사람들과)</button>'}
        <button class="btn" data-act="leave-match">로비로</button>
      </div></div>`;
    this.ui.appendChild(ov);
    audio.play(p === 1 ? 'aug_prism' : 'levelup');
    this.updateResultsRematch();
  }

  private updateResultsRematch() {
    const s = this.ui.querySelector('.rematch-status');
    if (s && this.rematch) s.textContent = `재대결 대기 ${this.rematch.count}/${this.rematch.total} · ${this.rematch.timeLeft}초`;
  }

  // ───────────────── 입력 ─────────────────
  private onKey(code: string, e: KeyboardEvent): boolean {
    if (this.rebinding) {
      if (code === 'Escape') { this.rebinding = null; this.refreshKeyUi(); return true; }
      this.finishRebind(code);
      return true;
    }
    const m = this.match;
    if (code === 'F3') { if (m) m.hud.showDebug = !m.hud.showDebug; return true; }
    if (!m || this.screen !== 'game') return false;
    if (m.hud.chatOpen) return false;
    if (code === settings.keys.score) { if (!this.scoreHeld) { this.scoreHeld = true; m.hud.showScoreboard(true); } return true; }
    if (code === settings.keys.chat) { m.hud.openChat(); return true; }
    if (code === settings.keys.wheel && !e.repeat) { m.hud.toggleWheel(true); return true; }
    if (code === 'Escape') { const ko = this.ui.querySelector('.overlay.keys'); if (ko) ko.remove(); else if (this.input.aiming >= 0) this.input.aiming = -1; else this.toggleEscMenu(); return true; }
    if (m.hud.offer && (code === 'Digit1' || code === 'Digit2' || code === 'Digit3')) { m.transport.send({ type: 'pickAug', idx: Number(code.slice(5)) - 1 }); audio.play('ui'); return true; }
    return false;
  }

  private toggleEscMenu() {
    const old = this.ui.querySelector('.overlay.esc');
    if (old) { old.remove(); return; }
    const local = !!this.match?.local;
    const ov = el('div', 'overlay esc');
    ov.innerHTML = `<div class="panel sub-panel" style="min-width:340px;text-align:center"><h2>일시 메뉴</h2><p class="dim" style="font-size:13px">${local ? '연습장은 언제든 나갈 수 있습니다.' : '게임은 계속 진행 중입니다. 나가면 캐릭터는 20초 뒤 탈락 처리됩니다.'}</p>
      <div class="col"><button class="btn" data-act="esc-close">계속하기</button><button class="btn ghost" data-act="open-keys">키 설정</button><button class="btn pink" data-act="leave-match">${local ? '연습장 나가기' : '판 나가기'}</button></div></div>`;
    this.ui.appendChild(ov);
  }

  // ───────────────── 키 설정 ─────────────────
  private keybindHtml(): string {
    const groups = [...new Set(ACTIONS.map(a => a.group))];
    return `<div class="kgroups">` + groups.map(g => `<div class="kgroup"><h4>${g}</h4><div class="kv">${ACTIONS.filter(a => a.group === g).map(a => {
      const code = settings.keys[a.id];
      const changed = code !== DEFAULT_KEYS[a.id];
      return `<span>${a.label}</span><div class="row" style="gap:6px"><button class="btn small ${this.rebinding === a.id ? 'pink' : 'ghost'} keybind" data-rebind="${a.id}">${this.rebinding === a.id ? '키 또는 마우스 버튼…' : esc(keyLabel(code))}</button>${changed ? `<button class="btn small ghost" data-rebind-default="${a.id}" title="기본값: ${esc(keyLabel(DEFAULT_KEYS[a.id]))}">기본값</button>` : ''}</div>`;
    }).join('')}</div></div>`).join('') + `</div><p class="dim" style="font-size:12px;margin-top:10px">버튼을 누른 뒤 원하는 키나 마우스 버튼(좌/우/휠/4/5)을 누르세요. Esc로 취소합니다. 이미 쓰이는 키를 고르면 두 기능의 키가 서로 바뀝니다. Esc·F3·1~3(증강 선택)은 고정 키입니다.</p>`;
  }

  private finishRebind(code: string) {
    const action = this.rebinding;
    if (!action) return;
    this.rebinding = null;
    const r = bindKey(action, code);
    if (!r.ok) { toast(r.reason ?? '지정할 수 없는 키입니다'); audio.play('error'); }
    else {
      audio.play('ui');
      if (r.swapped) toast(`${keyLabel(code)} 키가 「${actionLabel(r.swapped)}」에서 쓰이고 있어 서로 바꿨습니다 (${actionLabel(r.swapped)} → ${keyLabel(settings.keys[r.swapped])})`);
    }
    this.refreshKeyUi();
  }

  /** 키 설정이 바뀌면 열려 있는 화면(설정, 게임 중 오버레이, HUD)을 갱신 */
  private refreshKeyUi() {
    const ov = this.ui.querySelector('.overlay.keys .keybinds');
    if (ov) ov.innerHTML = this.keybindHtml();
    this.match?.hud.refreshKeys();
    if (this.screen === 'settings') this.render();
  }

  private openKeysOverlay() {
    this.ui.querySelector('.overlay.esc')?.remove();
    this.ui.querySelector('.overlay.keys')?.remove();
    const ov = el('div', 'overlay keys');
    ov.innerHTML = `<div class="panel sub-panel" style="width:min(860px,94vw)"><h2 style="margin-bottom:4px">키 설정</h2><div class="keybinds">${this.keybindHtml()}</div>
      <div class="row" style="margin-top:14px"><button class="btn small ghost" data-act="reset-keys">전체 초기화</button><div class="grow"></div><button class="btn" data-act="close-keys">닫기</button></div></div>`;
    this.ui.appendChild(ov);
  }

  private onKeyUp(code: string) {
    const m = this.match;
    if (!m) return;
    if (code === settings.keys.score) { this.scoreHeld = false; m.hud.showScoreboard(false); }
    if (code === settings.keys.wheel && m.hud.wheelOpen) m.hud.toggleWheel(false);
  }

  // ───────────────── 메인 루프 ─────────────────
  private loop(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const m = this.match;
    if (m) {
      const g = m.game;
      const p = this.r3.screenToGround(this.input.mouseX, this.input.mouseY);
      g.aimX = p.x; g.aimY = p.y;
      const wheel = this.input.takeWheel();
      if (wheel) m.world.zoom = Math.max(0.78, Math.min(1.3, m.world.zoom + wheel * 0.06));
      // 낙하 단계에는 넓게 보기
      const dropping = g.match?.phase === 0 && g.selfState === 0 && g.mode !== 'practice';
      if (dropping) { m.world.zoom += (2.4 - m.world.zoom) * 0.08; m.world.camX *= 0.95; m.world.camZ *= 0.95; }
      else if (m.world.zoom > 1.3) m.world.zoom += (1.0 - m.world.zoom) * 0.06;
      g.update(dt * 1000);
      m.hud.aiming = this.input.aiming;
      const skills = g.mySkills();
      const heldSlot = settings.smartCast ? (['s1', 's2', 's3', 'ult'].findIndex(a => this.input.isDown(a)) + 1 || -1) : -1;
      if (this.input.aiming >= 0 && g.selfState === 2) m.world.setAim(this.input.aiming, skills[this.input.aiming], g.aimX, g.aimY);
      else if (heldSlot > 0 && g.selfState === 2) m.world.setAim(heldSlot, skills[heldSlot], g.aimX, g.aimY);
      else if (g.selfState === 2 && (g.self?.castSlot ?? 255) !== 255 && g.self!.chargeProg > 0) m.world.setAim(g.self!.castSlot, skills[g.self!.castSlot], g.aimX, g.aimY);
      else m.world.setAim(-1, null, 0, 0);
      m.hud.update();
      if (g.match) {
        const frac = 1 - g.match.alive / Math.max(1, g.match.total);
        music.intensity = frac;
        music.theme = g.match.alive <= 3 && g.mode !== 'practice' && g.match.phase === 1 ? 'final' : 'battle';
      }
      if (m.local && m.local.ended && !m.results && !this.ui.querySelector('.overlay.res')) { /* 연습장은 종료 없음 */ }
      this.input.enabled = !m.hud.chatOpen && !m.hud.wheelOpen && !this.rebinding && !this.ui.querySelector('.overlay.keys');
    }
    if (this.demo && !m) {
      this.demo.game.update(dt * 1000);
      if (this.r3.mode === 'world') this.r3.world = this.demo.world;
      // 데모 판이 끝나면 새로 시작
      if (this.demo.local.ended && this.demo.local.match.w.tick - this.demo.local.match.endTick > 150) this.startDemo();
      const v = this.demo.game.view;
      if (v.size && Math.random() < 0.002) { const ids = [...v.values()].filter(x => x.type === 1).map(x => x.id); if (ids.length) this.demo.local.host.setSpectate(1, ids[Math.floor(Math.random() * ids.length)]); }
    }
    this.r3.frame(dt);
    requestAnimationFrame(t2 => this.loop(t2));
  }

  // ───────────────── 화면 전환 ─────────────────
  go(s: Screen) {
    if (this.screen === 'game' && s !== 'game' && this.match) this.endMatch();
    this.screen = s;
    if (s === 'select' || s === 'shop' || s === 'codex') this.r3.mode = 'showcase';
    else if (s !== 'game') { this.r3.mode = 'world'; if (!this.demo) this.startDemo(); this.r3.world = this.demo!.world; }
    this.render();
  }

  render() {
    if (this.screen === 'game') return;
    this.ui.innerHTML = '';
    const scr = el('div', 'screen');
    switch (this.screen) {
      case 'title': this.renderTitle(scr); break;
      case 'lobby': this.renderLobby(scr); break;
      case 'queue': this.renderQueue(scr); break;
      case 'room': this.renderRoom(scr); break;
      case 'select': this.renderSelect(scr); break;
      case 'shop': this.renderShop(scr); break;
      case 'profile': this.renderProfile(scr); break;
      case 'settings': this.renderSettings(scr); break;
      case 'codex': this.renderCodex(scr); break;
    }
    this.ui.appendChild(scr);
  }

  private renderTitle(s: HTMLElement) {
    s.classList.add('center');
    const name = this.profile?.name ?? storageGet('neon.name') ?? '';
    s.innerHTML = `<div class="title-wrap">
      <div class="logo title-text glow-pink">네온 낙하<small>NEON DROP</small></div>
      <div class="lore">2099년, 메가시티 신서울의 버려진 구역. 기업이 생중계하는 불법 데스게임 <b class="glow-cyan">「드롭」</b>.<br>데이터 붕괴가 구역을 지워 나가는 동안, 최후의 1인만이 살아남는다.</div>
      <div class="row"><input class="field" id="nick" maxlength="12" placeholder="닉네임 (2~12자)" value="${esc(name)}" style="width:240px"><button class="btn pink big" data-act="start">드롭 입장</button></div>
      <div class="dim" style="font-size:13px">${this.offline ? '● 오프라인 체험판 — 봇전·연습장을 바로 플레이할 수 있습니다 (친구와 멀티플레이는 서버 배포 필요)' : this.serverOk ? '● 서버 연결됨' : '○ 서버 연결 중… (연결되지 않아도 봇전·연습장은 이용 가능)'}${netSim.lag || netSim.loss ? ` · 네트워크 시뮬레이션: 지연 ${netSim.lag}ms 손실 ${netSim.loss}%` : ''}</div>
    </div>`;
    setTimeout(() => (s.querySelector('#nick') as HTMLInputElement)?.addEventListener('keydown', e => { if (e.key === 'Enter') this.startFromTitle(); }), 0);
  }

  private startFromTitle() {
    const nick = (this.ui.querySelector('#nick') as HTMLInputElement | null)?.value.trim() ?? '';
    audio.init(); music.start();
    if (nick && nick !== this.profile?.name) {
      storageSet('neon.name', nick);
      if (this.profile) this.conn.send({ type: 'setName', name: nick });
      else if (this.serverOk) this.conn.hello(this.token, nick);
    }
    this.go('lobby');
  }

  private renderLobby(s: HTMLElement) {
    s.classList.add('lobby');
    const p = this.profile;
    s.innerHTML = `
      <div class="col">
        <div class="logo title-text glow-pink" style="font-size:44px;margin-bottom:8px">네온 낙하<small style="font-size:12px;letter-spacing:8px">NEON DROP</small></div>
        <div class="menu">
          <button class="btn pink" data-act="quick" ${this.serverOk ? '' : 'disabled'}>빠른 시작<small>20초 모집 · 빈자리는 봇</small></button>
          <button class="btn" data-act="room-menu" ${this.serverOk ? '' : 'disabled'}>사설 방<small>4자리 코드로 친구 초대</small></button>
          <button class="btn pink" data-act="codex">혼자 하기 (봇전)<small>나 + 봇 9명 · 서버 없이 바로</small></button>
          <button class="btn" data-act="codex">영웅 도감<small>스킬 연습장</small></button>
          <button class="btn" data-act="shop" ${p ? '' : 'disabled'}>꾸미기 / 상점<small>네온 색상 · 스킨 · 효과</small></button>
          <button class="btn" data-act="profile" ${p ? '' : 'disabled'}>프로필</button>
          <button class="btn ghost" data-act="settings">설정</button>
        </div>
      </div>
      <div class="grow"></div>
      <div class="col">
        <div class="panel profile-card">
          ${p ? `<div class="dim" style="font-size:12px">${esc(TITLES[p.loadout.title] ?? '')}</div><div style="font-size:22px;font-weight:800">${esc(p.name)}</div>
          <div style="margin-top:8px">크레딧 <span class="credits">${p.credits}</span></div>
          <div class="dim" style="font-size:13px;margin-top:6px">${p.stats.games}판 · 1위 ${p.stats.wins}회 · 처치 ${p.stats.kills}</div>` : `<div class="dim">${this.serverOk ? '계정 불러오는 중…' : '서버에 연결되지 않았습니다. 연습장은 이용할 수 있습니다.'}</div>`}
        </div>
        <div class="panel profile-card hidden" id="roomMenu">
          <h3 style="margin:0 0 10px">사설 방</h3>
          <button class="btn" data-act="create-room" style="width:100%">방 만들기</button>
          <div class="row" style="margin-top:10px"><input class="field grow" id="roomCode" maxlength="4" placeholder="코드 4자리" inputmode="numeric"><button class="btn" data-act="join-room">참가</button></div>
        </div>
        <div class="panel profile-card" style="font-size:13px;line-height:1.7">
          <b>조작</b> <button class="btn small ghost" data-act="settings" style="float:right;padding:2px 8px">변경</button><br><span class="dim">${['up', 'left', 'down', 'right'].map(a => esc(keyLabel(settings.keys[a]))).join('')} 이동 · 마우스 조준 · ${esc(keyLabel(settings.keys.basic))} 기본 공격<br>${['s1', 's2', 's3', 'ult'].map(a => esc(keyLabel(settings.keys[a]))).join('/')} 스킬 · ${esc(keyLabel(settings.keys.dodge))} 구르기 · ${esc(keyLabel(settings.keys.interact))} 상호작용<br>${esc(keyLabel(settings.keys.score))} 점수판 · ${esc(keyLabel(settings.keys.chat))} 채팅 · ${esc(keyLabel(settings.keys.wheel))} 퀵 채팅 · F3 디버그</span>
        </div>
      </div>`;
  }

  private renderQueue(s: HTMLElement) {
    s.classList.add('center');
    s.innerHTML = `<div class="panel queue-box"><div class="spinner"></div><h2 style="margin:0">매칭 중</h2>
      <p>모인 인원 <b class="glow-cyan">${this.queue.count}</b> / 10명</p>
      <p class="dim">${this.queue.timeLeft}초 후 부족한 자리는 봇으로 채워 시작합니다</p>
      <button class="btn ghost" data-act="leave-queue">취소</button></div>`;
  }

  private renderRoom(s: HTMLElement) {
    s.classList.add('center');
    const r = this.room!;
    const host = r.you === 'host';
    s.innerHTML = `<div class="panel sub-panel" style="min-width:520px">
      <div class="dim">사설 방 코드</div><div class="room-code glow-pink">${r.code}</div>
      <p class="dim">친구에게 코드를 알려주세요. 방장: <b>${esc(r.host)}</b></p>
      <div class="col" style="gap:6px;margin:12px 0">${r.players.map(p => `<div class="row"><span class="tag">플레이어</span><b>${esc(p.name)}</b></div>`).join('')}</div>
      <div class="row" style="flex-wrap:wrap">
        <label class="row"><input type="checkbox" id="botFill" ${r.botFill ? 'checked' : ''} ${host ? '' : 'disabled'}> 빈자리 봇 채우기</label>
        <label class="row">봇 난이도 <select class="field" id="botLevel" ${host ? '' : 'disabled'}>${BOT_LEVELS.map((b, i) => `<option value="${i}" ${r.botLevel === i ? 'selected' : ''}>${b.name}</option>`).join('')}</select></label>
      </div>
      <div class="row" style="margin-top:18px;justify-content:flex-end">
        <button class="btn ghost" data-act="leave-room">나가기</button>
        ${host ? '<button class="btn pink big" data-act="start-room">시작</button>' : '<span class="dim">방장이 시작하기를 기다리는 중…</span>'}
      </div></div>`;
    setTimeout(() => {
      const send = () => this.conn.send({ type: 'roomSettings', botFill: (this.ui.querySelector('#botFill') as HTMLInputElement).checked, botLevel: Number((this.ui.querySelector('#botLevel') as HTMLSelectElement).value) });
      this.ui.querySelector('#botFill')?.addEventListener('change', send);
      this.ui.querySelector('#botLevel')?.addEventListener('change', send);
    }, 0);
  }

  // ── 영웅 선택 ──
  private heroDetails(h: (typeof HEROES)[number], withKeys = true): string {
    const keys = ['basic', 's1', 's2', 's3', 'ult'];
    const sk = [h.basic, ...h.skills, h.ult];
    return `<div style="color:${hex(h.color)};font-size:30px;font-weight:900">${h.name}</div>
      <div class="dim">${h.title} · <span class="tag">${ROLE_NAMES[h.role]}</span> · 난이도 <span class="stars">${stars(h.difficulty)}</span></div>
      <p class="dim" style="font-size:13px;line-height:1.5">${h.lore}</p>
      <div class="skill-list">${sk.map((s, i) => `<div class="skill-row" data-skill="${i}"><div class="skill-key">${withKeys ? esc(keyLabel(settings.keys[keys[i]])) : ''} ${skillIcon(s, i)}</div><div><b>${s.name}</b>${i === 4 ? ' <span class="tag">궁극기</span>' : i === 3 ? ' <span class="tag">이동기</span>' : ''} <span class="dim" style="font-size:12px">${i === 4 ? '' : `쿨 ${s.cd}초`}</span><div class="dim" style="font-size:12px">${s.desc}</div></div></div>`).join('')}</div>`;
  }

  private renderSelect(s: HTMLElement) {
    const sel = this.select!;
    const me = sel.players.find(p => p.pid === sel.you);
    const hero = HERO_BY_ID[me?.heroId ?? this.selHero];
    this.selHero = hero.id;
    s.classList.add('select');
    s.innerHTML = `<div class="col" style="width:520px">
        <div class="row"><h2 style="margin:0" class="glow-cyan">영웅 선택</h2><div class="grow"></div><div class="timer-big glow-pink" id="selTimer">${sel.timeLeft}</div></div>
        <div class="hero-grid">${HEROES.map(h => `<div class="hero-card ${h.id === hero.id ? 'sel' : ''}" data-hero="${h.id}" style="--hc:${hex(h.color)}"><div class="glyph">${heroGlyph(h.id)}</div><div class="nm" style="color:${hex(h.color)}">${h.name}</div><div class="rl">${ROLE_NAMES[h.role]}</div><div class="stars" style="font-size:12px">${stars(h.difficulty)}</div></div>`).join('')}</div>
        <div class="panel" style="padding:12px"><div class="dim" style="font-size:12px;margin-bottom:6px">참가자 (같은 영웅 중복 선택 가능)</div><div class="pick-list" id="picks"></div></div>
      </div>
      <div class="grow"></div>
      <div class="panel sub-panel" style="width:430px;min-width:0" id="heroInfo">${this.heroDetails(hero)}
        <div class="row" style="margin-top:14px"><button class="btn pink big grow" data-act="lock" ${me?.locked ? 'disabled' : ''}>${me?.locked ? '선택 완료' : '이 영웅으로 확정'}</button></div>
        <div class="dim" style="font-size:12px;margin-top:6px">마우스를 스킬에 올리면 범위를 미리 볼 수 있습니다 · 모델 드래그로 회전</div>
      </div>`;
    const pal = this.profile?.loadout.palette[hero.id] ?? 0, skin = this.profile?.loadout.skin[hero.id] ?? 0;
    this.r3.showcase.setHero(hero.index, pal, skin);
    this.r3.showcase.offsetX = 0.6;
    this.r3.showcase.setPreview(null);
    this.bindSkillHover(s, hero.id);
    this.renderSelectDynamic();
  }

  private bindSkillHover(s: HTMLElement, id: HeroId) {
    s.querySelectorAll('.skill-row').forEach(r => {
      r.addEventListener('mouseenter', () => { const h = HERO_BY_ID[id]; const i = Number((r as HTMLElement).dataset.skill); this.r3.showcase.setPreview([h.basic, ...h.skills, h.ult][i]); });
      r.addEventListener('mouseleave', () => this.r3.showcase.setPreview(null));
    });
  }

  private renderSelectDynamic() {
    const sel = this.select;
    if (!sel || this.screen !== 'select') return;
    const t = this.ui.querySelector('#selTimer'); if (t) t.textContent = String(sel.timeLeft);
    const p = this.ui.querySelector('#picks');
    if (p) p.innerHTML = sel.players.map(x => `<div class="${x.pid === sel.you ? 'me' : ''}">${x.locked ? '✔' : '…'} ${esc(x.name)}${x.isBot ? ' <span class="dim">(봇)</span>' : ''} — ${x.heroId ? `<b style="color:${hex(HERO_BY_ID[x.heroId].color)}">${HERO_BY_ID[x.heroId].name}</b>` : '<span class="dim">고르는 중</span>'}</div>`).join('');
    const me = sel.players.find(x => x.pid === sel.you);
    const lock = this.ui.querySelector('[data-act="lock"]') as HTMLButtonElement | null;
    if (lock && me?.locked) { lock.disabled = true; lock.textContent = '선택 완료'; }
  }

  // ── 상점 ──
  private owned(id: string) { return isFreeItem(id) || !!this.profile?.owned.includes(id); }

  private renderShop(s: HTMLElement) {
    const p = this.profile!;
    s.classList.add('lobby');
    const tabs: [string, string][] = [['palette', '네온 색상'], ['skin', '스킨'], ['kill', '처치 효과'], ['drop', '낙하 효과'], ['emote', '감정 표현'], ['title', '칭호']];
    const heroTab = this.shopTab === 'palette' || this.shopTab === 'skin';
    let items: ShopItem[] = [];
    if (this.shopTab === 'palette') items = heroPalettes(this.shopHero).map((pal, i) => ({ id: `pal:${this.shopHero}:${i}`, kind: 'palette', name: pal.name, price: i === 0 ? 0 : SHOP_ITEMS.find(x => x.id === `pal:${this.shopHero}:${i}`)!.price, hero: this.shopHero, idx: i, desc: '' }));
    else if (this.shopTab === 'skin') items = SKIN_NAMES[this.shopHero].map((n, i) => ({ id: `skin:${this.shopHero}:${i}`, kind: 'skin', name: n, price: i === 0 ? 0 : 600, hero: this.shopHero, idx: i, desc: '' }));
    else {
      const names = this.shopTab === 'kill' ? KILL_EFFECTS : this.shopTab === 'drop' ? DROP_EFFECTS : this.shopTab === 'emote' ? EMOTES.map(e => `${e.text} ${e.name}`) : TITLES;
      items = names.map((n, i) => ({ id: `${this.shopTab}:${i}`, kind: this.shopTab as ShopItem['kind'], name: n, price: SHOP_ITEMS.find(x => x.id === `${this.shopTab}:${i}`)?.price ?? 0, idx: i, desc: '' }));
    }
    const equipped = (it: ShopItem) => {
      const l = p.loadout;
      if (it.kind === 'palette') return (l.palette[this.shopHero] ?? 0) === it.idx;
      if (it.kind === 'skin') return (l.skin[this.shopHero] ?? 0) === it.idx;
      if (it.kind === 'kill') return l.kill === it.idx;
      if (it.kind === 'drop') return l.drop === it.idx;
      if (it.kind === 'title') return l.title === it.idx;
      if (it.kind === 'emote') return l.emotes.includes(it.idx);
      return false;
    };
    s.innerHTML = `<div class="panel sub-panel" style="width:min(640px,92vw)">
      <div class="row"><h2 class="glow-pink">꾸미기 / 상점</h2><div class="grow"></div><span>크레딧 <span class="credits">${p.credits}</span></span></div>
      <div class="dim" style="font-size:12px;margin-bottom:10px">모든 꾸미기는 실력에 영향을 주지 않습니다. 판 결과(순위·처치·생존)로 크레딧을 얻습니다.</div>
      <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${this.shopTab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
      ${heroTab ? `<div class="tabs">${HEROES.map(h => `<button class="tab ${this.shopHero === h.id ? 'on' : ''}" data-shophero="${h.id}" style="color:${hex(h.color)}">${h.name}</button>`).join('')}</div>` : ''}
      <div class="items">${items.map(it => {
        const own = this.owned(it.id), eq = equipped(it);
        const sw = it.kind === 'palette' ? `<div class="swatch" style="background:linear-gradient(90deg, ${hex(heroPalettes(this.shopHero)[it.idx].c1)}, ${hex(heroPalettes(this.shopHero)[it.idx].c2)})"></div>` : '';
        return `<div class="item ${own ? 'owned' : ''} ${eq ? 'equipped' : ''}" data-preview="${it.kind}:${it.idx}">${sw}<b>${esc(it.name)}</b>
          ${own ? (eq && it.kind !== 'emote' ? '<span class="dim">장착 중</span>' : `<button class="btn small" data-equip="${it.kind}:${it.idx}">${it.kind === 'emote' ? (eq ? '해제' : '장착') : '장착'}</button>`) : `<button class="btn small pink" data-buy="${it.id}" ${p.credits < it.price ? 'disabled' : ''}>${it.price} 크레딧</button>`}</div>`;
      }).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn ghost" data-act="lobby">돌아가기</button></div>
    </div>`;
    const h = HERO_BY_ID[this.shopHero];
    this.r3.showcase.setHero(h.index, p.loadout.palette[h.id] ?? 0, p.loadout.skin[h.id] ?? 0);
    this.r3.showcase.offsetX = -1.8;
    this.r3.showcase.setPreview(null);
    s.querySelectorAll('[data-preview]').forEach(it => it.addEventListener('mouseenter', () => {
      const [kind, idx] = (it as HTMLElement).dataset.preview!.split(':');
      if (kind === 'palette') this.r3.showcase.setHero(h.index, Number(idx), p.loadout.skin[h.id] ?? 0);
      if (kind === 'skin') this.r3.showcase.setHero(h.index, p.loadout.palette[h.id] ?? 0, Number(idx));
    }));
  }

  private renderProfile(s: HTMLElement) {
    const p = this.profile!;
    s.classList.add('center');
    const st = p.stats;
    s.innerHTML = `<div class="panel sub-panel">
      <div class="dim">${esc(TITLES[p.loadout.title])}</div><h2 class="glow-cyan" style="margin:2px 0 14px">${esc(p.name)}</h2>
      <div class="stat-grid"><div class="stat">총 판 수<b>${st.games}</b></div><div class="stat">1위<b>${st.wins}</b></div><div class="stat">총 처치<b>${st.kills}</b></div><div class="stat">최고 처치<b>${st.bestKills}</b></div></div>
      <table class="res-table"><tr><th>영웅</th><th>판 수</th><th>1위</th><th>처치</th><th>1위 비율</th></tr>${HEROES.map(h => { const r = st.heroes[h.id] ?? { games: 0, wins: 0, kills: 0 }; return `<tr><td style="color:${hex(h.color)}">${h.name}</td><td>${r.games}</td><td>${r.wins}</td><td>${r.kills}</td><td>${r.games ? ((r.wins / r.games) * 100).toFixed(0) + '%' : '-'}</td></tr>`; }).join('')}</table>
      <div class="row" style="margin-top:14px"><input class="field" id="newName" maxlength="12" value="${esc(p.name)}"><button class="btn small" data-act="rename">닉네임 변경</button><div class="grow"></div><button class="btn ghost" data-act="lobby">돌아가기</button></div>
    </div>`;
  }

  private renderSettings(s: HTMLElement) {
    s.classList.add('center');
    const q = settings.quality;
    s.innerHTML = `<div class="panel sub-panel">
      <h2>설정</h2>
      <div class="kv">
        <span>그래픽 품질</span><div class="row">${(['low', 'mid', 'high'] as Quality[]).map(x => `<button class="tab ${q === x ? 'on' : ''}" data-quality="${x}">${{ low: '낮음', mid: '중간', high: '높음' }[x]}</button>`).join('')}</div>
        <span>전체 음량</span><input type="range" class="slider" min="0" max="1" step="0.05" value="${settings.master}" data-vol="master">
        <span>배경음악</span><input type="range" class="slider" min="0" max="1" step="0.05" value="${settings.music}" data-vol="music">
        <span>효과음</span><input type="range" class="slider" min="0" max="1" step="0.05" value="${settings.sfx}" data-vol="sfx">
        <span>스마트 시전</span><label class="row"><input type="checkbox" data-toggle="smartCast" ${settings.smartCast ? 'checked' : ''}> 키를 누르는 즉시 시전 (끄면 범위 확인 후 ${esc(keyLabel(settings.keys.basic))})</label>
        <span>화면 흔들림</span><label class="row"><input type="checkbox" data-toggle="shake" ${settings.shake ? 'checked' : ''}> 사용</label>
        <span>데미지 숫자</span><label class="row"><input type="checkbox" data-toggle="dmgNumbers" ${settings.dmgNumbers ? 'checked' : ''}> 표시</label>
        <span>채팅</span><label class="row"><input type="checkbox" data-toggle="chat" ${settings.chat ? 'checked' : ''}> 전체 채팅 보기</label>
      </div>
      <h3 style="margin-bottom:0">키 설정</h3>
      <div class="keybinds">${this.keybindHtml()}</div>
      <div class="row" style="margin-top:14px"><button class="btn small ghost" data-act="reset-keys">키 전체 초기화</button><div class="grow"></div><button class="btn" data-act="lobby">돌아가기</button></div>
    </div>`;
    setTimeout(() => {
      s.querySelectorAll('[data-vol]').forEach(i => i.addEventListener('input', () => { (settings as unknown as Record<string, number>)[(i as HTMLInputElement).dataset.vol!] = Number((i as HTMLInputElement).value); audio.applyVolumes(); saveSettings(); }));
      s.querySelectorAll('[data-toggle]').forEach(i => i.addEventListener('change', () => { (settings as unknown as Record<string, boolean>)[(i as HTMLInputElement).dataset.toggle!] = (i as HTMLInputElement).checked; saveSettings(); }));
    }, 0);
  }

  private renderCodex(s: HTMLElement) {
    const h = HERO_BY_ID[this.codexHero];
    s.classList.add('select');
    s.innerHTML = `<div class="col" style="width:520px">
      <h2 style="margin:0" class="glow-cyan">영웅 도감</h2>
      <div class="hero-grid">${HEROES.map(x => `<div class="hero-card ${x.id === h.id ? 'sel' : ''}" data-codex="${x.id}" style="--hc:${hex(x.color)}"><div class="glyph">${heroGlyph(x.id)}</div><div class="nm" style="color:${hex(x.color)}">${x.name}</div><div class="rl">${ROLE_NAMES[x.role]}</div><div class="stars" style="font-size:12px">${stars(x.difficulty)}</div></div>`).join('')}</div>
      <div class="panel" style="padding:12px;font-size:13px"><b>전용 증강</b>${Object.values(AUGMENT_BY_ID).filter(a => a.hero === h.id).map(a => `<div style="margin-top:6px"><span class="aug-ic ${a.tier}" style="display:inline-grid;width:24px;height:24px;font-size:13px">${a.icon}</span> <b>${a.name}</b> <span class="dim">(${TIER_NAMES[a.tier]}) ${a.desc}</span></div>`).join('')}</div>
      <div class="row"><button class="btn ghost" data-act="lobby">돌아가기</button></div>
    </div><div class="grow"></div>
    <div class="panel sub-panel" style="width:430px;min-width:0">${this.heroDetails(h)}<div class="row" style="margin-top:14px"><button class="btn pink big grow" data-act="solo">봇전 시작</button><button class="btn big" data-act="practice">연습장</button></div><div class="row" style="margin-top:8px"><span class="dim" style="font-size:13px">봇 난이도</span>${BOT_LEVELS.map((b, i) => `<button class="tab ${this.soloLevel === i ? 'on' : ''}" data-sololevel="${i}">${b.name}</button>`).join('')}</div><div class="dim" style="font-size:12px;margin-top:6px">허수아비를 상대로 자유롭게 연습할 수 있습니다. 레벨업 버튼으로 증강도 시험해 보세요.</div></div>`;
    this.r3.showcase.setHero(h.index, this.profile?.loadout.palette[h.id] ?? 0, this.profile?.loadout.skin[h.id] ?? 0);
    this.r3.showcase.offsetX = 0.6;
    this.r3.showcase.setPreview(null);
    this.bindSkillHover(s, h.id);
  }

  // ───────────────── 클릭 처리 ─────────────────
  private onClick(e: MouseEvent) {
    if (performance.now() < this.ignoreClickUntil) return;
    const t = e.target as HTMLElement;
    const actEl = t.closest('[data-act]') as HTMLElement | null;
    const card = t.closest('[data-hero]') as HTMLElement | null;
    const codex = t.closest('[data-codex]') as HTMLElement | null;
    if (card && this.screen === 'select') {
      const id = card.dataset.hero as HeroId;
      const me = this.select?.players.find(p => p.pid === this.select!.you);
      if (me?.locked) return;
      this.selHero = id; storageSet('neon.lastHero', id);
      this.conn.send({ type: 'pickHero', heroId: id });
      audio.play('ui');
      if (this.select && me) me.heroId = id;
      this.render();
      return;
    }
    if (codex) { this.codexHero = codex.dataset.codex as HeroId; audio.play('ui'); this.render(); return; }
    if (t.dataset.tab) { this.shopTab = t.dataset.tab; audio.play('ui'); this.render(); return; }
    if (t.dataset.shophero) { this.shopHero = t.dataset.shophero as HeroId; audio.play('ui'); this.render(); return; }
    if (t.dataset.buy) { this.conn.send({ type: 'buy', item: t.dataset.buy }); return; }
    if (t.dataset.equip) {
      const [kind, idx] = t.dataset.equip.split(':');
      this.conn.send({ type: 'equip', kind: kind as 'palette', hero: kind === 'palette' || kind === 'skin' ? this.shopHero : undefined, idx: Number(idx) });
      audio.play('ui'); return;
    }
    if (t.dataset.sololevel) { this.soloLevel = Number(t.dataset.sololevel); audio.play('ui'); this.render(); return; }
    if (t.dataset.quality) { settings.quality = t.dataset.quality as Quality; saveSettings(); this.r3.applyQuality(settings.quality); if (this.demo) this.startDemo(); this.render(); return; }
    if (t.dataset.rebind) { this.rebinding = this.rebinding === t.dataset.rebind ? null : t.dataset.rebind; this.refreshKeyUi(); return; }
    if (t.dataset.rebindDefault) { const r = bindKey(t.dataset.rebindDefault, DEFAULT_KEYS[t.dataset.rebindDefault]); if (r.swapped) toast(`「${actionLabel(r.swapped)}」의 키도 서로 바꿨습니다`); audio.play('ui'); this.refreshKeyUi(); return; }
    if (!actEl) return;
    const act = actEl.dataset.act;
    audio.play('ui');
    switch (act) {
      case 'start': this.startFromTitle(); break;
      case 'quick': this.conn.send({ type: 'queue' }); this.queue = { count: 1, timeLeft: 20 }; this.go('queue'); break;
      case 'leave-queue': this.conn.send({ type: 'leaveQueue' }); this.go('lobby'); break;
      case 'room-menu': this.ui.querySelector('#roomMenu')?.classList.toggle('hidden'); break;
      case 'create-room': this.conn.send({ type: 'createRoom' }); break;
      case 'join-room': { const code = (this.ui.querySelector('#roomCode') as HTMLInputElement).value.trim(); if (/^\d{4}$/.test(code)) this.conn.send({ type: 'joinRoom', code }); else toast('4자리 숫자 코드를 입력하세요'); break; }
      case 'leave-room': this.conn.send({ type: 'leaveRoom' }); this.room = null; this.go('lobby'); break;
      case 'start-room': this.conn.send({ type: 'startRoom' }); break;
      case 'lock': this.conn.send({ type: 'pickHero', heroId: this.selHero }); this.conn.send({ type: 'lockHero' }); audio.play('aug_gold'); break;
      case 'codex': this.go('codex'); break;
      case 'shop': this.go('shop'); break;
      case 'profile': this.go('profile'); break;
      case 'settings': this.go('settings'); break;
      case 'lobby': this.go('lobby'); break;
      case 'practice': this.startPractice(this.codexHero); break;
      case 'solo': this.startPractice(this.codexHero, true); break;
      case 'solo-again': if (this.lastSolo) this.startPractice(this.lastSolo, true); break;
      case 'rematch': this.conn.send({ type: 'rematch' }); (actEl as HTMLButtonElement).disabled = true; (actEl as HTMLButtonElement).textContent = '재대결 대기 중…'; break;
      case 'leave-match': this.leaveMatch(); break;
      case 'esc-close': this.ui.querySelector('.overlay.esc')?.remove(); break;
      case 'rename': { const n = (this.ui.querySelector('#newName') as HTMLInputElement).value.trim(); this.conn.send({ type: 'setName', name: n }); break; }
      case 'reset-keys': settings.keys = { ...DEFAULT_KEYS }; this.rebinding = null; saveSettings(); this.refreshKeyUi(); toast('키 설정을 기본값으로 되돌렸습니다'); break;
      case 'open-keys': this.openKeysOverlay(); break;
      case 'close-keys': this.rebinding = null; this.ui.querySelector('.overlay.keys')?.remove(); break;
    }
  }
}

// 개발/테스트용 전역 핸들 (Playwright 상태 확인)
const app = new App();
(window as unknown as { __neon: App }).__neon = app;
export { Btn };
