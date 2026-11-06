import { settings } from '../settings';

/** WebAudio 절차 합성 사운드 */
class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  noise!: AudioBuffer;
  listener = { x: 0, y: 0 };
  private recent = new Map<string, number>();

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.sfxBus.connect(this.master); this.musicBus.connect(this.master);
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.sfxBus.gain.value = settings.sfx;
    this.musicBus.gain.value = settings.music * 0.55;
  }

  get t() { return this.ctx!.currentTime; }

  /** 위치 기반: 거리 감쇠 + 좌우 패닝 */
  private spatial(x?: number, y?: number): { gain: number; pan: number } {
    if (x === undefined || y === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listener.x, dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const gain = Math.max(0.0, 1 / (1 + Math.max(0, d - 6) * 0.11)) * (d > 40 ? 0 : 1);
    return { gain, pan: Math.max(-0.9, Math.min(0.9, dx / 14)) };
  }

  private out(x?: number, y?: number, vol = 1): AudioNode | null {
    if (!this.ctx) return null;
    const s = this.spatial(x, y);
    if (s.gain * vol < 0.02) return null;
    const g = this.ctx.createGain();
    g.gain.value = s.gain * vol;
    if (s.pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = s.pan;
      g.connect(p); p.connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    return g;
  }

  tone(dest: AudioNode, o: { f: number; f2?: number; type?: OscillatorType; dur: number; a?: number; vol?: number; delay?: number; detune?: number }) {
    const c = this.ctx!;
    const t0 = this.t + (o.delay ?? 0);
    const osc = c.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = c.createGain();
    const a = o.a ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g); g.connect(dest);
    osc.start(t0); osc.stop(t0 + o.dur + 0.05);
  }

  burst(dest: AudioNode, o: { dur: number; f: number; f2?: number; q?: number; type?: BiquadFilterType; vol?: number; a?: number; delay?: number }) {
    const c = this.ctx!;
    const t0 = this.t + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = c.createBiquadFilter();
    flt.type = o.type ?? 'bandpass';
    flt.frequency.setValueAtTime(o.f, t0);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t0 + o.dur);
    flt.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t0 + (o.a ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + o.dur + 0.05);
  }

  /** 같은 소리가 한 프레임에 겹쳐 폭주하지 않게 */
  private throttle(key: string, ms: number) {
    const now = performance.now();
    if (now - (this.recent.get(key) ?? 0) < ms) return false;
    this.recent.set(key, now);
    return true;
  }

  play(name: string, x?: number, y?: number, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this.throttle(name + (x !== undefined ? Math.round(x) + ',' + Math.round(y!) : ''), 35)) return;
    const o = this.out(x, y, vol);
    if (!o) return;
    const r = 0.94 + Math.random() * 0.12;
    switch (name) {
      case 'hit': this.burst(o, { dur: 0.09, f: 2400 * r, q: 1.2, vol: 0.35 }); this.tone(o, { f: 180 * r, f2: 90, type: 'square', dur: 0.08, vol: 0.12 }); break;
      case 'hitBig': this.burst(o, { dur: 0.25, f: 900, f2: 200, q: 0.8, vol: 0.5 }); this.tone(o, { f: 120, f2: 40, type: 'sine', dur: 0.3, vol: 0.5 }); break;
      case 'hurt': this.tone(o, { f: 300 * r, f2: 120, type: 'sawtooth', dur: 0.15, vol: 0.18 }); this.burst(o, { dur: 0.12, f: 700, q: 2, vol: 0.25 }); break;
      case 'shield': this.tone(o, { f: 1400 * r, f2: 900, type: 'triangle', dur: 0.12, vol: 0.18 }); break;
      case 'kill':
        this.tone(o, { f: 523, type: 'square', dur: 0.12, vol: 0.18 }); this.tone(o, { f: 784, type: 'square', dur: 0.14, vol: 0.18, delay: 0.08 });
        this.tone(o, { f: 1046, type: 'square', dur: 0.3, vol: 0.2, delay: 0.16 }); this.burst(o, { dur: 0.6, f: 3000, f2: 300, q: 0.7, vol: 0.25 }); break;
      case 'death': this.tone(o, { f: 400, f2: 40, type: 'sawtooth', dur: 0.9, vol: 0.3 }); for (let i = 0; i < 6; i++) this.tone(o, { f: 200 + Math.random() * 2000, type: 'square', dur: 0.05, vol: 0.08, delay: i * 0.06 }); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(o, { f, type: 'triangle', dur: 0.25, vol: 0.2, delay: i * 0.07 })); break;
      case 'aug_silver': this.tone(o, { f: 880, type: 'triangle', dur: 0.3, vol: 0.2 }); this.tone(o, { f: 1320, type: 'sine', dur: 0.35, vol: 0.12, delay: 0.06 }); break;
      case 'aug_gold': [660, 990, 1320].forEach((f, i) => this.tone(o, { f, type: 'triangle', dur: 0.4, vol: 0.2, delay: i * 0.06 })); this.burst(o, { dur: 0.5, f: 6000, q: 3, vol: 0.12 }); break;
      case 'aug_prism': [523, 784, 1046, 1568, 2093].forEach((f, i) => this.tone(o, { f, type: 'sawtooth', dur: 0.6, vol: 0.12, delay: i * 0.05, detune: 8 })); this.burst(o, { dur: 1.0, f: 8000, f2: 2000, q: 2, vol: 0.15 }); break;
      case 'siren': for (let i = 0; i < 4; i++) this.tone(o, { f: 600, f2: 1100, type: 'sawtooth', dur: 0.45, vol: 0.12, delay: i * 0.5 }); break;
      case 'zoneWarn': this.tone(o, { f: 220, type: 'square', dur: 0.25, vol: 0.12 }); this.tone(o, { f: 165, type: 'square', dur: 0.35, vol: 0.12, delay: 0.3 }); break;
      case 'drop': this.burst(o, { dur: 1.6, f: 300, f2: 2500, q: 0.6, vol: 0.25, a: 0.8 }); break;
      case 'land': this.tone(o, { f: 90, f2: 30, dur: 0.45, vol: 0.55 }); this.burst(o, { dur: 0.4, f: 500, f2: 100, q: 0.6, vol: 0.4 }); break;
      case 'dodge': this.burst(o, { dur: 0.18, f: 1200, f2: 3000, q: 1.5, vol: 0.2 }); break;
      case 'pickup': this.tone(o, { f: 1200 * r, f2: 1800, type: 'sine', dur: 0.12, vol: 0.15 }); break;
      case 'heal': [440, 554, 659].forEach((f, i) => this.tone(o, { f, type: 'sine', dur: 0.3, vol: 0.12, delay: i * 0.05 })); break;
      case 'ui': this.tone(o, { f: 1600, type: 'square', dur: 0.04, vol: 0.06 }); break;
      case 'uiHover': this.tone(o, { f: 2400, type: 'sine', dur: 0.03, vol: 0.03 }); break;
      case 'error': this.tone(o, { f: 180, type: 'square', dur: 0.15, vol: 0.12 }); break;
      case 'announce': this.tone(o, { f: 110, f2: 220, type: 'sawtooth', dur: 0.4, vol: 0.2 }); this.burst(o, { dur: 0.5, f: 2000, f2: 6000, q: 2, vol: 0.12 }); break;
      case 'blink': this.tone(o, { f: 2000, f2: 400, type: 'sine', dur: 0.15, vol: 0.2 }); this.burst(o, { dur: 0.15, f: 5000, q: 4, vol: 0.12 }); break;
      case 'explode': this.burst(o, { dur: 0.5, f: 600, f2: 80, q: 0.7, vol: 0.5, type: 'lowpass' }); this.tone(o, { f: 80, f2: 30, dur: 0.4, vol: 0.4 }); break;
      case 'beamCharge': this.tone(o, { f: 200, f2: 1600, type: 'sawtooth', dur: 1.0, vol: 0.12, a: 0.9 }); break;
      case 'beam': this.burst(o, { dur: 0.7, f: 3000, f2: 400, q: 0.5, vol: 0.4 }); this.tone(o, { f: 900, f2: 100, type: 'sawtooth', dur: 0.6, vol: 0.25 }); break;
      case 'trap': this.tone(o, { f: 1800, f2: 600, type: 'square', dur: 0.15, vol: 0.18 }); this.burst(o, { dur: 0.2, f: 4000, q: 6, vol: 0.2 }); break;
      case 'teleport': this.tone(o, { f: 300, f2: 2400, type: 'sine', dur: 0.3, vol: 0.18 }); break;
      case 'pad': this.tone(o, { f: 150, f2: 700, type: 'triangle', dur: 0.35, vol: 0.25 }); break;
      case 'destroy': this.burst(o, { dur: 0.6, f: 1500, f2: 150, q: 0.5, vol: 0.4 }); for (let i = 0; i < 4; i++) this.tone(o, { f: 300 + Math.random() * 500, type: 'square', dur: 0.06, vol: 0.08, delay: 0.05 + i * 0.07 }); break;
      case 'bolt': this.burst(o, { dur: 0.15, f: 6000, f2: 1000, q: 1, vol: 0.25 }); this.tone(o, { f: 1500, f2: 200, type: 'sawtooth', dur: 0.12, vol: 0.12 }); break;
      case 'stealth': this.tone(o, { f: 1200, f2: 200, type: 'sine', dur: 0.4, vol: 0.15 }); break;
      case 'grab': this.tone(o, { f: 70, f2: 35, type: 'square', dur: 0.3, vol: 0.35 }); this.burst(o, { dur: 0.15, f: 2500, q: 3, vol: 0.3 }); break;
      case 'supplyLand': this.tone(o, { f: 60, f2: 30, dur: 0.8, vol: 0.6 }); this.burst(o, { dur: 1.0, f: 800, f2: 100, vol: 0.4 }); [784, 1046, 1318].forEach((f, i) => this.tone(o, { f, type: 'triangle', dur: 0.4, vol: 0.12, delay: 0.3 + i * 0.1 })); break;
      case 'emote': this.tone(o, { f: 880, f2: 1320, type: 'triangle', dur: 0.15, vol: 0.1 }); break;
    }
  }

  /** 영웅별 스킬음 */
  skill(hero: number, slot: number, x?: number, y?: number) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.out(x, y, slot === 0 ? 0.55 : 1);
    if (!o) return;
    const r = 0.95 + Math.random() * 0.1;
    switch (hero) {
      case 0: // 해머독: 유압, 금속
        if (slot === 0) { this.burst(o, { dur: 0.1, f: 400 * r, q: 2, vol: 0.3 }); this.tone(o, { f: 110, f2: 60, type: 'square', dur: 0.1, vol: 0.15 }); }
        else if (slot === 4) { this.tone(o, { f: 60, f2: 25, type: 'sawtooth', dur: 0.8, vol: 0.4 }); this.burst(o, { dur: 0.6, f: 300, f2: 60, vol: 0.4, delay: 0.35 }); }
        else { this.burst(o, { dur: 0.25, f: 250, f2: 80, q: 1, vol: 0.4 }); this.tone(o, { f: 140, f2: 50, type: 'square', dur: 0.2, vol: 0.25 }); this.burst(o, { dur: 0.08, f: 3500, q: 8, vol: 0.12, delay: 0.05 }); }
        break;
      case 1: // 레드라인: 체인소
        if (slot === 1 || slot === 4 || slot === 3) {
          const c = this.ctx; const t0 = this.t; const dur = slot === 1 ? 2.4 : 0.6;
          const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(90, t0); osc.frequency.linearRampToValueAtTime(slot === 1 ? 110 : 160, t0 + dur);
          const lfo = c.createOscillator(); lfo.frequency.value = 38; const lg = c.createGain(); lg.gain.value = 30; lfo.connect(lg); lg.connect(osc.frequency);
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
          osc.connect(f); f.connect(g); g.connect(o); osc.start(t0); lfo.start(t0); osc.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
        } else { this.burst(o, { dur: 0.15, f: 1800 * r, f2: 600, q: 2, vol: 0.3 }); this.tone(o, { f: 150, type: 'sawtooth', dur: 0.12, vol: 0.1 }); }
        break;
      case 2: // 미라주: 칼바람, 차임
        if (slot === 2) this.play('stealth', x, y);
        else if (slot === 4) for (let i = 0; i < 5; i++) { this.burst(o, { dur: 0.1, f: 5000, f2: 1500, q: 2, vol: 0.25, delay: i * 0.22 }); this.tone(o, { f: 1800 + i * 150, type: 'sine', dur: 0.1, vol: 0.08, delay: i * 0.22 }); }
        else { this.burst(o, { dur: 0.12, f: 3500 * r, f2: 7000, q: 3, vol: 0.28 }); if (slot === 1) this.tone(o, { f: 2600, type: 'triangle', dur: 0.15, vol: 0.06 }); }
        break;
      case 3: // 실크: 와이어
        if (slot === 4) { this.tone(o, { f: 3000, f2: 300, type: 'sawtooth', dur: 0.6, vol: 0.15 }); this.burst(o, { dur: 0.5, f: 6000, q: 6, vol: 0.12 }); }
        else { this.tone(o, { f: 2200 * r, f2: 4400, type: 'sine', dur: 0.12, vol: 0.18 }); this.burst(o, { dur: 0.1, f: 7000, q: 8, vol: 0.12 }); }
        break;
      case 4: // 레일: 레이저
        if (slot === 4) this.play('beamCharge', x, y);
        else if (slot === 1) { this.tone(o, { f: 2400, f2: 120, type: 'sawtooth', dur: 0.35, vol: 0.3 }); this.burst(o, { dur: 0.3, f: 4000, f2: 300, vol: 0.3 }); }
        else if (slot === 3) this.tone(o, { f: 200, f2: 800, type: 'triangle', dur: 0.25, vol: 0.2 });
        else { this.tone(o, { f: 1800 * r, f2: 300, type: 'square', dur: 0.07, vol: 0.14 }); this.burst(o, { dur: 0.05, f: 3000, q: 1, vol: 0.18 }); }
        break;
      case 5: // 하이브: 미사일, 드론
        if (slot === 1) for (let i = 0; i < 3; i++) this.burst(o, { dur: 0.4, f: 800, f2: 3000, q: 1, vol: 0.18, delay: i * 0.04 });
        else if (slot === 2) [1200, 1600, 2000].forEach((f, i) => this.tone(o, { f, type: 'square', dur: 0.06, vol: 0.08, delay: i * 0.06 }));
        else if (slot === 4) this.play('siren', x, y);
        else { this.tone(o, { f: 900 * r, f2: 500, type: 'square', dur: 0.06, vol: 0.12 }); }
        break;
      case 6: // 글리치: 디지털
        for (let i = 0; i < (slot === 0 ? 2 : 5); i++) this.tone(o, { f: [440, 880, 660, 1320, 990][i] * r, type: 'square', dur: 0.04, vol: 0.09, delay: i * 0.035 });
        if (slot === 4) this.burst(o, { dur: 0.6, f: 1000, f2: 8000, q: 0.5, vol: 0.25 });
        break;
      case 7: // 호라이즌: 중력
        if (slot === 4) { this.tone(o, { f: 40, f2: 25, type: 'sine', dur: 3, vol: 0.4 }); this.tone(o, { f: 80, f2: 60, type: 'sawtooth', dur: 3, vol: 0.06 }); }
        else { this.tone(o, { f: 220 * r, f2: 70, type: 'sine', dur: 0.35, vol: 0.3 }); this.tone(o, { f: 330, f2: 110, type: 'triangle', dur: 0.3, vol: 0.1 }); }
        break;
    }
  }
}

export const audio = new AudioEngine();

/** 절차 생성 신스웨이브 배경음악 */
export class Music {
  private timer = 0;
  private step = 0;
  private nextTime = 0;
  tempo = 96;
  intensity = 0; // 0..1
  theme: 'menu' | 'battle' | 'final' = 'menu';
  private playing = false;

  start() {
    if (!audio.ctx || this.playing) return;
    this.playing = true;
    this.nextTime = audio.t + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() { this.playing = false; clearInterval(this.timer); }

  private chords(): number[][] {
    // 루트 음(MIDI) 기준 화음
    if (this.theme === 'final') return [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]]; // Dm Bb Gm A
    return [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]]; // Am F C G
  }

  private schedule() {
    if (!audio.ctx) return;
    const targetTempo = this.theme === 'menu' ? 88 : this.theme === 'final' ? 132 : 100 + this.intensity * 22;
    this.tempo += (targetTempo - this.tempo) * 0.02;
    const stepDur = 60 / this.tempo / 4;
    while (this.nextTime < audio.t + 0.12) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private note(m: number) { return 440 * 2 ** ((m - 69) / 12); }

  private voice(t: number, f: number, dur: number, type: OscillatorType, vol: number, cutoff: number, detune = 0) {
    const c = audio.ctx!;
    const osc = c.createOscillator(); osc.type = type; osc.frequency.value = f; osc.detune.value = detune;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(flt); flt.connect(g); g.connect(audio.musicBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  private drum(t: number, kind: 'kick' | 'snare' | 'hat', vol: number) {
    const c = audio.ctx!;
    if (kind === 'kick') {
      const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g); g.connect(audio.musicBus); o.start(t); o.stop(t + 0.3);
    } else {
      const s = c.createBufferSource(); s.buffer = audio.noise;
      const f = c.createBiquadFilter(); f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const g = c.createGain(); const d = kind === 'hat' ? 0.05 : 0.18;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(f); f.connect(g); g.connect(audio.musicBus); s.start(t, Math.random()); s.stop(t + d + 0.02);
    }
  }

  private playStep(step: number, t: number, sd: number) {
    const chords = this.chords();
    const bar = Math.floor(step / 16) % 4;
    const ch = chords[bar];
    const s16 = step % 16;
    const battle = this.theme !== 'menu';
    const I = this.intensity;
    // 패드 (마디 시작)
    if (s16 === 0) for (const n of ch) { this.voice(t, this.note(n + 12), sd * 16, 'sawtooth', 0.035, 1400 + I * 1200, -9); this.voice(t, this.note(n + 12), sd * 16, 'sawtooth', 0.035, 1400 + I * 1200, 9); }
    // 베이스
    if (battle ? s16 % 2 === 0 : s16 % 4 === 0) this.voice(t, this.note(ch[0] - 12 + (s16 % 8 === 6 ? 12 : 0)), sd * 1.8, 'sawtooth', 0.12, 500 + I * 700);
    // 아르페지오
    if (battle || s16 % 2 === 0) {
      const arp = [ch[0], ch[1], ch[2], ch[1] + 12, ch[2] + 12, ch[1] + 12, ch[2], ch[1]];
      this.voice(t, this.note(arp[s16 % 8] + 12), sd * 0.9, this.theme === 'final' ? 'square' : 'triangle', 0.045 + I * 0.02, 3000);
    }
    if (!battle) return;
    // 드럼
    if (s16 % 4 === 0) this.drum(t, 'kick', 0.5);
    if (s16 === 4 || s16 === 12) this.drum(t, 'snare', 0.22);
    if (I > 0.3 || this.theme === 'final') this.drum(t, 'hat', s16 % 2 ? 0.05 : 0.09);
    // 최후 3인 리드
    if (this.theme === 'final' && (s16 === 0 || s16 === 6 || s16 === 10)) {
      const lead = [ch[2] + 24, ch[1] + 24, ch[0] + 24][s16 === 0 ? 0 : s16 === 6 ? 1 : 2];
      this.voice(t, this.note(lead), sd * 3, 'sawtooth', 0.05, 4000, 5);
    }
  }
}

export const music = new Music();
