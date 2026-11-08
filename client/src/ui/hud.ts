import {
  AUGMENT_BY_ID, EntType, HF, HERO_BY_ID, QUICK_CHATS, EMOTES, TIER_NAMES, VIEW_RADIUS, type MapData, type ServerMsg, type SkillDef, AUGMENT_PICK_SEC, DROP_PHASE_SEC,
} from '@neon/shared';
import type { ClientGame } from '../game/clientGame';
import type { Renderer3D } from '../render/renderer';
import { settings, keyLabel } from '../settings';
import { el, esc, skillIcon, augTip, hex } from './util';
import { audio } from '../audio/audio';

type Row = Extract<ServerMsg, { type: 'scoreboard' }>['rows'][number];

export interface HudCallbacks {
  pickAug(idx: number): void;
  spectate(dir: number): void;
  toResults(): void;
  chat(text: string): void;
  quick(idx: number): void;
  emote(idx: number): void;
  leave(): void;
  practice(what: 'level' | 'reset' | 'ult'): void;
}

export class Hud {
  root: HTMLElement;
  private game: ClientGame;
  private r3: Renderer3D;
  private cb: HudCallbacks;
  private mm: HTMLCanvasElement; private mmCtx: CanvasRenderingContext2D; private mmBase: HTMLCanvasElement;
  private top: HTMLElement; private net: HTMLElement; private feed: HTMLElement; private bottom: HTMLElement;
  private hpFill!: HTMLElement; private hpGhost!: HTMLElement; private hpShield!: HTMLElement; private hpTxt!: HTMLElement; private lvl!: HTMLElement; private xp!: HTMLElement;
  private slots: HTMLElement[] = [];
  private augBar: HTMLElement; private augCards: HTMLElement; private chatBox: HTMLElement; private chatIn: HTMLInputElement;
  private overhead = new Map<number, HTMLElement>();
  private ohLayer: HTMLElement; private dmgLayer: HTMLElement;
  private prompt: HTMLElement; private channel: HTMLElement; private specBox: HTMLElement; private dropHint: HTMLElement; private debug: HTMLElement;
  private scoreEl: HTMLElement; private wheelEl: HTMLElement;
  private rows: Row[] = [];
  offer: { options: string[]; deadline: number; source: string; queue: number } | null = null;
  augments: string[] = [];
  showDebug = false;
  private lastCds: number[] = [0, 0, 0, 0, 0];
  private skills: SkillDef[] = [];
  aiming = -1;
  wheelOpen = false;
  private wheelHot = -1;
  private eliminatedInfo: { placement: number } | null = null;
  chatOpen = false;
  /** 대기열에서 관전 중이면 대기 정보 */
  queueInfo: { position: number; count: number; active: number; max: number } | null = null;
  /** 근처에 상호작용 가능한 대상이 있는지 (터치 버튼 표시용) */
  canInteract = false;
  get scoreboardOpen() { return !this.scoreEl.classList.contains('hidden'); }

  constructor(parent: HTMLElement, game: ClientGame, r3: Renderer3D, cb: HudCallbacks) {
    this.game = game; this.r3 = r3; this.cb = cb;
    const root = el('div', 'hud' + (game.you === 0 ? ' spectator' : ''));
    this.root = root;
    parent.appendChild(root);
    this.ohLayer = el('div'); this.dmgLayer = el('div');
    root.append(this.ohLayer, this.dmgLayer);
    this.mm = el('canvas', 'minimap'); this.mm.width = 380; this.mm.height = 380;
    this.mmCtx = this.mm.getContext('2d')!;
    this.mmBase = this.paintMinimapBase(game.map);
    this.top = el('div', 'topbar');
    this.net = el('div', 'netinfo');
    this.feed = el('div', 'killfeed');
    this.bottom = el('div', 'bottom');
    this.augBar = el('div', 'augs');
    this.augCards = el('div');
    this.chatBox = el('div', 'chat');
    this.chatIn = el('input', 'field chat-input hidden') as HTMLInputElement;
    this.chatIn.maxLength = 100; this.chatIn.placeholder = '전체 채팅 (Enter 전송, Esc 취소)';
    this.prompt = el('div', 'prompt hidden'); this.channel = el('div', 'channel hidden', '<div class="fill"></div>');
    this.specBox = el('div', 'spectate panel hidden clickable');
    this.dropHint = el('div', 'drop-hint hidden');
    this.debug = el('div', 'debug hidden');
    this.scoreEl = el('div', 'scoreboard panel hidden');
    this.wheelEl = el('div', 'wheel hidden clickable');
    root.append(this.mm, this.top, this.net, this.feed, this.bottom, this.augBar, this.augCards, this.chatBox, this.chatIn, this.prompt, this.channel, this.specBox, this.dropHint, this.debug, this.scoreEl, this.wheelEl);
    this.buildBottom();
    this.chatIn.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.chatIn.value.trim(); if (t) this.cb.chat(t); this.closeChat(); }
      if (e.key === 'Escape') this.closeChat();
    });
    if (game.mode === 'practice') {
      const pb = el('div', 'practice-bar');
      pb.innerHTML = `<button class="btn small" data-p="level">레벨업 (증강 선택)</button><button class="btn small" data-p="reset">쿨타임 초기화</button><button class="btn small" data-p="ult">궁극기 충전</button><button class="btn small pink" data-p="leave">연습장 나가기</button>`;
      pb.addEventListener('click', e => { const p = (e.target as HTMLElement).dataset.p; if (!p) return; audio.play('ui'); if (p === 'leave') this.cb.leave(); else this.cb.practice(p as 'level'); });
      root.appendChild(pb);
    }
    this.specBox.addEventListener('click', e => {
      const a = (e.target as HTMLElement).dataset.a;
      if (a === 'prev') this.cb.spectate(-1);
      if (a === 'next') this.cb.spectate(1);
      if (a === 'res') this.cb.toResults();
      if (a === 'leaveq') this.cb.leave();
    });
  }

  destroy() { this.root.remove(); }

  /** 키 설정 변경 시 스킬바 키 표시 갱신 */
  refreshKeys() { this.buildBottom(); }

  private buildBottom() {
    const def = this.game.myHeroDef();
    this.skills = this.game.mySkills();
    this.bottom.innerHTML = `
      <div class="hpwrap"><div class="lvl">1</div><div class="hpbars"><div class="bar"><div class="ghost"></div><div class="fill"></div><div class="shield"></div><div class="txt"></div></div><div class="xpbar"><div class="fill"></div></div></div></div>
      <div class="skills"></div>`;
    this.lvl = this.bottom.querySelector('.lvl')!;
    this.hpFill = this.bottom.querySelector('.bar .fill')!; this.hpGhost = this.bottom.querySelector('.bar .ghost')!; this.hpShield = this.bottom.querySelector('.bar .shield')!; this.hpTxt = this.bottom.querySelector('.bar .txt')!;
    this.xp = this.bottom.querySelector('.xpbar .fill')!;
    const sk = this.bottom.querySelector('.skills')!;
    const keys = ['basic', 's1', 's2', 's3', 'ult'];
    this.slots = [];
    [0, 1, 2, 3, 4, 5].forEach(i => {
      const isDodge = i === 5;
      const s = el('div', 'slot' + (i === 4 ? ' ult' : ''));
      const key = isDodge ? keyLabel(settings.keys.dodge) : keyLabel(settings.keys[keys[i]]);
      const icon = isDodge ? '↻' : skillIcon(this.skills[i], i);
      s.innerHTML = `<span>${icon}</span><div class="cd"></div><div class="cdn"></div><div class="key">${esc(key)}</div><div class="chg"></div>`;
      s.title = isDodge ? '구르기: 짧은 무적 회피' : `${this.skills[i].name}\n${this.skills[i].desc}`;
      s.style.borderColor = i === 4 ? '' : hex(def.color) + '88';
      sk.appendChild(s); this.slots.push(s);
    });
  }

  private paintMinimapBase(map: MapData): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = 380; c.height = 380;
    const x = c.getContext('2d')!;
    const S = 380 / 90;
    const tx = (v: number) => 190 + v * S;
    x.fillStyle = '#0b0718'; x.beginPath(); x.arc(190, 190, 43 * S, 0, Math.PI * 2); x.fill();
    const tints = ['rgba(155,92,255,.18)', 'rgba(255,43,214,.15)', 'rgba(42,123,255,.15)', 'rgba(255,122,26,.13)', 'rgba(51,255,153,.12)'];
    // 구역 색
    x.save(); x.beginPath(); x.arc(190, 190, 43 * S, 0, Math.PI * 2); x.clip();
    const quad = (a0: number, col: string) => { x.fillStyle = col; x.beginPath(); x.moveTo(190, 190); x.arc(190, 190, 44 * S, a0, a0 + Math.PI / 2); x.fill(); };
    quad(-Math.PI / 4, tints[1]); quad(Math.PI / 4, tints[2]); quad((3 * Math.PI) / 4, tints[3]); quad((5 * Math.PI) / 4, tints[4]);
    x.fillStyle = tints[0]; x.beginPath(); x.arc(190, 190, 10 * S, 0, Math.PI * 2); x.fill();
    x.restore();
    for (const o of map.obstacles) {
      x.fillStyle = o.blocksVision ? '#4a3f78' : '#2c2648';
      if (o.shape === 'circle') { x.beginPath(); x.arc(tx(o.x), tx(o.y), o.r * S, 0, Math.PI * 2); x.fill(); }
      else x.fillRect(tx(o.x - o.hw), tx(o.y - o.hh), o.hw * 2 * S, o.hh * 2 * S);
    }
    x.fillStyle = 'rgba(34,243,255,.25)';
    for (const b of map.bushes) x.fillRect(tx(b.x - b.hw), tx(b.y - b.hh), b.hw * 2 * S, b.hh * 2 * S);
    x.fillStyle = '#22f3ff';
    for (const p of map.pads) { x.beginPath(); x.arc(tx(p.x), tx(p.y), 3, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#9b5cff';
    for (const [gx, gy] of [[map.gates.ax, map.gates.ay], [map.gates.bx, map.gates.by]]) { x.beginPath(); x.arc(tx(gx), tx(gy), 5, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#4dff88';
    for (const v of map.vendings) x.fillRect(tx(v.x) - 3, tx(v.y) - 3, 6, 6);
    return c;
  }

  // ───────────── 메시지 ─────────────
  addFeed(m: { killer: string; victim: string; skill: string; killerHero: string; victimHero: string }) {
    const meName = this.game.rosterOf(this.game.you)?.name;
    const d = el('div', 'kf' + (m.killer === meName || m.victim === meName ? ' me' : ''));
    const kc = m.killerHero ? hex(HERO_BY_ID[m.killerHero as 'rail']?.color ?? 0xffffff) : '#ff2bd6';
    const vc = hex(HERO_BY_ID[m.victimHero as 'rail']?.color ?? 0xffffff);
    d.innerHTML = `<b style="color:${kc}">${esc(m.killer)}</b><span class="sk">[${esc(m.skill)}]</span><b style="color:${vc}">${esc(m.victim)}</b>`;
    this.feed.prepend(d);
    while (this.feed.children.length > 6) this.feed.lastChild!.remove();
    setTimeout(() => d.remove(), 8000);
  }

  announce(text: string, tone: string) {
    const d = el('div', 'announce ' + (tone === 'final' || tone === 'win' ? 'glow-pink' : tone === 'supply' ? 'glow-cyan' : 'glow-pink'), esc(text));
    this.root.appendChild(d);
    audio.play(tone === 'supply' ? 'siren' : 'announce');
    setTimeout(() => d.remove(), 2700);
  }

  addChat(from: string, text: string, quick: boolean) {
    if (!settings.chat && !quick) return;
    const d = el('div', 'ln' + (quick ? ' q' : ''), `<b>${esc(from)}</b>: ${esc(text)}`);
    this.chatBox.appendChild(d);
    while (this.chatBox.children.length > 8) this.chatBox.firstChild!.remove();
    setTimeout(() => d.remove(), 9500);
  }

  openChat() { if (!settings.chat) return; this.chatOpen = true; this.chatIn.classList.remove('hidden'); this.chatIn.value = ''; setTimeout(() => this.chatIn.focus(), 0); }
  closeChat() { this.chatOpen = false; this.chatIn.classList.add('hidden'); this.chatIn.blur(); }

  setOffer(o: { options: string[]; deadline: number; source: string; queue: number } | null) {
    this.offer = o;
    this.augCards.innerHTML = '';
    if (!o) return;
    const best = o.options.map(id => AUGMENT_BY_ID[id].tier).includes('prism') ? 'prism' : o.options.map(id => AUGMENT_BY_ID[id].tier).includes('gold') ? 'gold' : 'silver';
    audio.play('aug_' + best);
    const title = el('div', 'aug-title', o.source === 'supply' ? '기업 보급품 — 프리즘 증강 선택!' : `레벨 업! 증강 선택 ${o.queue > 1 ? `(대기 ${o.queue - 1})` : ''} — 1/2/3 키`);
    const wrap = el('div', 'aug-cards');
    o.options.forEach((id, i) => {
      const a = AUGMENT_BY_ID[id];
      const c = el('div', 'aug-card ' + a.tier, `<div class="hk">${i + 1}</div><div class="tr" style="color:var(--${a.tier})">${TIER_NAMES[a.tier]}${a.hero ? ' · 전용' : ''}</div><div class="ic">${a.icon}</div><div class="nm">${esc(a.name)}</div><div class="ds">${esc(a.desc)}</div>`);
      c.addEventListener('click', () => this.cb.pickAug(i));
      c.addEventListener('mouseenter', () => audio.play('uiHover'));
      wrap.appendChild(c);
    });
    const timer = el('div', 'aug-timer', '<div class="fill"></div>');
    this.augCards.append(title, wrap, timer);
  }

  setAugments(list: string[]) {
    this.augments = list;
    this.skills = this.game.mySkills();
    this.augBar.innerHTML = '';
    for (const id of list) {
      const a = AUGMENT_BY_ID[id];
      const d = el('div', 'aug-ic ' + a.tier, a.icon);
      d.title = augTip(id);
      this.augBar.appendChild(d);
    }
  }

  setScoreboard(rows: Row[]) { this.rows = rows; if (!this.scoreEl.classList.contains('hidden')) this.renderScoreboard(); }

  showScoreboard(on: boolean) {
    this.scoreEl.classList.toggle('hidden', !on);
    if (on) this.renderScoreboard();
  }

  private renderScoreboard() {
    const rows = [...this.rows].sort((a, b) => (a.alive === b.alive ? b.kills - a.kills || b.level - a.level : a.alive ? -1 : 1));
    this.scoreEl.innerHTML = `<h3 style="margin:0 0 10px">점수판 <span class="dim" style="font-size:13px">— 상대의 레벨과 증강을 확인하세요</span></h3><table><tr><th>플레이어</th><th>영웅</th><th>Lv</th><th>처치</th><th>증강</th><th>상태</th></tr>${rows.map(r => `
      <tr class="${r.alive ? '' : 'dead'} ${r.id === this.game.you ? 'me' : ''}"><td>${esc(r.name)}${r.bot ? ' <span class="dim">봇</span>' : ''}</td><td style="color:${hex(HERO_BY_ID[r.heroId].color)}">${HERO_BY_ID[r.heroId].name}</td><td>${r.level}</td><td>${r.kills}</td>
      <td>${r.augments.map(a => `<span title="${esc(augTip(a))}" style="color:var(--${AUGMENT_BY_ID[a]?.tier})">${AUGMENT_BY_ID[a]?.icon ?? ''}</span>`).join(' ')}</td><td>${r.alive ? '생존' : `#${r.placement}`}</td></tr>`).join('')}</table>`;
  }

  dmgNumber(sx: number, sy: number, amount: number, kind: string) {
    if (this.dmgLayer.children.length > 40) this.dmgLayer.firstChild!.remove();
    const d = el('div', 'dmg ' + kind, (kind === 'heal' ? '+' : '') + amount);
    d.style.left = sx + (Math.random() - 0.5) * 30 + 'px'; d.style.top = sy + 'px';
    this.dmgLayer.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }

  showEmote(heroId: number, n: number) {
    const o = this.overhead.get(heroId);
    if (!o) return;
    const e = el('div', 'emo', esc(EMOTES[n]?.text ?? '♪'));
    o.prepend(e);
    setTimeout(() => e.remove(), 2000);
  }

  setEliminated(placement: number) { this.eliminatedInfo = { placement }; }

  toggleWheel(on: boolean) {
    this.wheelOpen = on;
    this.wheelEl.classList.toggle('hidden', !on);
    if (!on) {
      if (this.wheelHot >= 0) this.pickWheel(this.wheelHot);
      this.wheelHot = -1;
      return;
    }
    const def = this.game.myHeroDef();
    const cos = this.game.rosterOf(this.game.you)?.cos;
    const opts: { label: string; act: () => void }[] = [];
    QUICK_CHATS.forEach((q, i) => opts.push({ label: q, act: () => this.cb.quick(i) }));
    def.lines.forEach((l, i) => opts.push({ label: '“' + l + '”', act: () => this.cb.quick(QUICK_CHATS.length + i) }));
    (cos?.emotes ?? [0, 1]).forEach(e => opts.push({ label: `${EMOTES[e].text} ${EMOTES[e].name}`, act: () => this.cb.emote(e) }));
    this.wheelEl.innerHTML = '<div class="mid">퀵 채팅 / 감정 표현<br>마우스로 고르고 T를 떼세요</div>';
    const n = opts.length;
    opts.forEach((o, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const b = el('div', 'opt', esc(o.label));
      b.style.left = 210 + Math.cos(a) * 170 + 'px'; b.style.top = 210 + Math.sin(a) * 170 + 'px';
      b.addEventListener('mouseenter', () => { this.wheelHot = i; this.wheelEl.querySelectorAll('.opt').forEach((x, j) => x.classList.toggle('hot', j === i)); });
      b.addEventListener('click', () => { this.wheelHot = -1; o.act(); this.toggleWheel(false); });
      (b as HTMLElement & { _act?: () => void })._act = o.act;
      this.wheelEl.appendChild(b);
    });
  }

  private pickWheel(i: number) {
    const b = this.wheelEl.querySelectorAll('.opt')[i] as (HTMLElement & { _act?: () => void }) | undefined;
    b?._act?.();
  }

  private htmlCache = new WeakMap<HTMLElement, string>();
  /** 내용이 바뀔 때만 DOM 갱신 (버튼 클릭 안정성 + 성능) */
  private setHtml(e: HTMLElement, html: string) { if (this.htmlCache.get(e) !== html) { this.htmlCache.set(e, html); e.innerHTML = html; } }

  private prevShowNext = 0;
  private prevStage = -1;
  private prevMoving = 0;

  // ───────────── 프레임 갱신 ─────────────
  update() {
    const g = this.game;
    const self = g.self, match = g.match;
    if (!self || !match) return;
    // 구역 경고 (다음 구역 표시 / 축소 시작 / 이동 시작)
    if (g.mode !== 'practice' && match.phase === 1) {
      if (match.showNext && !this.prevShowNext && match.nextIn > 1) { this.announce('다음 안전 구역 표시 — 20초 후 데이터 붕괴', 'zone'); audio.play('zoneWarn'); }
      if (this.prevStage >= 0 && match.stage > this.prevStage) { audio.play('zoneWarn'); }
      if (match.moving && !this.prevMoving) { this.announce('최종 단계: 안전 구역이 이동합니다!', 'final'); audio.play('siren'); }
    }
    this.prevShowNext = match.showNext; this.prevStage = match.stage; this.prevMoving = match.moving;
    // 상단 정보
    const t = match.time / 30;
    let zoneTxt = '';
    if (g.mode === 'practice') zoneTxt = '영웅 도감 · 스킬 연습장';
    else if (match.phase === 0) zoneTxt = `낙하 ${Math.max(0, Math.ceil(DROP_PHASE_SEC - t))}초`;
    else if (match.moving) zoneTxt = '⚠ 구역 이동 중';
    else if (match.nextIn > 0 && match.nextIn < 999) zoneTxt = `구역 축소까지 ${Math.ceil(match.nextIn)}초`;
    else if (match.showNext) zoneTxt = '⚠ 구역 축소 중';
    else zoneTxt = '최종 구역';
    const warn = (match.showNext && match.nextIn <= 20) || match.moving;
    const outside = self.state === 2 && match.zr > 0 && g.mode !== 'practice' && Math.hypot(self.x - match.zx, self.y - match.zy) > match.zr;
    this.setHtml(this.top, `<div class="chip">생존 <b>${match.alive}</b>/${match.total}</div><div class="chip ${warn ? 'warn' : ''}">${zoneTxt}</div><div class="chip">처치 <b>${self.kills}</b></div>${outside ? '<div class="chip warn">데이터 붕괴 구역! 안으로 이동하세요</div>' : ''}`);
    this.r3.outside = outside ? 1 : 0;
    this.net.textContent = `핑 ${Math.round(g.ping)}ms · ${Math.round(this.r3.fps)}fps`;

    // 체력/레벨
    const me = g.view.get(g.you);
    if (me) {
      const total = Math.max(me.maxHp, me.hp + me.shield);
      this.hpFill.style.width = (me.hp / total) * 100 + '%';
      this.hpGhost.style.width = (me.hp / total) * 100 + '%';
      this.hpShield.style.left = (me.hp / total) * 100 + '%';
      this.hpShield.style.width = (me.shield / total) * 100 + '%';
      this.hpTxt.textContent = `${me.hp} / ${me.maxHp}${me.shield > 0 ? ` (+${me.shield})` : ''}`;
      this.r3.lowHp = self.state === 2 && me.hp / me.maxHp < 0.3 ? 1 : 0;
    }
    this.lvl.textContent = String(self.level);
    this.xp.style.width = (self.level >= 8 ? 100 : ((self.xp - self.xpPrev) / Math.max(1, self.xpNext - self.xpPrev)) * 100) + '%';

    // 스킬 슬롯
    const silenced = me ? (me.flags & HF.Silence) !== 0 : false;
    for (let i = 0; i < 6; i++) {
      const s = this.slots[i];
      let p = 0, txt = '', chg = '';
      if (i === 5) { p = self.dodgeCd / Math.max(1, self.dodgeCdMax); txt = self.dodgeCd > 0 ? (self.dodgeCd / 30).toFixed(self.dodgeCd < 30 ? 1 : 0) : ''; }
      else if (i === 4) { p = 1 - self.ult; txt = self.ult < 1 ? Math.floor(self.ult * 100) + '%' : ''; s.classList.toggle('ready', self.ult >= 1); }
      else {
        const ready = self.charges[i] > 0;
        p = ready ? 0 : self.cds[i] / Math.max(1, self.maxCds[i]);
        txt = !ready && self.cds[i] > 0 && i > 0 ? (self.cds[i] / 30).toFixed(self.cds[i] < 30 ? 1 : 0) : '';
        if (self.chargeMax[i] > 1) chg = String(self.charges[i]);
        if (this.lastCds[i] > 0 && ready && i > 0) s.appendChild(el('div', 'flash'));
        this.lastCds[i] = ready ? 0 : 1;
      }
      (s.querySelector('.cd') as HTMLElement).style.setProperty('--p', p * 100 + '%');
      (s.querySelector('.cdn') as HTMLElement).textContent = txt;
      (s.querySelector('.chg') as HTMLElement).textContent = chg;
      s.classList.toggle('silenced', silenced && i > 0 && i < 5);
      s.classList.toggle('aiming', this.aiming === i);
      const fl = s.querySelector('.flash'); if (fl && (fl as HTMLElement).dataset.t === undefined) { (fl as HTMLElement).dataset.t = '1'; setTimeout(() => fl.remove(), 400); }
    }

    // 증강 타이머
    if (this.offer) {
      const fill = this.augCards.querySelector('.aug-timer .fill') as HTMLElement | null;
      const left = (this.offer.deadline - g.newestTick) / 30;
      if (fill) fill.style.width = Math.max(0, (left / AUGMENT_PICK_SEC) * 100) + '%';
    }

    // 상호작용 안내
    let promptTxt = '';
    if (self.state === 2) {
      for (const v of g.view.values()) {
        if (v.type !== EntType.Pickup || v.sub === 0 || (v.flags & 1)) continue;
        if (Math.hypot(v.x - self.x, v.y - self.y) < 2.3) { promptTxt = v.sub === 1 ? '기업 보급품 열기 (1.5초, 피격 시 취소)' : '회복 자판기 사용 (체력 40%)'; break; }
      }
    }
    this.canInteract = !!promptTxt;
    this.prompt.classList.toggle('hidden', !promptTxt || self.channelProg > 0);
    if (promptTxt) this.setHtml(this.prompt, `<span class="k">${document.body.classList.contains('touch') ? 'F 버튼' : keyLabel(settings.keys.interact)}</span>${promptTxt}`);
    this.channel.classList.toggle('hidden', self.channelProg <= 0);
    if (self.channelProg > 0) (this.channel.firstChild as HTMLElement).style.width = (self.channelProg / 255) * 100 + '%';

    // 낙하 안내
    const dropping = match.phase === 0 && self.state === 0 && g.mode !== 'practice';
    this.dropHint.classList.toggle('hidden', !dropping);
    if (dropping) this.setHtml(this.dropHint, `<div class="big glow-cyan">낙하 지점을 ${document.body.classList.contains('touch') ? '탭' : '클릭'}하세요</div><div class="dim">수송 드론 출발까지 ${Math.max(0, Math.ceil(DROP_PHASE_SEC - t))}초 · 원하는 위치를 ${document.body.classList.contains('touch') ? '탭' : '클릭'}하면 바로 낙하합니다</div>`);

    // 관전
    const dead = self.state === 3;
    this.specBox.classList.toggle('hidden', !dead);
    if (dead && g.you === 0) {
      const target = g.rosterOf(self.viewId);
      const q = this.queueInfo;
      this.setHtml(this.specBox, `<div><div class="dim" style="font-size:12px">${q ? `대기 ${q.position}번째 · 진행 중 ${q.active}/${q.max}판 · 자리가 나면 자동으로 시작` : '대기 중 · 관전'}</div><b class="spec-name">관전: ${esc(target?.name ?? '')}</b></div><button class="btn small ghost" data-a="prev">◀</button><button class="btn small ghost" data-a="next">▶</button><button class="btn small pink" data-a="leaveq">대기열 나가기</button>`);
    } else if (dead) {
      const target = g.rosterOf(self.viewId);
      this.setHtml(this.specBox, `<div><div class="dim" style="font-size:12px">${this.eliminatedInfo ? `#${this.eliminatedInfo.placement} 탈락 · ` : ''}관전 중</div><b class="spec-name">${esc(target?.name ?? '')}</b></div><button class="btn small ghost" data-a="prev">◀</button><button class="btn small ghost" data-a="next">▶</button><button class="btn small pink" data-a="res">결과 화면</button>`);
    }

    this.updateOverheads();
    this.drawMinimap();
    if (this.showDebug) {
      this.debug.classList.remove('hidden');
      this.r3.world && (this.r3.world.debugHitboxes = true);
      this.debug.textContent = `FPS      ${this.r3.fps.toFixed(0)}\n핑       ${g.ping.toFixed(0)} ms\n서버 틱  ${g.newestTick} (렌더 ${g.renderTick.toFixed(1)})\n지터     ${g.jitter.toFixed(1)} 틱\n보정 횟수 ${g.corrections}\n패킷     ${g.lastSnapBytes} B (${(g.bytesPerSec / 1024).toFixed(1)} KB/s)\n엔티티   ${g.view.size}\n히트박스 표시 중`;
    } else { this.debug.classList.add('hidden'); if (this.r3.world) this.r3.world.debugHitboxes = false; }
  }

  private updateOverheads() {
    const g = this.game;
    const seen = new Set<number>();
    for (const v of g.view.values()) {
      if (v.type !== EntType.Hero && v.type !== EntType.Neutral) continue;
      if (v.type === EntType.Hero && (v.flags & HF.Landing) && v.r > 20) continue;
      seen.add(v.id);
      let o = this.overhead.get(v.id);
      if (!o) {
        o = el('div', 'overhead' + (v.id === g.you ? ' me' : ''));
        const r = g.rosterOf(v.id);
        o.innerHTML = v.type === EntType.Hero ? `<div class="nmrow"><span class="lv"></span><span class="nm">${esc(r?.name ?? '')}</span></div><div class="st"></div><div class="ohp"><i></i><s></s></div>` : `<div class="ohp"><i style="background:#ffe14d"></i><s></s></div>`;
        this.ohLayer.appendChild(o);
        this.overhead.set(v.id, o);
      }
      const h = v.type === EntType.Hero ? 2.9 : 2.5;
      const p = this.r3.worldToScreen(v.x, v.y, h);
      o.style.display = p.vis ? '' : 'none';
      if (!p.vis) continue;
      o.style.left = p.x + 'px'; o.style.top = p.y + 'px';
      const total = Math.max(v.maxHp, v.hp + v.shield);
      const i = o.querySelector('i') as HTMLElement, s = o.querySelector('s') as HTMLElement;
      i.style.width = (v.hp / Math.max(1, total)) * 100 + '%';
      s.style.left = (v.hp / Math.max(1, total)) * 100 + '%'; s.style.width = (v.shield / Math.max(1, total)) * 100 + '%';
      if (v.type === EntType.Hero) {
        (o.querySelector('.lv') as HTMLElement).textContent = String(v.level);
        const st: string[] = [];
        if (v.flags & HF.Stun) st.push('기절'); if (v.flags & HF.Root) st.push('속박'); if (v.flags & HF.Silence) st.push('봉인'); if (v.flags & HF.Invert) st.push('조작 반전');
        if (v.flags & HF.Slow) st.push('둔화'); if (v.flags & HF.Marked) st.push('표식'); if (v.flags & HF.Disconnected) st.push('연결 끊김');
        (o.querySelector('.st') as HTMLElement).textContent = st.join(' · ');
        o.style.opacity = v.flags & HF.Stealth ? '0.4' : '1';
      }
    }
    for (const [id, o] of this.overhead) if (!seen.has(id)) { o.remove(); this.overhead.delete(id); }
  }

  private drawMinimap() {
    const g = this.game, x = this.mmCtx, m = g.match!, self = g.self!;
    const S = 380 / 90, tx = (v: number) => 190 + v * S;
    x.clearRect(0, 0, 380, 380);
    x.drawImage(this.mmBase, 0, 0);
    // 파괴된 장애물 지우기
    x.fillStyle = '#0b0718';
    for (const id of m.destroyed) { const o = g.map.obstacles[id]; if (o) x.fillRect(tx(o.x - o.hw) - 1, tx(o.y - o.hh) - 1, o.hw * 2 * S + 2, o.hh * 2 * S + 2); }
    if (g.mode !== 'practice' && m.zr > 0) {
      x.save();
      x.fillStyle = 'rgba(255, 30, 140, 0.28)';
      x.beginPath(); x.rect(0, 0, 380, 380); x.arc(tx(m.zx), tx(m.zy), m.zr * S, 0, Math.PI * 2, true); x.fill('evenodd');
      x.strokeStyle = '#ff2bd6'; x.lineWidth = 3; x.beginPath(); x.arc(tx(m.zx), tx(m.zy), m.zr * S, 0, Math.PI * 2); x.stroke();
      if (m.showNext) { x.setLineDash([8, 6]); x.strokeStyle = '#ffffff'; x.lineWidth = 2; x.beginPath(); x.arc(tx(m.nx), tx(m.ny), m.nr * S, 0, Math.PI * 2); x.stroke(); x.setLineDash([]); }
      x.restore();
    }
    for (const s of m.supplies) {
      if (s.state === 1 || s.state === 2) {
        const pulse = 6 + Math.sin(performance.now() / 150) * 2;
        x.fillStyle = s.state === 2 ? '#ff6bf1' : 'rgba(255,107,241,.6)';
        x.beginPath(); x.moveTo(tx(s.x), tx(s.y) - pulse - 4); x.lineTo(tx(s.x) + pulse, tx(s.y)); x.lineTo(tx(s.x), tx(s.y) + pulse + 4); x.lineTo(tx(s.x) - pulse, tx(s.y)); x.fill();
      }
    }
    // 시야 범위
    const view = g.view.get(g.viewId());
    if (view && m.phase !== 0) { x.strokeStyle = 'rgba(34,243,255,.25)'; x.lineWidth = 1; x.beginPath(); x.arc(tx(view.x), tx(view.y), VIEW_RADIUS * S, 0, Math.PI * 2); x.stroke(); }
    for (const v of g.view.values()) {
      if (v.type === EntType.Neutral) { x.fillStyle = '#ffe14d'; x.beginPath(); x.arc(tx(v.x), tx(v.y), 4, 0, Math.PI * 2); x.fill(); }
      if (v.type === EntType.Pickup && v.sub === 2 && (v.flags & 1)) { x.fillStyle = '#333'; x.fillRect(tx(v.x) - 3, tx(v.y) - 3, 6, 6); }
      if (v.type !== EntType.Hero) continue;
      const mine = v.id === g.you;
      if (mine) continue;
      x.fillStyle = v.id === g.viewId() ? '#22f3ff' : '#ff3355';
      x.beginPath(); x.arc(tx(v.x), tx(v.y), 6, 0, Math.PI * 2); x.fill();
    }
    const meV = g.view.get(g.you);
    if (meV && self.state >= 1 && self.state <= 2) {
      x.save(); x.translate(tx(meV.x), tx(meV.y)); x.rotate(meV.a);
      x.fillStyle = '#22f3ff'; x.strokeStyle = '#fff'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(11, 0); x.lineTo(-7, 7); x.lineTo(-3, 0); x.lineTo(-7, -7); x.closePath(); x.fill(); x.stroke();
      x.restore();
    }
  }
}
