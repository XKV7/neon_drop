import { Btn } from '@neon/shared';
import { settings } from '../settings';

/** 키보드/마우스 상태와 스마트 시전 처리 */
export class Input {
  down = new Set<string>();
  mouseX = 0; mouseY = 0; // 화면 좌표
  wheel = 0;
  private latched = 0; // 다음 틱까지 누름 유지
  /** 스마트 시전이 꺼져 있을 때 조준 중인 슬롯 */
  aiming = -1;
  enabled = true;
  onKey: (code: string, e: KeyboardEvent) => boolean = () => false;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', e => this.keyDown(e));
    window.addEventListener('keyup', e => this.down.delete(e.code));
    el.addEventListener('mousedown', e => this.mouseDown(e));
    window.addEventListener('mouseup', e => this.down.delete('Mouse' + e.button));
    window.addEventListener('mousemove', e => { this.mouseX = e.clientX; this.mouseY = e.clientY; });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('blur', () => { this.down.clear(); });
  }

  private actionOf(code: string): string | null {
    for (const [a, c] of Object.entries(settings.keys)) if (c === code) return a;
    return null;
  }

  private keyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (this.onKey(e.code, e)) { e.preventDefault(); return; }
    if (!this.enabled) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F3') e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.press(e.code);
  }

  private mouseDown(e: MouseEvent) {
    if (!this.enabled) return;
    const code = 'Mouse' + e.button;
    this.down.add(code);
    if (e.button === 2 && this.aiming >= 0 && settings.keys.s1 !== 'Mouse2') { this.aiming = -1; return; }
    if (e.button === 0 && this.aiming >= 0) {
      // 조준 확인
      this.latched |= [Btn.Basic, Btn.S1, Btn.S2, Btn.S3, Btn.Ult][this.aiming];
      this.aiming = -1;
      this.suppressBasic = true;
      return;
    }
    this.press(code);
  }

  suppressBasic = false;

  private press(code: string) {
    const a = this.actionOf(code);
    if (!a) return;
    const slotMap: Record<string, number> = { s1: 1, s2: 2, s3: 3, ult: 4 };
    if (a in slotMap) {
      const slot = slotMap[a];
      if (!settings.smartCast && !this.isChargeSlot(slot)) {
        if (this.aiming === slot) { this.latched |= [0, Btn.S1, Btn.S2, Btn.S3, Btn.Ult][slot]; this.aiming = -1; }
        else this.aiming = slot;
        return;
      }
      this.latched |= [0, Btn.S1, Btn.S2, Btn.S3, Btn.Ult][slot];
    } else if (a === 'dodge') this.latched |= Btn.Dodge;
    else if (a === 'interact') this.latched |= Btn.Interact;
    else if (a === 'basic') this.latched |= Btn.Basic;
  }

  isChargeSlot: (slot: number) => boolean = () => false;

  isDown(action: string) { return this.down.has(settings.keys[action]); }

  moveVector(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) y -= 1;
    if (this.isDown('down')) y += 1;
    const l = Math.hypot(x, y);
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  /** 이번 틱의 held / pressed 비트 */
  consume(): { held: number; pressed: number } {
    let held = 0;
    if (this.enabled) {
      if (this.isDown('basic') && this.aiming < 0 && !this.suppressBasic) held |= Btn.Basic;
      if (this.isDown('s1')) held |= Btn.S1;
      if (this.isDown('s2')) held |= Btn.S2;
      if (this.isDown('s3')) held |= Btn.S3;
      if (this.isDown('ult')) held |= Btn.Ult;
    }
    if (!this.isDown('basic')) this.suppressBasic = false;
    const pressed = this.latched;
    this.latched = 0;
    return { held: held | (pressed & (Btn.S1 | Btn.S2 | Btn.S3 | Btn.Ult)), pressed };
  }

  takeWheel() { const w = this.wheel; this.wheel = 0; return w; }
}
