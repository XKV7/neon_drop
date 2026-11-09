import { Btn, type SkillDef } from '@neon/shared';
import { skillIcon } from '../ui/util';

/** 터치 조작 사용 여부 판단 */
export function prefersTouch(): boolean {
  try { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches; } catch { return false; }
}

const SLOT_BITS = [Btn.Basic, Btn.S1, Btn.S2, Btn.S3, Btn.Ult];
const DEAD = 14; // 드래그로 인정하는 최소 거리(px)

interface Drag { slot: number; id: number; ox: number; oy: number; x: number; y: number; moved: boolean; charge: boolean }

export interface TouchCallbacks { menu(): void; score(): void; chat(): void; wheel(): void }

/**
 * 모바일/태블릿 터치 조작.
 * - 화면 왼쪽 어디든: 떠 있는 조이스틱(이동)
 * - 오른쪽 아래 버튼: 탭 = 자동 조준 시전, 드래그 = 직접 조준 후 떼면 시전, ✕ 위에서 떼면 취소
 * - 빈 곳 탭: 그 지점으로 기본 공격 (낙하 단계에서는 낙하 지점 선택)
 */
export class TouchControls {
  root: HTMLElement;
  enabled = false;
  move = { x: 0, y: 0 };
  private joy: { id: number; ox: number; oy: number } | null = null;
  private joyBase: HTMLElement; private joyKnob: HTMLElement;
  drag: Drag | null = null;
  private latched = 0;
  private held = 0;
  /** 빈 곳 탭 위치 (화면 좌표, 다음 틱에 한 번 사용) */
  tap: { x: number; y: number } | null = null;
  private btns: HTMLElement[] = [];
  private cancelEl: HTMLElement;
  private chargeSlots = new Set<number>();
  private cb: TouchCallbacks;
  /** 낙하 단계: 조이스틱·스킬 버튼을 숨기고 화면 어디를 탭하든 낙하 지점 */
  dropMode = false;

  constructor(parent: HTMLElement, cb: TouchCallbacks) {
    this.cb = cb;
    const root = document.createElement('div');
    root.className = 'touch-layer';
    this.root = root;
    root.innerHTML = `<div class="tc-joy hidden"><div class="tc-knob"></div></div>
      <div class="tc-cancel hidden">✕ 취소</div>
      <div class="tc-top"><button class="tc-mini" data-tc="menu" aria-label="메뉴">☰</button><button class="tc-mini" data-tc="score" aria-label="점수판">≡</button><button class="tc-mini" data-tc="chat" aria-label="채팅">✉</button><button class="tc-mini" data-tc="wheel" aria-label="퀵 채팅/감정 표현">☺</button></div>`;
    this.joyBase = root.querySelector('.tc-joy')!;
    this.joyKnob = root.querySelector('.tc-knob')!;
    this.cancelEl = root.querySelector('.tc-cancel')!;
    // 0 기본, 1~3 스킬, 4 궁극기, 5 구르기, 6 상호작용
    const labels = ['', '', '', '', '', '↻', 'F'];
    for (let i = 0; i < 7; i++) {
      const b = document.createElement('div');
      b.className = 'tc-btn' + (i === 0 ? ' big' : '') + (i === 4 ? ' ult' : '') + (i >= 5 ? ' util' : '');
      b.dataset.slot = String(i);
      b.innerHTML = `<span class="ic">${labels[i]}</span><div class="cd"></div><div class="cdn"></div><div class="chg"></div>`;
      root.appendChild(b);
      this.btns.push(b);
      b.addEventListener('pointerdown', e => this.btnDown(e, i));
    }
    root.addEventListener('pointerdown', e => this.layerDown(e));
    window.addEventListener('pointermove', e => this.pointerMove(e), { passive: false });
    window.addEventListener('pointerup', e => this.pointerUp(e));
    window.addEventListener('pointercancel', e => this.pointerUp(e, true));
    root.querySelectorAll<HTMLElement>('[data-tc]').forEach(b => b.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const k = b.dataset.tc as keyof TouchCallbacks;
      this.cb[k]();
    }));
    root.addEventListener('contextmenu', e => e.preventDefault());
    parent.prepend(root);
    window.addEventListener('resize', () => this.layout());
    this.setEnabled(false);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.root.classList.toggle('hidden', !on);
    document.body.classList.toggle('touch', on);
    if (!on) this.reset();
    else this.layout();
  }

  destroy() { this.root.remove(); document.body.classList.remove('touch'); }

  setDropMode(on: boolean) {
    if (on === this.dropMode) return;
    this.dropMode = on;
    this.root.classList.toggle('drop', on);
    if (on) { this.joy = null; this.move = { x: 0, y: 0 }; this.joyBase.classList.add('hidden'); }
  }

  reset() { this.joy = null; this.drag = null; this.held = 0; this.latched = 0; this.move = { x: 0, y: 0 }; this.joyBase.classList.add('hidden'); this.cancelEl.classList.add('hidden'); }

  /** 스킬 아이콘/충전형 여부 설정 */
  setSkills(skills: SkillDef[]) {
    this.chargeSlots.clear();
    skills.forEach((s, i) => {
      if (i > 4) return;
      (this.btns[i].querySelector('.ic') as HTMLElement).textContent = skillIcon(s, i);
      this.btns[i].title = s.name;
      if (s.chargeUp) this.chargeSlots.add(i);
    });
  }

  /** 버튼 배치: 기본 공격 버튼을 중심으로 엄지 호를 따라 */
  layout() {
    const vmin = Math.min(innerWidth, innerHeight);
    const small = Math.max(44, Math.min(70, vmin * 0.13));
    const big = small * 1.45;
    const st = getComputedStyle(document.documentElement);
    const sr = parseFloat(st.getPropertyValue('--sai-r')) || 0, sb = parseFloat(st.getPropertyValue('--sai-b')) || 0;
    const cx = innerWidth - sr - 18 - big / 2, cy = innerHeight - sb - 18 - big / 2;
    const R = big / 2 + small / 2 + 10;
    const place = (i: number, x: number, y: number, size: number) => {
      const b = this.btns[i];
      b.style.width = b.style.height = size + 'px';
      b.style.left = x - size / 2 + 'px'; b.style.top = y - size / 2 + 'px';
    };
    place(0, cx, cy, big);
    const at = (deg: number, r: number) => [cx + Math.cos((deg * Math.PI) / 180) * r, cy - Math.sin((deg * Math.PI) / 180) * r] as const;
    [[1, 180], [2, 135], [3, 90]].forEach(([i, d]) => { const [x, y] = at(d, R); place(i, x, y, small); });
    { const [x, y] = at(135, R + small + 6); place(4, x, y, small * 1.1); }
    { const [x, y] = at(205, R + 4); place(5, x, y, small * 0.85); }
    { const [x, y] = at(178, R + small + 8); place(6, x, y, small * 0.8); }
  }

  private btnDown(e: PointerEvent, slot: number) {
    e.preventDefault(); e.stopPropagation();
    if (slot === 5) { this.latched |= Btn.Dodge; this.flash(slot); return; }
    if (slot === 6) { this.latched |= Btn.Interact; this.flash(slot); return; }
    if (this.drag) return;
    const charge = this.chargeSlots.has(slot);
    this.drag = { slot, id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, moved: false, charge };
    if (slot === 0) this.held |= Btn.Basic;
    if (charge) { this.latched |= SLOT_BITS[slot]; this.held |= SLOT_BITS[slot]; }
    this.btns[slot].classList.add('on');
  }

  private layerDown(e: PointerEvent) {
    if (e.target !== this.root) return;
    e.preventDefault();
    if (!this.dropMode && e.clientX < innerWidth * 0.5 && !this.joy) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.joyBase.style.left = e.clientX + 'px'; this.joyBase.style.top = e.clientY + 'px';
      this.joyBase.classList.remove('hidden');
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    this.tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  }
  private tapStart: { id: number; x: number; y: number; t: number } | null = null;

  private pointerMove(e: PointerEvent) {
    if (this.joy && e.pointerId === this.joy.id) {
      const R = Math.max(40, Math.min(70, Math.min(innerWidth, innerHeight) * 0.12));
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const k = Math.min(1, l / R);
      this.move = l < 6 ? { x: 0, y: 0 } : { x: (dx / Math.max(1, Math.hypot(dx, dy))) * Math.max(k, 0.35), y: (dy / Math.max(1, Math.hypot(dx, dy))) * Math.max(k, 0.35) };
      e.preventDefault();
    }
    const d = this.drag;
    if (d && e.pointerId === d.id) {
      d.x = e.clientX; d.y = e.clientY;
      if (!d.moved && Math.hypot(d.x - d.ox, d.y - d.oy) > DEAD) { d.moved = true; if (d.slot > 0) this.cancelEl.classList.remove('hidden'); }
      this.cancelEl.classList.toggle('hot', this.overCancel(d.x, d.y));
      e.preventDefault();
    }
  }

  private overCancel(x: number, y: number) {
    if (this.cancelEl.classList.contains('hidden')) return false;
    const r = this.cancelEl.getBoundingClientRect();
    return x >= r.left - 20 && x <= r.right + 20 && y >= r.top - 20 && y <= r.bottom + 20;
  }

  private pointerUp(e: PointerEvent, cancelled = false) {
    if (this.joy && e.pointerId === this.joy.id) { this.joy = null; this.move = { x: 0, y: 0 }; this.joyBase.classList.add('hidden'); }
    if (this.tapStart && e.pointerId === this.tapStart.id) {
      const t = this.tapStart; this.tapStart = null;
      if (!cancelled && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 18 && performance.now() - t.t < 450) this.tap = { x: e.clientX, y: e.clientY };
    }
    const d = this.drag;
    if (d && e.pointerId === d.id) {
      const cancel = cancelled || this.overCancel(e.clientX, e.clientY);
      this.btns[d.slot].classList.remove('on');
      this.cancelEl.classList.add('hidden'); this.cancelEl.classList.remove('hot');
      if (d.slot === 0) this.held &= ~Btn.Basic;
      else if (d.charge) this.held &= ~SLOT_BITS[d.slot];
      else if (!cancel) { this.latched |= SLOT_BITS[d.slot]; this.releasedAim = { ...d }; this.releasedAt = performance.now(); }
      this.drag = null;
    }
  }
  /** 방금 놓은 스킬의 조준 정보 (다음 틱 조준 계산용) */
  releasedAim: Drag | null = null;
  private releasedAt = 0;

  latchBasic() { this.latched |= Btn.Basic; }
  get joyActive() { return !!this.joy; }

  private flash(i: number) { const b = this.btns[i]; b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 120); }

  /** 이번 틱 버튼 상태 */
  consume(): { held: number; pressed: number } {
    const pressed = this.latched;
    this.latched = 0;
    return { held: this.held | (pressed & (Btn.S1 | Btn.S2 | Btn.S3 | Btn.Ult)), pressed };
  }

  /** 드래그 중인(또는 방금 놓은) 조준: 화면 방향과 세기(0..1) */
  aimVector(): { slot: number; dx: number; dy: number; k: number; manual: boolean } | null {
    const d = this.drag ?? (this.releasedAim && performance.now() - this.releasedAt < 150 ? this.releasedAim : null);
    if (!d) return null;
    const dx = d.x - d.ox, dy = d.y - d.oy, l = Math.hypot(dx, dy);
    const maxDrag = Math.max(70, Math.min(innerWidth, innerHeight) * 0.22);
    return { slot: d.slot, dx: l > 0 ? dx / l : 0, dy: l > 0 ? dy / l : 0, k: Math.min(1, l / maxDrag), manual: d.moved };
  }

  /** HUD 정보로 버튼 표시 갱신 */
  update(s: { cds: number[]; maxCds: number[]; charges: number[]; chargeMax: number[]; ult: number; dodgeCd: number; dodgeCdMax: number }, silenced: boolean, canInteract: boolean) {
    for (let i = 0; i < 6; i++) {
      const b = this.btns[i];
      let p = 0, txt = '', chg = '';
      if (i === 5) { p = s.dodgeCd / Math.max(1, s.dodgeCdMax); txt = s.dodgeCd > 0 ? Math.ceil(s.dodgeCd / 30) + '' : ''; }
      else if (i === 4) { p = 1 - s.ult; txt = s.ult < 1 ? Math.floor(s.ult * 100) + '%' : ''; b.classList.toggle('ready', s.ult >= 1); }
      else {
        const ready = s.charges[i] > 0;
        p = ready ? 0 : s.cds[i] / Math.max(1, s.maxCds[i]);
        txt = !ready && i > 0 && s.cds[i] > 0 ? Math.ceil(s.cds[i] / 30) + '' : '';
        if (s.chargeMax[i] > 1) chg = String(s.charges[i]);
      }
      (b.children[1] as HTMLElement).style.setProperty('--p', p * 100 + '%');
      (b.children[2] as HTMLElement).textContent = txt;
      (b.children[3] as HTMLElement).textContent = chg;
      b.classList.toggle('silenced', silenced && i > 0 && i < 5);
    }
    this.btns[6].classList.toggle('hidden', !canInteract);
  }
}
