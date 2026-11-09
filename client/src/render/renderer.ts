import * as THREE from 'three';
import { HEROES, type SkillDef } from '@neon/shared';
import { Post } from './post';
import { WorldView } from './worldView';
import { buildHero, HeroAnimator, type HeroRig } from './heroModel';
import { DecalPool, Particles } from './fx';
import { G, glowMaterial, hologramMaterial, propMaterial } from './shaders';
import { settings, type Quality } from '../settings';

/** 영웅 선택/도감용 쇼케이스 장면 */
export class Showcase {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  rig: HeroRig | null = null;
  anim: HeroAnimator | null = null;
  private key = '';
  private decals = new DecalPool();
  private preview: THREE.Mesh | null = null;
  private previewSkill: SkillDef | null = null;
  private previewT = 0;
  private particles = new Particles(600);
  private spin = 0;
  dragging = false;
  offsetX = 0; // 화면에서 모델을 옆으로 이동 (UI 공간 확보)

  constructor() {
    this.scene.background = new THREE.Color(0x07040f);
    this.scene.fog = new THREE.Fog(0x07040f, 12, 30);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.3, 48), propMaterial(0x1a1630));
    plat.position.y = -0.15;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.04, 6, 64), glowMaterial(0xff2bd6, 1.6)); ring.rotation.x = Math.PI / 2;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.025, 6, 64), glowMaterial(0x22f3ff, 1.4)); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.01;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), hologramMaterial(0x9b5cff, { opacity: 0.1, pattern: 4 }));
    back.position.set(0, 4, -6);
    this.scene.add(plat, ring, ring2, back, this.decals.group, this.particles.points);
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 7, 0.05), glowMaterial([0xff2bd6, 0x22f3ff, 0x9b5cff][i % 3], 1.3));
      const a = (i / 6) * Math.PI * 2;
      b.position.set(Math.cos(a) * 6, 3.5, Math.sin(a) * 6 - 2);
      this.scene.add(b);
    }
  }

  setHero(heroIndex: number, palette: number, skin: number) {
    const key = `${heroIndex}:${palette}:${skin}`;
    if (key === this.key) return;
    this.key = key;
    if (this.rig) { this.scene.remove(this.rig.root); this.rig.materials.forEach(m => m.dispose()); }
    this.rig = buildHero(heroIndex, palette, skin);
    this.rig.root.scale.setScalar(1.25);
    this.scene.add(this.rig.root);
    this.anim = new HeroAnimator(this.rig);
    this.particles.ring(0, 0, 1.0, 30, this.rig.c1, 3, 0.2);
  }

  setPreview(skill: SkillDef | null) {
    if (skill === this.previewSkill) return;
    this.previewSkill = skill; this.previewT = 0;
    if (this.preview) { this.decals.release(this.preview); this.preview = null; }
    if (!skill) return;
    const ind = skill.indicator;
    const shape = ind.shape === 'line' ? 2 : ind.shape === 'cone' ? 1 : 0;
    this.preview = this.decals.get(shape as 0 | 1 | 2);
  }

  rotate(dx: number) { this.spin += dx * 0.01; }

  update(dt: number, aspect: number) {
    const cam = this.camera;
    cam.aspect = aspect; cam.updateProjectionMatrix();
    const narrow = aspect < 1.1;
    const ox = narrow ? 0 : this.offsetX;
    cam.fov = narrow ? 40 : 32; cam.updateProjectionMatrix();
    cam.position.set(ox * -1, 3.0, narrow ? 13 : 11.5);
    cam.lookAt(ox * -1, narrow ? 1.0 : 1.35, 0);
    if (!this.rig || !this.anim) return;
    if (!this.dragging) this.spin += dt * 0.4;
    const sk = this.previewSkill;
    let action: ReturnType<typeof Object> = null;
    if (sk) {
      this.previewT += dt;
      const cycle = 1.6;
      const t = this.previewT % cycle;
      action = t < 0.8 ? sk.anim : null;
      const facing = Math.PI / 2 - this.spin;
      this.anim.update(dt, { speed: 0, facing, action: action as never, actionT: t, charging: !!sk.chargeUp && t < 0.8, stunned: false, rolling: 0, air: 0, emote: -1, emoteT: 9, hurtT: 0, cast: false });
      if (this.preview) {
        const mat = this.preview.material as THREE.ShaderMaterial;
        mat.uniforms.uKind.value = 5; mat.uniforms.uColor.value.copy(this.rig.c1); mat.uniforms.uAlpha.value = 0.45; mat.uniforms.uProgress.value = Math.min(1, t / 0.8);
        const ind = sk.indicator;
        const sc = 1.25 * 0.42; // 플랫폼 축척
        const fx = Math.cos(facing) , fz = Math.sin(facing);
        if (ind.shape === 'line') { (mat.uniforms.uKind.value = 0); mat.uniforms.uColor.value.copy(this.rig.c1); this.decals.place(this.preview, 2, 0, 0, { ang: facing, len: Math.min(9, sk.range) * sc * 1.5, w: ind.width * sc * 1.5, y: 0.03 }); }
        else if (ind.shape === 'cone') { mat.uniforms.uKind.value = 0; this.decals.place(this.preview, 1, 0, 0, { r: Math.min(6, sk.range) * sc * 1.5, ang: facing, spread: (ind.angle * Math.PI) / 180, y: 0.03 }); }
        else if (ind.shape === 'self') { mat.uniforms.uKind.value = 0; this.decals.place(this.preview, 0, 0, 0, { r: Math.min(5, ind.radius) * sc * 1.5, y: 0.03 }); }
        else { mat.uniforms.uKind.value = 0; this.decals.place(this.preview, 0, fx * 2.2, fz * 2.2, { r: Math.min(3, ind.radius) * sc * 1.5, y: 0.03 }); }
        if (t > 0.8 && t < 0.85) this.particles.burst(0, 1.2, 0, 20, this.rig.c1, 4, 0.3, 0.5, 0, 1);
      }
    } else {
      this.anim.update(dt, { speed: 0, facing: Math.PI / 2 - this.spin, action: null, actionT: 9, charging: false, stunned: false, rolling: 0, air: 0, emote: -1, emoteT: 9, hurtT: 0, cast: false });
    }
    this.particles.update(dt);
    if (Math.random() < 0.3) this.particles.spawn((Math.random() - 0.5) * 6, 0.1, (Math.random() - 0.5) * 6, 0, 1.5, 0, this.rig.c1, 0.2, 1.2, 0, 0.5);
  }
}

export class Renderer3D {
  renderer: THREE.WebGLRenderer;
  post: Post;
  camera = new THREE.PerspectiveCamera(42, 1, 0.5, 220);
  world: WorldView | null = null;
  showcase = new Showcase();
  mode: 'world' | 'showcase' | 'none' = 'none';
  private canvas: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  time = 0;
  fps = 60;
  private frames = 0; private fpsT = 0;
  hurt = 0; lowHp = 0; outside = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.autoClear = true;
    this.post = new Post(this.renderer);
    this.applyQuality(settings.quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** 품질 설정의 기본 해상도 배율 */
  private basePR = 1;
  /** 자동 해상도 조절 배율 (0.55 ~ 1): 프레임이 떨어지면 낮추고 여유가 생기면 되돌린다 */
  resScale = 1;
  private ftAvg = 16.7;
  private adaptTimer = 0;

  applyQuality(q: Quality) {
    const dpr = window.devicePixelRatio || 1;
    this.basePR = q === 'low' ? Math.min(dpr, 1) * 0.75 : q === 'mid' ? Math.min(dpr, 1.25) : Math.min(dpr, 2);
    this.resScale = 1;
    this.renderer.setPixelRatio(this.basePR);
    this.post.setQuality(q);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    const pr = this.renderer.getPixelRatio();
    this.post.resize(Math.floor(w * pr), Math.floor(h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  screenToGround(sx: number, sy: number): { x: number; y: number } {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return { x: 0, y: 0 };
    return { x: p.x, y: p.z };
  }

  worldToScreen(x: number, y: number, h: number): { x: number; y: number; vis: boolean } {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, vis: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  /** 프레임 시간을 보고 렌더 해상도를 자동 조절 (렉 완화) */
  private adapt(dt: number) {
    const ms = dt * 1000;
    if (ms <= 0 || ms > 250 || document.hidden) return; // 탭 전환 등 비정상 프레임 무시
    this.ftAvg += (ms - this.ftAvg) * 0.05;
    this.adaptTimer += ms;
    if (this.adaptTimer < 1500) return;
    let next = this.resScale;
    if (this.ftAvg > 24 && this.resScale > 0.55) next = Math.max(0.55, this.resScale - 0.1);      // 약 42fps 미만
    else if (this.ftAvg < 18 && this.resScale < 1) next = Math.min(1, this.resScale + 0.05);      // 약 55fps 이상 유지
    if (next !== this.resScale) {
      const up = next > this.resScale;
      this.resScale = next;
      this.renderer.setPixelRatio(this.basePR * next);
      this.resize();
      this.adaptTimer = up ? -6000 : 0; // 올릴 때는 더 천천히 (오르내림 반복 방지)
    } else this.adaptTimer = 0;
  }

  frame(dt: number) {
    this.adapt(dt);
    this.time += dt;
    G.uTime.value = this.time;
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    const u = this.post.compMat.uniforms;
    this.hurt = Math.max(0, this.hurt - dt * 2.5);
    u.uHurt.value = this.hurt; u.uLowHp.value = this.lowHp; u.uOutside.value = this.outside;
    // 네온 강도에 따라 빛 번짐도 함께 줄인다
    u.uBloom.value = 0.3 + 0.5 * G.uNeon.value;
    if (this.mode === 'world' && this.world) {
      this.world.update(dt);
      this.world.renderAux(this.renderer);
      this.post.render(this.world.scene, this.camera, this.time);
    } else if (this.mode === 'showcase') {
      u.uHurt.value = 0; u.uLowHp.value = 0; u.uOutside.value = 0;
      this.showcase.update(dt, window.innerWidth / window.innerHeight);
      this.post.render(this.showcase.scene, this.showcase.camera, this.time);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x07040f);
      this.renderer.clear();
    }
  }
}

export { HEROES };
