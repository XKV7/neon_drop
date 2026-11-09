import * as THREE from 'three';
import {
  EntType, HF, Fx, HEROES, heroPalettes, raycast, VIEW_RADIUS, FX_VISUALS, HERO_BY_ID, type SimEvent, type SkillDef, AUGMENT_BY_ID,
} from '@neon/shared';
import type { ClientGame, VisEnt } from '../game/clientGame';
import { MapView, NEON } from './mapView';
import { buildHero, HeroAnimator, type HeroRig, type AnimState } from './heroModel';
import { Particles, Voxels, Rain, DecalPool, Transients, projectileMesh, qualityCounts } from './fx';
import { G, glowMaterial, propMaterial, zoneWallMaterial, hologramMaterial } from './shaders';
export type { HeroRig };
import { audio } from '../audio/audio';
import { settings, type Quality } from '../settings';

interface HeroVis { id: number; rig: HeroRig; anim: HeroAnimator; seq: number; action: AnimState['action']; actionT: number; hurtT: number; flash: number; emote: number; emoteT: number; lastX: number; lastY: number; speed: number; air: number; dead: boolean; trailT: number }

export interface Hooks {
  dmgNumber(x: number, y: number, h: number, amount: number, kind: 'dealt' | 'taken' | 'shield' | 'heal' | 'dot' | 'zone' | 'big'): void;
  shake(amount: number): void;
  hitstop(ms: number): void;
  hurt(amount: number): void;
  levelUp(): void;
  onEmote(heroId: number, emote: number): void;
}

const RED = new THREE.Color(1.0, 0.18, 0.3), CYAN = new THREE.Color(0.13, 0.95, 1.0), ORANGE = new THREE.Color(1.0, 0.5, 0.1);

export class WorldView {
  scene = new THREE.Scene();
  game: ClientGame;
  mapView: MapView;
  heroes = new Map<number, HeroVis>();
  private projs = new Map<number, THREE.Object3D>();
  private decalEnts = new Map<number, { mesh: THREE.Mesh; extra?: THREE.Object3D }>();
  private others = new Map<number, THREE.Object3D>();
  particles: Particles;
  voxels: Voxels;
  rain: Rain;
  decals = new DecalPool();
  trans: Transients;
  zoneWall: THREE.Mesh;
  private indicator: THREE.Mesh | null = null;
  private indicator2: THREE.Mesh | null = null;
  hooks: Hooks;
  quality: Quality;
  // 시야
  visRT: THREE.WebGLRenderTarget;
  private visScene = new THREE.Scene();
  private visCam = new THREE.OrthographicCamera(-48, 48, 48, -48, 0.1, 10);
  private visGeo: THREE.BufferGeometry;
  private visRays = 160;
  // 반사
  reflRT: THREE.WebGLRenderTarget | null = null;
  private mirrorCam = new THREE.PerspectiveCamera();
  // 카메라
  camera: THREE.PerspectiveCamera;
  camX = 0; camZ = 0; zoom = 1; shakeAmt = 0; private shakeT = 0;
  orbit = false;
  private orbitA = 0;
  focusId = 0;
  private time = 0;
  private hitstopT = 0;
  private stunStarsT = 0;
  private transport: THREE.Group;
  debugHitboxes = false;
  private hitboxes = new Map<number, THREE.Mesh>();

  constructor(game: ClientGame, camera: THREE.PerspectiveCamera, hooks: Hooks, quality: Quality) {
    this.game = game;
    this.camera = camera;
    this.hooks = hooks;
    this.quality = quality;
    const sc = this.scene;
    sc.background = new THREE.Color(0x07040f);
    sc.fog = new THREE.Fog(0x0b0618, 40, 110);
    this.mapView = new MapView(game.map);
    sc.add(this.mapView.group);
    const qc = qualityCounts(quality);
    this.particles = new Particles(qc.particles);
    this.voxels = new Voxels(qc.voxels);
    this.rain = new Rain(qc.rain);
    this.trans = new Transients(this.decals);
    sc.add(this.particles.points, this.voxels.mesh, this.rain.mesh, this.decals.group, this.trans.group);
    // 붕괴 경계 벽
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true); wallGeo.translate(0, 0.5, 0);
    this.zoneWall = new THREE.Mesh(wallGeo, zoneWallMaterial());
    this.zoneWall.renderOrder = 5;
    sc.add(this.zoneWall);
    // 시야 마스크
    this.visRT = new THREE.WebGLRenderTarget(256, 256, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
    this.visGeo = new THREE.BufferGeometry();
    this.visGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((this.visRays + 2) * 3), 3));
    const idx: number[] = [];
    for (let i = 1; i <= this.visRays; i++) idx.push(0, i, i + 1);
    this.visGeo.setIndex(idx);
    const fan = new THREE.Mesh(this.visGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    fan.frustumCulled = false;
    this.visScene.add(fan);
    this.visScene.background = new THREE.Color(0x000000);
    this.visCam.position.set(0, 5, 0); this.visCam.up.set(0, 0, -1); this.visCam.lookAt(0, 0, 0);
    // 주의: 위에서 내려다보는 직교 카메라의 화면 위쪽 = -z → 텍스처 v는 z 증가 방향과 반대이므로 셰이더 uv와 맞춘다
    this.visCam.up.set(0, 0, 1); this.visCam.lookAt(0, 0, 0);
    G.uVisTex.value = this.visRT.texture;
    if (quality === 'high') {
      this.reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
      this.mapView.groundMat.uniforms.uRefl.value = this.reflRT.texture;
      this.mapView.groundMat.uniforms.uReflOn.value = 1;
    }
    // 수송 드론 (낙하 단계)
    this.transport = this.buildTransport();
    sc.add(this.transport);
    // 은은한 환경광 (툰 셰이더는 자체 조명이므로 기본 재질용)
    sc.add(new THREE.HemisphereLight(0x6a4cff, 0x110820, 0.6));
  }

  private buildTransport(): THREE.Group {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 3.2), propMaterial(0x2a2840, { emissiveEdge: 0.05 }));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 6).rotateZ(-Math.PI / 2), propMaterial(0x3a3858));
    nose.position.x = 6;
    g.add(hull, nose);
    for (const [x, z] of [[-3.5, -3], [-3.5, 3], [3, -3], [3, 3]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.6), propMaterial(0x24223a));
      arm.position.set(x, 0.3, z / 2); g.add(arm);
      const rotor = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.08, 4, 20), glowMaterial(0x22f3ff, 2.5));
      rotor.rotation.x = Math.PI / 2; rotor.position.set(x, 0.5, z); g.add(rotor);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.12, 0.1), glowMaterial(0xff2bd6, 3));
    strip.position.set(0, -0.4, 1.62); g.add(strip);
    const strip2 = strip.clone(); strip2.position.z = -1.62; g.add(strip2);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(5, 18, 16, 1, true).translate(0, -9, 0), hologramMaterial(0xff2bd6, { opacity: 0.12 }));
    g.add(beam);
    g.visible = false;
    return g;
  }

  dispose() {
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
    });
    this.visRT.dispose();
    this.reflRT?.dispose();
  }

  private heroColor(id: number): { c1: THREE.Color; c2: THREE.Color } {
    const r = this.game.rosterOf(id);
    if (!r) return { c1: CYAN, c2: RED };
    const p = heroPalettes(r.heroId)[r.cos.palette] ?? heroPalettes(r.heroId)[0];
    return { c1: new THREE.Color(p.c1), c2: new THREE.Color(p.c2) };
  }

  private makeHero(v: VisEnt): HeroVis {
    const r = this.game.rosterOf(v.id);
    const idx = r ? HERO_BY_ID[r.heroId].index : v.sub;
    const rig = buildHero(idx, r?.cos.palette ?? 0, r?.cos.skin ?? 0);
    this.scene.add(rig.root);
    const hv: HeroVis = { id: v.id, rig, anim: new HeroAnimator(rig), seq: v.animSeq, action: null, actionT: 9, hurtT: 0, flash: 0, emote: -1, emoteT: 9, lastX: v.x, lastY: v.y, speed: 0, air: 0, dead: false, trailT: 0 };
    this.heroes.set(v.id, hv);
    return hv;
  }

  // ───────────────── 프레임 ─────────────────
  update(dt: number) {
    this.time += dt;
    G.uTime.value = this.time;
    if (this.hitstopT > 0) this.hitstopT -= dt;
    const adt = this.hitstopT > 0 ? dt * 0.08 : dt;
    const g = this.game;
    for (const e of g.takeEvents()) this.onEvent(e);
    const seen = new Set<number>();
    for (const v of g.view.values()) {
      seen.add(v.id);
      switch (v.type) {
        case EntType.Hero: this.syncHero(v, adt); break;
        case EntType.Proj: this.syncProj(v, dt); break;
        case EntType.Zone: case EntType.Tele: this.syncDecal(v); break;
        case EntType.Deploy: this.syncDeploy(v); break;
        case EntType.Neutral: this.syncNeutral(v); break;
        case EntType.Pickup: this.syncPickup(v); break;
      }
    }
    for (const [id, h] of this.heroes) if (!seen.has(id)) { this.scene.remove(h.rig.root); h.rig.materials.forEach(m => m.dispose()); this.heroes.delete(id); }
    for (const [id, o] of this.projs) if (!seen.has(id)) { this.scene.remove(o); this.projs.delete(id); }
    for (const [id, d] of this.decalEnts) if (!seen.has(id)) { this.decals.release(d.mesh); if (d.extra) this.scene.remove(d.extra); this.decalEnts.delete(id); }
    for (const [id, o] of this.others) if (!seen.has(id)) { (o.userData.release as (() => void) | undefined)?.(); this.scene.remove(o); this.others.delete(id); }

    this.updateZone();
    // 수송 드론: 낙하 단계 동안 맵을 가로지른다
    const mb = g.match;
    if (mb && mb.phase === 0 && g.mode !== 'practice') {
      const t = Math.min(1, mb.time / 30 / 10);
      this.transport.visible = true;
      this.transport.position.set(-55 + 110 * t, 17 + Math.sin(this.time * 2) * 0.3, -22 + 44 * t);
      this.transport.rotation.y = -Math.atan2(44, 110);
      this.transport.children.forEach((c, i) => { if (i >= 2 && (c as THREE.Mesh).geometry.type === 'TorusGeometry') c.rotation.z = this.time * 20; });
    } else this.transport.visible = false;
    // 디버그 히트박스
    for (const [id, m] of this.hitboxes) if (!this.debugHitboxes || !g.view.has(id)) { this.scene.remove(m); this.hitboxes.delete(id); }
    if (this.debugHitboxes) for (const v of g.view.values()) {
      if (v.type !== EntType.Hero && v.type !== EntType.Proj) continue;
      let m = this.hitboxes.get(v.id);
      if (!m) { m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: v.type === EntType.Hero ? 0x00ff66 : 0xffff00, transparent: true, opacity: 0.9, depthTest: false })); m.renderOrder = 20; this.scene.add(m); this.hitboxes.set(v.id, m); }
      const r = v.type === EntType.Hero ? 0.55 : v.r / 100;
      m.scale.setScalar(r); m.position.set(v.x, v.type === EntType.Proj ? 1 : 0.08, v.y);
    }
    this.updateCamera(dt);
    this.particles.update(dt);
    this.voxels.update(dt);
    this.trans.update(dt);
    this.rain.update(dt, this.camX, this.camZ, this.camera.quaternion, (x, z) => { if (Math.random() < 0.3) this.particles.spawn(x, 0.05, z, 0, 0.6, 0, new THREE.Color(0.3, 0.4, 0.8), 0.12, 0.25, 2); });
    const fp = this.focusPos();
    if (fp) this.mapView.updateBushFade(fp.x, fp.y);
    audio.listener = { x: this.camX, y: this.camZ - 2 };
  }

  focusPos(): { x: number; y: number } | null {
    const id = this.focusId || this.game.viewId();
    const v = this.game.view.get(id);
    return v ? { x: v.x, y: v.y } : null;
  }

  private syncHero(v: VisEnt, dt: number) {
    let h = this.heroes.get(v.id);
    if (!h) h = this.makeHero(v);
    const rig = h.rig;
    const dist = Math.hypot(v.x - h.lastX, v.y - h.lastY);
    h.speed = h.speed * 0.8 + (dt > 0 ? Math.min(14, dist / Math.max(dt, 1e-3)) : 0) * 0.2;
    h.lastX = v.x; h.lastY = v.y;
    if (v.animSeq !== h.seq) {
      h.seq = v.animSeq;
      if (v.anim >= 10) { h.emote = v.anim - 10; h.emoteT = 0; }
      else if (v.anim >= 1 && v.anim <= 5) {
        const def = HEROES[v.sub];
        const sk: SkillDef = [def.basic, ...def.skills, def.ult][v.anim - 1];
        h.action = sk.anim; h.actionT = 0;
      }
    }
    h.actionT += dt; h.emoteT += dt;
    if (h.actionT > 0.8) h.action = null;
    if (h.hurtT > 0) h.hurtT -= dt;
    h.flash = Math.max(0, h.flash - dt * 6);
    // 공중 높이
    const ft = v.aux & 255, ft0 = (v.aux >> 8) & 255;
    let air = 0;
    if (v.flags & HF.Air && ft0 > 0) air = Math.sin(Math.PI * (1 - ft / ft0)) * (ft0 > 20 ? 3.5 : 2.2);
    if (v.flags & HF.Landing) air = Math.max(0, (v.r / 60) * 26);
    h.air += (air - h.air) * Math.min(1, dt * 18);
    const rolling = v.flags & HF.Dodge && ft0 > 0 ? 1 - ft / ft0 : 0;
    rig.root.position.set(v.x, 0, v.y);
    h.anim.update(dt, {
      speed: h.speed, facing: v.a, action: h.action, actionT: h.actionT, charging: (v.flags & HF.Charge) !== 0, stunned: (v.flags & HF.Stun) !== 0,
      rolling, air: h.air, emote: h.emote, emoteT: h.emoteT, hurtT: Math.max(0, h.hurtT), cast: (v.flags & HF.Cast) !== 0,
    });
    // 은신/부시/무적 표현
    const me = v.id === this.game.you;
    let op = 1;
    if (v.flags & HF.Stealth) op = me ? 0.35 : 0.18;
    if (v.flags & HF.Bush && me) op = Math.min(op, 0.55);
    if (v.flags & HF.Disconnected) op = 0.5;
    rig.uniforms.uOpacity.value = op;
    rig.uniforms.uFlash.value = h.flash;
    const tint = rig.uniforms.uTint.value as THREE.Color;
    if (v.flags & HF.Invuln || v.flags & HF.Untarget) tint.setRGB(0.15, 0.15, 0.25);
    else if (v.flags & HF.Invert) tint.setRGB(0.25, 0.0, 0.2);
    else if (v.flags & HF.Silence) tint.setRGB(0.12, 0.0, 0.18);
    else if (v.flags & HF.Root) tint.setRGB(0.0, 0.12, 0.05);
    else tint.setRGB(0, 0, 0);
    // 낙하 트레일
    if (v.flags & HF.Landing) {
      h.trailT -= dt;
      if (h.trailT <= 0) { h.trailT = 0.03; const { c1 } = this.heroColor(v.id); this.particles.spawn(v.x + (Math.random() - 0.5) * 0.4, h.air + 1, v.y + (Math.random() - 0.5) * 0.4, 0, 3, 0, c1, 0.5, 0.5); }
    }
    if (v.flags & HF.Stun) {
      this.stunStarsT -= dt;
      if (this.stunStarsT <= 0) { this.stunStarsT = 0.08; const a = this.time * 8; this.particles.spawn(v.x + Math.cos(a) * 0.4, 2.3 + h.air, v.y + Math.sin(a) * 0.4, 0, 0.3, 0, new THREE.Color(1, 0.9, 0.3), 0.18, 0.35); }
    }
    if (h.speed > 6.5 && Math.random() < 0.5) { const { c1 } = this.heroColor(v.id); this.particles.spawn(v.x, 0.6 + h.air, v.y, 0, 0.2, 0, c1, 0.35, 0.3); }
  }

  private syncProj(v: VisEnt, dt: number) {
    let o = this.projs.get(v.id);
    if (!o) {
      const neutral = (v.aux & 1) !== 0;
      const col = neutral ? RED : this.heroColor(v.owner).c1;
      o = projectileMesh(v.sub, col);
      o.userData.col = col;
      this.scene.add(o);
      this.projs.set(v.id, o);
      if (v.aux & 8) this.trans.flash(v.x, 1, v.y, 2.5, col, 0.2, this.camera);
    }
    o.position.set(v.x, 1.0, v.y);
    o.rotation.y = -v.a;
    if (o.userData.spin) o.children.forEach(c => (c.rotation.y += dt * 20));
    const col = o.userData.col as THREE.Color;
    if (Math.random() < (this.quality === 'low' ? 0.3 : 0.8)) this.particles.spawn(v.x, 1.0, v.y, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, col, v.sub === 5 ? 0.5 : 0.28, 0.25, 0, 4);
  }

  private syncDecal(v: VisEnt) {
    let d = this.decalEnts.get(v.id);
    const mine = v.owner === this.game.you;
    if (v.type === EntType.Zone) {
      if (!d) {
        const m = this.decals.get(0);
        d = { mesh: m };
        this.decalEnts.set(v.id, d);
      }
      const mat = d.mesh.material as THREE.ShaderMaterial;
      const vis = FX_VISUALS[v.sub] ?? 'spin';
      const kind = vis === 'gravity' || vis === 'blackhole' ? 2 : vis === 'web' ? 3 : vis === 'hack' ? 4 : 1;
      mat.uniforms.uKind.value = kind;
      mat.uniforms.uProgress.value = vis === 'blackhole' ? 1 : 0;
      const col = mine ? this.heroColor(v.owner).c1 : this.heroColor(v.owner).c1;
      mat.uniforms.uColor.value.copy(col);
      const started = (v.flags & 1) !== 0;
      mat.uniforms.uAlpha.value = started ? Math.min(1, (v.aux - v.t) / 10) : 0.4 + 0.3 * Math.sin(this.time * 20);
      this.decals.place(d.mesh, 0, v.x, v.y, { r: v.r / 100 });
      if (vis === 'blackhole' && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, rr = (v.r / 100) * (0.6 + Math.random() * 0.4);
        this.particles.spawn(v.x + Math.cos(a) * rr, 0.3 + Math.random(), v.y + Math.sin(a) * rr, -Math.cos(a) * rr * 1.5, 0.2, -Math.sin(a) * rr * 1.5, col, 0.25, 0.6, 0, 0);
      }
      if (vis === 'spin' && Math.random() < 0.7) { const a = this.time * 12 + Math.random(); const rr = v.r / 100; this.particles.spawn(v.x + Math.cos(a) * rr, 0.9, v.y + Math.sin(a) * rr, -Math.sin(a) * 3, 0.5, Math.cos(a) * 3, col, 0.25, 0.25); }
      return;
    }
    // 텔레그래프 (경고)
    const shape = v.level as 0 | 1 | 2;
    if (!d) { d = { mesh: this.decals.get(shape) }; this.decalEnts.set(v.id, d); }
    const mat = d.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uKind.value = 0;
    mat.uniforms.uColor.value.copy(mine ? CYAN : v.sub === 1 ? ORANGE : RED);
    mat.uniforms.uProgress.value = Math.min(1, v.t / Math.max(1, v.aux));
    mat.uniforms.uAlpha.value = mine ? 0.55 : 0.95;
    this.decals.place(d.mesh, shape, v.x, v.y, { r: v.r / 100, ang: v.a, len: v.maxHp / 100, w: v.shield / 100, spread: v.maxHp / 100, y: 0.06 });
  }

  private syncDeploy(v: VisEnt) {
    let o = this.others.get(v.id);
    const { c1 } = this.heroColor(v.owner);
    if (!o) {
      const g = new THREE.Group();
      if (v.sub === 1) {
        const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 6), glowMaterial(c1, 1.5, { additive: true, opacity: 0.7 }));
        g.add(hex);
        const lines = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 6).rotateX(-Math.PI / 2), glowMaterial(c1, 2.5, { additive: true }));
        lines.position.y = 0.04; g.add(lines);
      } else {
        const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), propMaterial(0x30304a));
        body.position.y = 1.4; g.add(body);
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), glowMaterial(c1, 3));
        eye.position.set(0.2, 1.4, 0); g.add(eye);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 4, 16), glowMaterial(c1, 2.5));
        ring.rotation.x = Math.PI / 2; ring.position.y = 1.4; g.add(ring);
        if (v.sub === 2) {
          const m = this.decals.get(0);
          const mat = m.material as THREE.ShaderMaterial;
          mat.uniforms.uKind.value = 4; mat.uniforms.uColor.value.copy(c1); mat.uniforms.uAlpha.value = 0.8;
          this.decals.place(m, 0, v.x, v.y, { r: v.r / 100 });
          g.userData.decal = m;
        }
      }
      this.scene.add(g); this.others.set(v.id, g); o = g;
      const dec = o.userData.decal as THREE.Mesh | undefined;
      if (dec) o.userData.release = () => this.decals.release(dec);
    }
    o.position.set(v.x, 0, v.y);
    if (v.sub !== 1) { o.rotation.y = -v.a; o.children[0].position.y = 1.4 + Math.sin(this.time * 3 + v.id) * 0.1; }
    else o.scale.setScalar((v.flags & 1) ? 1 : 0.5 + 0.2 * Math.sin(this.time * 20));
  }

  private syncNeutral(v: VisEnt) {
    let o = this.others.get(v.id);
    if (!o) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), propMaterial(0x2a2a3a));
      body.position.y = 1.6; g.add(body);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), glowMaterial(0xff2240, 4));
      eye.position.set(0, 1.6, 0.38); g.add(eye);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 4, 20), glowMaterial(0xffe14d, 2.5));
      ring.rotation.x = Math.PI / 2; ring.position.y = 1.6; g.add(ring);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
      shadow.position.y = 0.03; g.add(shadow);
      this.scene.add(g); this.others.set(v.id, g); o = g;
    }
    o.position.set(v.x, Math.sin(this.time * 2 + v.id) * 0.15, v.y);
    o.rotation.y = Math.PI / 2 - v.a;
    (o.children[2] as THREE.Mesh).rotation.z = this.time * ((v.flags & 1) ? 6 : 1.5);
  }

  private syncPickup(v: VisEnt) {
    let o = this.others.get(v.id);
    if (!o) {
      const g = new THREE.Group();
      if (v.sub === 0) {
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowMaterial(0x22f3ff, 3));
        core.position.y = 0.7; g.add(core);
        const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), glowMaterial(0x9b5cff, 1.4, { additive: true, opacity: 0.4 }));
        shell.position.y = 0.7; g.add(shell);
      } else if (v.sub === 1) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4).translate(0, 0.5, 0), propMaterial(0x30285a, { emissiveEdge: 0.06 }));
        g.add(box);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.5), glowMaterial(0xffffff, 2.5));
        glow.position.y = 1.02; g.add(glow);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 40, 8, 1, true).translate(0, 20, 0), hologramMaterial(0xff2bd6, { opacity: 0.5 }));
        g.add(beam);
        g.userData.prism = glow;
      } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.7).translate(0, 1, 0), propMaterial(0x2a2a40));
        g.add(box);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.2), hologramMaterial(0x4dff88, { opacity: 0.9, pattern: 3 }));
        screen.position.set(0, 1.15, 0.36); g.add(screen);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.05), glowMaterial(0x4dff88, 3)); cross.position.set(0, 2.2, 0); g.add(cross);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.05), glowMaterial(0x4dff88, 3)); cross2.position.set(0, 2.2, 0); g.add(cross2);
        g.userData.lit = [screen, cross, cross2];
      }
      this.scene.add(g); this.others.set(v.id, g); o = g;
    }
    o.position.set(v.x, 0, v.y);
    if (v.sub === 0) { o.children[0].rotation.y = this.time * 3; o.children[1].rotation.y = -this.time * 2; o.position.y = Math.sin(this.time * 3 + v.id) * 0.12; }
    if (v.sub === 1 && o.userData.prism) { const c = new THREE.Color().setHSL((this.time * 0.3) % 1, 1, 0.6); ((o.userData.prism as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uColor.value.copy(c).multiplyScalar(2.5); }
    if (v.sub === 2) { const used = (v.flags & 1) !== 0; for (const l of o.userData.lit as THREE.Object3D[]) l.visible = !used; }
  }

  private updateZone() {
    const m = this.game.match;
    if (!m || m.zr <= 0 || this.game.mode === 'practice') { this.zoneWall.visible = false; G.uZone.value.set(0, 0, 999, 0); G.uNext.value.set(0, 0, 0, 0); return; }
    this.zoneWall.visible = true;
    this.zoneWall.position.set(m.zx, 0, m.zy);
    this.zoneWall.scale.set(Math.max(0.1, m.zr), 14, Math.max(0.1, m.zr));
    G.uZone.value.set(m.zx, m.zy, m.zr, m.dps);
    G.uNext.value.set(m.nx, m.ny, m.nr, m.showNext);
  }

  private dropMarker: THREE.Mesh | null = null;
  /** 낙하 지점 비콘: 하늘까지 닿는 빛 기둥 + 큰 고리 + 위아래로 움직이는 화살표 */
  private dropBeacon: THREE.Group | null = null;
  private buildDropBeacon(): THREE.Group {
    const g = new THREE.Group();
    const beamMat = glowMaterial(0xffe14d, 1.6, { additive: true, opacity: 0.35 });
    beamMat.depthWrite = false; beamMat.transparent = true; beamMat.side = THREE.DoubleSide;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 12, 20, 1, true), beamMat);
    beam.position.y = 6; g.add(beam);
    const coreMat = glowMaterial(0xffffff, 1.8, { additive: true, opacity: 0.6 });
    coreMat.depthWrite = false; coreMat.transparent = true;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 12, 8, 1, true), coreMat);
    core.position.y = 6; g.add(core);
    const ringMat = glowMaterial(0xffe14d, 2.6, { additive: true });
    ringMat.depthWrite = false; ringMat.transparent = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.16, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; ring.name = 'ring'; g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.1, 8, 40), ringMat);
    ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.15; ring2.name = 'ring2'; g.add(ring2);
    const arrowMat = glowMaterial(0xff6bf1, 2.6, { additive: true });
    arrowMat.depthWrite = false; arrowMat.transparent = true;
    const arrows = new THREE.Group(); arrows.name = 'arrows';
    for (let i = 0; i < 4; i++) {
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 4), arrowMat);
      const ang = (i / 4) * Math.PI * 2;
      a.position.set(Math.cos(ang) * 4.2, 1.2, Math.sin(ang) * 4.2);
      a.rotation.z = Math.PI; // 아래를 가리킨다
      arrows.add(a);
    }
    g.add(arrows);
    // 건물·수송 드론에 가려지지 않게 항상 맨 위에 그린다
    g.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { (mesh.material as THREE.Material).depthTest = false; mesh.renderOrder = 999; } });
    return g;
  }

  /** 낙하 지점 표시 */
  setDropMarker(x: number | null, y: number | null) {
    if (x === null || y === null) {
      if (this.dropMarker) { this.decals.release(this.dropMarker); this.dropMarker = null; }
      if (this.dropBeacon) this.dropBeacon.visible = false;
      return;
    }
    if (!this.dropMarker) this.dropMarker = this.decals.get(0);
    const mat = this.dropMarker.material as THREE.ShaderMaterial;
    mat.uniforms.uKind.value = 5; mat.uniforms.uColor.value.copy(CYAN); mat.uniforms.uAlpha.value = 1; mat.uniforms.uProgress.value = 0;
    this.decals.place(this.dropMarker, 0, x, y, { r: 2.6 + Math.sin(this.time * 6) * 0.3, y: 0.08 });
    if (!this.dropBeacon) { this.dropBeacon = this.buildDropBeacon(); this.scene.add(this.dropBeacon); }
    const b = this.dropBeacon;
    b.visible = true;
    b.position.set(x, 0, y);
    const t = this.time;
    const ring = b.getObjectByName('ring')!, ring2 = b.getObjectByName('ring2')!, arrows = b.getObjectByName('arrows')!;
    const pulse = 1 + Math.sin(t * 5) * 0.12;
    ring.scale.setScalar(pulse); ring2.scale.setScalar(2 - pulse);
    arrows.rotation.y = t * 1.5;
    arrows.position.y = Math.abs(Math.sin(t * 4)) * 1.2;
  }

  setAim(slot: number, def: SkillDef | null, ax: number, ay: number) {
    const me = this.game.view.get(this.game.you);
    if (!def || !me || slot < 0) { if (this.indicator) { this.decals.release(this.indicator); this.indicator = null; } if (this.indicator2) { this.decals.release(this.indicator2); this.indicator2 = null; } return; }
    const ind = def.indicator;
    const shape = ind.shape === 'line' ? 2 : ind.shape === 'cone' ? 1 : 0;
    if (!this.indicator || (this.indicator.userData.shape !== shape)) {
      if (this.indicator) this.decals.release(this.indicator);
      this.indicator = this.decals.get(shape as 0 | 1 | 2);
      this.indicator.userData.shape = shape;
    }
    const mat = this.indicator.material as THREE.ShaderMaterial;
    mat.uniforms.uKind.value = 5; mat.uniforms.uColor.value.copy(CYAN); mat.uniforms.uAlpha.value = 0.75; mat.uniforms.uProgress.value = 0;
    const dx = ax - me.x, dy = ay - me.y, d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    if (ind.shape === 'line') {
      const back = def.actions[0].t === 'dash' && (def.actions[0] as { backward?: boolean }).backward;
      this.decals.place(this.indicator, 2, me.x, me.y, { ang: back ? ang + Math.PI : ang, len: def.range, w: ind.width });
    } else if (ind.shape === 'cone') this.decals.place(this.indicator, 1, me.x, me.y, { r: def.range, ang, spread: (ind.angle * Math.PI) / 180 });
    else if (ind.shape === 'self') this.decals.place(this.indicator, 0, me.x, me.y, { r: ind.radius });
    else {
      const r = Math.min(def.range, d);
      this.decals.place(this.indicator, 0, me.x + (d > 0 ? dx / d : 0) * r, me.y + (d > 0 ? dy / d : 0) * r, { r: ind.radius });
      // 사거리 원
      if (!this.indicator2) this.indicator2 = this.decals.get(0);
      const m2 = this.indicator2.material as THREE.ShaderMaterial;
      m2.uniforms.uKind.value = 5; m2.uniforms.uColor.value.copy(CYAN); m2.uniforms.uAlpha.value = 0.25;
      this.decals.place(this.indicator2, 0, me.x, me.y, { r: def.range });
      return;
    }
    if (this.indicator2) { this.decals.release(this.indicator2); this.indicator2 = null; }
  }

  // ───────────────── 이벤트 → 연출 ─────────────────
  private onEvent(e: SimEvent) {
    const g = this.game;
    const myView = g.viewId();
    const me = g.you;
    const hv = this.heroes.get(e.a);
    switch (e.k) {
      case Fx.Dmg: {
        const isHero = e.a <= 10;
        const big = (e.f & 1) !== 0;
        const shieldOnly = (e.f & 2) !== 0, dot = (e.f & 4) !== 0, zone = (e.f & 8) !== 0;
        if (hv) { if (zone || dot) hv.flash = Math.max(hv.flash, 0.25); else { hv.flash = 1; hv.hurtT = 0.2; } }
        const col = isHero ? this.heroColor(e.b).c1 : ORANGE;
        if (!dot && !zone) { this.particles.burst(e.x, 1.1, e.y, big ? 18 : 7, shieldOnly ? CYAN : col, big ? 7 : 4, 0.22, 0.4, 6, 0.8); audio.play(big ? 'hitBig' : 'hit', e.x, e.y); }
        if (e.b === me || e.b === myView) {
          if (settings.dmgNumbers) this.hooks.dmgNumber(e.x, e.y, 2.2, e.p, big ? 'big' : dot ? 'dot' : 'dealt');
          if (big) { this.hooks.hitstop(60); this.hooks.shake(0.25); }
        }
        if (isHero && (e.a === me || (e.a === myView && g.selfState === 3))) {
          if (settings.dmgNumbers) this.hooks.dmgNumber(e.x, e.y, 2.6, e.p, shieldOnly ? 'shield' : zone ? 'zone' : 'taken');
          if (e.a === me) { if (zone || dot) this.hooks.hurt(0); else { this.hooks.hurt(e.p); this.hooks.shake(Math.min(0.5, 0.08 + e.p / 400)); audio.play('hurt'); } }
        }
        break;
      }
      case Fx.Heal: if (e.a === me && settings.dmgNumbers && e.p >= 15) this.hooks.dmgNumber(e.x, e.y, 2.4, e.p, 'heal'); if (e.a === me) this.particles.burst(e.x, 1, e.y, 10, new THREE.Color(0.3, 1, 0.5), 2, 0.25, 0.7, -2, 0.2); break;
      case Fx.Shield: this.trans.shockwave(e.x, e.y, 1.4, CYAN, 0.35); audio.play('shield', e.x, e.y); break;
      case Fx.Death: {
        if (e.f === 1) { this.voxels.burst(e.x, e.y, RED, ORANGE, 0); this.particles.burst(e.x, 1.5, e.y, 25, RED, 7, 0.3, 0.6, 5); audio.play('explode', e.x, e.y, 0.7); break; }
        const h = this.heroes.get(e.a);
        const { c1, c2 } = this.heroColor(e.a);
        this.voxels.burst(e.x, e.y, c1, c2, e.p);
        if (e.p === 1) for (let k = 0; k < 4; k++) this.particles.burst(e.x + (Math.random() - 0.5) * 2, 3 + Math.random() * 2, e.y + (Math.random() - 0.5) * 2, 30, new THREE.Color().setHSL(Math.random(), 1, 0.6), 6, 0.3, 1.0, 3, 1);
        if (e.p === 3) this.trans.bolt(e.x, 25, e.y, e.x, 0, e.y, new THREE.Color(0.7, 0.8, 1), 0.4);
        if (e.p === 2) this.trans.shockwave(e.x, e.y, 3, new THREE.Color(1, 0.1, 0.6), 0.6, 4);
        this.trans.flash(e.x, 1, e.y, 4, c1, 0.4, this.camera);
        if (h) { h.rig.root.visible = false; }
        audio.play('death', e.x, e.y);
        if (e.b === me) { audio.play('kill'); this.hooks.shake(0.3); this.hooks.hitstop(90); }
        break;
      }
      case Fx.Cast: {
        audio.skill(e.p, e.b, e.x, e.y);
        if (e.b > 0) { const { c1 } = this.heroColor(e.a); this.particles.burst(e.x, 1.2, e.y, 8, c1, 3, 0.25, 0.4, 0, 1); }
        break;
      }
      case Fx.Explode: {
        const vis = FX_VISUALS[e.b] ?? 'explode';
        const r = e.p / 10;
        const owner = e.a <= 10 ? this.heroColor(e.a).c1 : ORANGE;
        const col = vis === 'bomb' || vis === 'explode' ? ORANGE : vis === 'override' ? new THREE.Color(1, 0.2, 0.8) : owner;
        if (vis === 'cone' && e.f) {
          const ang = (e.f / 255) * Math.PI * 2 - Math.PI;
          for (let k = 0; k < 30; k++) { const a = ang + (Math.random() - 0.5) * 1.6, s = 6 + Math.random() * 8; this.particles.spawn(e.x, 1, e.y, Math.cos(a) * s, 0.5, Math.sin(a) * s, col, 0.35, 0.4, 0, 3); }
        } else {
          this.trans.shockwave(e.x, e.y, r, col, e.f === 1 ? 0.6 : 0.45);
          this.particles.ring(e.x, e.y, r * 0.6, Math.min(48, 10 + r * 6), col, r * 3);
          this.particles.burst(e.x, 0.6, e.y, Math.min(40, 8 + r * 5), col, r * 2.5, 0.35, 0.6, 4, 1);
          this.trans.flash(e.x, 1, e.y, r * 2.2, col, 0.25, this.camera);
        }
        if (vis === 'hammer' || vis === 'slam') { const myP = g.view.get(me); const d = myP ? Math.hypot(myP.x - e.x, myP.y - e.y) : 99; this.hooks.shake(Math.max(0, 0.45 - d * 0.03)); }
        if (vis === 'bomb' || vis === 'explode' || vis === 'hammer' || vis === 'slam') audio.play('explode', e.x, e.y, vis === 'bomb' ? 0.6 : 1);
        break;
      }
      case Fx.Blink: {
        const { c1 } = this.heroColor(e.a);
        const to = g.view.get(e.a);
        if (to) {
          const n = 14;
          for (let k = 0; k <= n; k++) { const t = k / n; this.particles.spawn(e.x + (to.x - e.x) * t, 1, e.y + (to.y - e.y) * t, 0, 0.5, 0, c1, 0.45, 0.45); }
        }
        this.particles.burst(e.x, 1, e.y, 14, c1, 3, 0.3, 0.4);
        audio.play('blink', e.x, e.y);
        break;
      }
      case Fx.Strike: {
        const { c1, c2 } = this.heroColor(e.a);
        const t = g.view.get(e.b);
        if (t) { this.trans.bolt(e.x, 1.2, e.y, t.x, 1.2, t.y, c1, 0.18); this.particles.burst(t.x, 1.2, t.y, 12, c2, 5, 0.25, 0.3); }
        break;
      }
      case Fx.Land: {
        const { c1, c2 } = this.heroColor(e.a);
        const k = e.b;
        this.trans.shockwave(e.x, e.y, 3.5, k === 1 ? ORANGE : k === 4 ? new THREE.Color(1, 0.3, 0.8) : c1, 0.6);
        this.particles.burst(e.x, 0.4, e.y, 30, k === 1 ? ORANGE : c1, 7, 0.35, 0.7, 6, 0.6);
        if (k === 2) this.trans.pillar(e.x, e.y, CYAN, 0.8, 20, 0.9);
        if (k === 3) this.trans.bolt(e.x, 28, e.y, e.x, 0, e.y, new THREE.Color(0.8, 0.85, 1), 0.35);
        if (k === 1 || k === 4) this.trans.pillar(e.x, e.y, k === 1 ? ORANGE : c2, 0.5, 15, 0.5);
        audio.play('land', e.x, e.y);
        if (e.a === me) this.hooks.shake(0.35);
        break;
      }
      case Fx.LevelUp: {
        const { c1 } = this.heroColor(e.a);
        this.trans.pillar(e.x, e.y, c1, 0.8, 6, 0.7);
        this.particles.ring(e.x, e.y, 0.6, 24, c1, 2, 0.3);
        if (e.a === me) { audio.play('levelup'); this.hooks.levelUp(); }
        break;
      }
      case Fx.Destroy: {
        this.mapView.setDestroyed(e.a);
        const o = g.map.obstacles[e.a];
        if (o) { this.voxels.burst(o.x, o.y, new THREE.Color(0.4, 0.38, 0.5), NEON_C[o.id % NEON_C.length], 0); this.particles.burst(o.x, 0.8, o.y, 25, new THREE.Color(0.6, 0.6, 0.7), 5, 0.3, 0.6, 6); audio.play('destroy', o.x, o.y); }
        break;
      }
      case Fx.Spark: this.particles.burst(e.x, 1.1, e.y, e.b === 3 ? 20 : 6, e.b === 3 ? new THREE.Color(1, 0.9, 0.3) : new THREE.Color(1, 0.85, 0.6), 5, 0.18, 0.25, 8, 0.6); break;
      case Fx.Bolt: {
        const from = g.view.get(e.a);
        this.trans.bolt(from ? from.x : e.x, 1.5, from ? from.y : e.y, e.x, 1.0, e.y, new THREE.Color(0.6, 0.8, 1), 0.2);
        audio.play('bolt', e.x, e.y);
        break;
      }
      case Fx.Pickup: {
        if (e.b === 0) { this.particles.burst(e.x, 0.7, e.y, 10, CYAN, 3, 0.25, 0.35, 0, 1); if (e.a === me) audio.play('pickup'); }
        else if (e.b === 1) { this.particles.burst(e.x, 1, e.y, 25, new THREE.Color(0.3, 1, 0.5), 3, 0.3, 0.8, -2, 0.3); audio.play('heal', e.x, e.y); }
        else { this.trans.pillar(e.x, e.y, new THREE.Color(1, 0.3, 0.9), 1.0, 20, 1.2); audio.play('aug_prism', e.x, e.y); }
        break;
      }
      case Fx.Supply: this.trans.pillar(e.x, e.y, new THREE.Color(1, 0.3, 0.9), 1.5, 40, 1.4); this.trans.shockwave(e.x, e.y, 5, new THREE.Color(1, 0.3, 0.9), 0.8); this.particles.burst(e.x, 0.5, e.y, 50, new THREE.Color(1, 0.4, 0.9), 9, 0.4, 0.8, 6); audio.play('supplyLand', e.x, e.y); break;
      case Fx.Dodge: { const { c1 } = this.heroColor(e.a); this.particles.burst(e.x, 0.3, e.y, 10, c1, 2.5, 0.3, 0.35, 0, 0.3); audio.play('dodge', e.x, e.y, e.a === me ? 1 : 0.6); break; }
      case Fx.ProjHit: { const c = this.projColor(e.b); this.particles.burst(e.x, 1, e.y, 8, c, 4, 0.22, 0.25, 4, 0.5); break; }
      case Fx.Grab: { this.trans.shockwave(e.x, e.y, 1.8, ORANGE, 0.3); audio.play('grab', e.x, e.y); if (e.a === me || e.b === me) this.hooks.shake(0.3); break; }
      case Fx.Emote: { audio.play('emote', e.x, e.y); this.hooks.onEmote(e.a, e.b); break; }
      case Fx.Teleport: { this.particles.burst(e.x, 1, e.y, 20, new THREE.Color(0.6, 0.35, 1), 3, 0.3, 0.5); audio.play('teleport', e.x, e.y); break; }
      case Fx.Stealth: { const { c1 } = this.heroColor(e.a); this.particles.burst(e.x, 1, e.y, 16, c1, 2, 0.3, 0.5, 0, 1); if (e.b === 1) audio.play('stealth', e.x, e.y); break; }
      case Fx.Pad: { this.particles.burst(e.x, 0.3, e.y, 20, CYAN, 4, 0.3, 0.5, 0, 2); audio.play('pad', e.x, e.y); break; }
      case Fx.Beam: {
        const ang = (e.f / 255) * Math.PI * 2 - Math.PI;
        const col = this.heroColor(e.a).c1;
        this.trans.beam(e.x, e.y, ang, e.p / 10, 2.4, col, 0.55);
        for (let k = 0; k < 40; k++) { const t = Math.random() * (e.p / 10); this.particles.spawn(e.x + Math.cos(ang) * t, 1, e.y + Math.sin(ang) * t, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, col, 0.4, 0.5); }
        audio.play('beam', e.x, e.y);
        this.hooks.shake(0.3);
        break;
      }
      case Fx.Revive: this.trans.pillar(e.x, e.y, new THREE.Color(1, 0.85, 0.3), 1.2, 10, 1); this.particles.burst(e.x, 1, e.y, 30, new THREE.Color(1, 0.85, 0.3), 4, 0.35, 0.8); break;
      case Fx.Trap: this.trans.shockwave(e.x, e.y, 1.5, this.heroColor(e.a).c1, 0.4, 3); audio.play('trap', e.x, e.y); break;
      case Fx.Wire: {
        const from = g.view.get(e.a);
        if (from && e.b !== 2) this.trans.bolt(from.x, 1.2, from.y, e.x, 1.2, e.y, this.heroColor(e.a).c2, 0.25);
        if (e.b === 2) this.particles.burst(e.x, 1, e.y, 10, this.heroColor(e.a).c1, 2, 0.25, 0.3);
        break;
      }
    }
  }

  private projColor(visual: number) { return [ORANGE, CYAN, RED, CYAN, new THREE.Color(0.6, 0.4, 1), new THREE.Color(0.4, 0.6, 1), ORANGE, new THREE.Color(0.3, 1, 0.5), new THREE.Color(1, 0.3, 0.9), new THREE.Color(0.7, 0.4, 1), RED][visual] ?? ORANGE; }

  // ───────────────── 카메라 ─────────────────
  private updateCamera(dt: number) {
    const cam = this.camera;
    if (this.orbit) {
      this.orbitA += dt * 0.06;
      const r = 34;
      const tx = Math.cos(this.orbitA) * 6, tz = Math.sin(this.orbitA) * 6;
      cam.position.set(tx + Math.cos(this.orbitA) * r, 24, tz + Math.sin(this.orbitA) * r);
      cam.lookAt(tx, 0, tz);
      this.camX = tx; this.camZ = tz;
      return;
    }
    const f = this.focusPos();
    let tx = this.camX, tz = this.camZ;
    if (f) {
      tx = f.x; tz = f.y;
      const v = this.game.view.get(this.game.viewId());
      const isMe = this.game.viewId() === this.game.you && this.game.selfState === 2;
      if (isMe && v) {
        const lx = this.game.aimX - f.x, lz = this.game.aimY - f.y, l = Math.hypot(lx, lz);
        const k = Math.min(3, l * 0.25) / Math.max(l, 1e-3);
        tx += lx * k; tz += lz * k;
      }
      if (this.game.selfState <= 1 && this.game.viewId() === this.game.you && this.game.match?.phase === 0) { tx = this.camX; tz = this.camZ; }
    }
    const k = 1 - Math.exp(-dt * 7);
    this.camX += (tx - this.camX) * k; this.camZ += (tz - this.camZ) * k;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    this.shakeT += dt * 40;
    const sh = settings.shake ? this.shakeAmt : 0;
    const sx = (Math.sin(this.shakeT * 1.3) + Math.sin(this.shakeT * 2.7)) * sh * 0.5, sz = (Math.cos(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.1)) * sh * 0.5;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const z = this.zoom * (aspect < 0.8 ? 1.4 : aspect < 1.3 ? 1.15 : 1);
    cam.position.set(this.camX + sx, 15 * z, this.camZ + 13 * z + sz);
    cam.lookAt(this.camX + sx, 0, this.camZ + sz);
  }

  addShake(a: number) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }
  hitstop(ms: number) { this.hitstopT = Math.max(this.hitstopT, ms / 1000); }

  // ───────────────── 시야 마스크 & 반사 ─────────────────
  renderAux(r: THREE.WebGLRenderer) {
    const g = this.game;
    const id = g.viewId();
    const v = g.view.get(id);
    const showVision = !this.orbit && g.mode !== 'practice' && !!v && g.match?.phase !== 0;
    G.uVisOn.value = showVision ? 1 : 0;
    if (showVision && v) {
      const pos = this.visGeo.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      arr[0] = v.x; arr[1] = 0; arr[2] = v.y;
      const R = VIEW_RADIUS;
      for (let i = 0; i <= this.visRays; i++) {
        const a = (i / this.visRays) * Math.PI * 2;
        const ex = v.x + Math.cos(a) * R, ey = v.y + Math.sin(a) * R;
        const hit = raycast(g.map, g.alive, v.x, v.y, ex, ey, 'vision');
        const t = hit.ob ? Math.min(1, hit.t + 0.06) : 1;
        arr[(i + 1) * 3] = v.x + Math.cos(a) * R * t; arr[(i + 1) * 3 + 1] = 0; arr[(i + 1) * 3 + 2] = v.y + Math.sin(a) * R * t;
      }
      pos.needsUpdate = true;
      this.visGeo.computeBoundingSphere();
      r.setRenderTarget(this.visRT);
      r.render(this.visScene, this.visCam);
    }
    if (this.reflRT) {
      const cam = this.camera;
      const mc = this.mirrorCam;
      mc.copy(cam);
      mc.position.set(cam.position.x, -cam.position.y, cam.position.z);
      const target = new THREE.Vector3(this.camX, 0, this.camZ);
      mc.up.set(0, -1, 0);
      mc.lookAt(target);
      mc.updateMatrixWorld();
      mc.projectionMatrix.copy(cam.projectionMatrix);
      const texMat = this.mapView.groundMat.uniforms.uTexMat.value as THREE.Matrix4;
      texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      texMat.multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
      this.mapView.ground.visible = false; this.decals.group.visible = false; this.rain.mesh.visible = false; this.zoneWall.visible = false;
      r.setRenderTarget(this.reflRT);
      r.clear();
      r.render(this.scene, mc);
      this.mapView.ground.visible = true; this.decals.group.visible = true; this.rain.mesh.visible = true; this.updateZone();
    }
    r.setRenderTarget(null);
  }
}

const NEON_C = NEON.map(c => new THREE.Color(c));
export { AUGMENT_BY_ID };
