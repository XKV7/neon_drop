import * as THREE from 'three';
import { HEROES, heroPalettes, type AnimKind, type HeroDef } from '@neon/shared';
import { toonMaterial, glowMaterial } from './shaders';

export interface HeroRig {
  root: THREE.Group; body: THREE.Group; hips: THREE.Group; torso: THREE.Group; head: THREE.Group;
  armL: THREE.Group; armR: THREE.Group; foreL: THREE.Group; foreR: THREE.Group; handL: THREE.Group; handR: THREE.Group;
  legL: THREE.Group; legR: THREE.Group; shinL: THREE.Group; shinR: THREE.Group;
  spinners: THREE.Object3D[]; orbit: THREE.Object3D[]; spiderLegs: THREE.Group[]; scarf: THREE.Object3D | null;
  uniforms: { uFlash: THREE.IUniform; uOpacity: THREE.IUniform; uDissolve: THREE.IUniform; uTint: THREE.IUniform };
  materials: THREE.ShaderMaterial[];
  def: HeroDef; c1: THREE.Color; c2: THREE.Color; size: number;
}

const BOX = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function buildHero(heroIndex: number, palette = 0, skin = 0): HeroRig {
  const def = HEROES[heroIndex] ?? HEROES[0];
  const pal = heroPalettes(def.id)[palette] ?? heroPalettes(def.id)[0];
  const uniforms = { uFlash: { value: 0 }, uOpacity: { value: 1 }, uDissolve: { value: 0 }, uTint: { value: new THREE.Color(0, 0, 0) } };
  const materials: THREE.ShaderMaterial[] = [];
  const c1 = new THREE.Color(pal.c1), c2 = new THREE.Color(pal.c2);
  const mk = (color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation, es = 1) => { const m = toonMaterial({ color, emissive, emissiveStrength: es, rim: pal.c1, shared: uniforms, transparent: true }); materials.push(m); return m; };
  const glow = (color: THREE.Color, s = 2.6) => { const m = glowMaterial(color, s, { shared: uniforms }); m.transparent = true; materials.push(m); return m; };
  const bodyCol = new THREE.Color(pal.body).lerp(new THREE.Color(0x3a3a55), 0.35);
  const M = {
    body: mk(bodyCol), armor: mk(new THREE.Color(pal.body).multiplyScalar(0.6).add(new THREE.Color(0x111122))), dark: mk(0x14121e),
    metal: mk(0x8a90a6), skin: mk(0xd9ab8e), n1: glow(c1), n2: glow(c2, 2.2), white: glow(new THREE.Color(0xffffff), 1.6),
  };
  const g = () => new THREE.Group();
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };

  const root = g(), body = g(), hips = g(), torso = g(), head = g();
  const armL = g(), armR = g(), foreL = g(), foreR = g(), handL = g(), handR = g();
  const legL = g(), legR = g(), shinL = g(), shinR = g();
  root.add(body); body.add(hips); hips.add(torso); torso.add(head);
  torso.add(armL, armR); armL.add(foreL); armR.add(foreR); foreL.add(handL); foreR.add(handR);
  hips.add(legL, legR); legL.add(shinL); legR.add(shinR);

  const style = def.style;
  const heavy = style === 'heavy', slim = style === 'ninja' || style === 'spider';
  const sw = heavy ? 1.35 : slim ? 0.85 : 1.0; // 어깨 폭

  hips.position.y = 0.95;
  add(hips, BOX(0.42 * sw, 0.22, 0.26), M.dark, 0, 0, 0);
  torso.position.y = 0.12;
  add(torso, BOX(0.5 * sw, 0.5, 0.3), M.body, 0, 0.3, 0);
  add(torso, BOX(0.4 * sw, 0.06, 0.32), M.n1, 0, 0.12, 0.01); // 가슴 네온 띠
  head.position.y = 0.6;
  add(head, BOX(0.26, 0.28, 0.26), M.skin, 0, 0.15, 0);
  add(head, BOX(0.28, 0.07, 0.06), M.n1, 0, 0.17, 0.13); // 바이저

  armL.position.set(-0.3 * sw, 0.5, 0); armR.position.set(0.3 * sw, 0.5, 0);
  for (const [arm, fore, hand] of [[armL, foreL, handL], [armR, foreR, handR]] as const) {
    add(arm, BOX(0.13 * sw, 0.32, 0.13), M.body, 0, -0.16, 0);
    fore.position.y = -0.32;
    add(fore, BOX(0.12 * sw, 0.3, 0.12), M.armor, 0, -0.15, 0);
    hand.position.y = -0.3;
    add(hand, BOX(0.11, 0.11, 0.11), M.dark, 0, -0.04, 0);
  }
  legL.position.set(-0.12 * sw, -0.08, 0); legR.position.set(0.12 * sw, -0.08, 0);
  for (const [leg, shin] of [[legL, shinL], [legR, shinR]] as const) {
    add(leg, BOX(0.16, 0.44, 0.17), M.armor, 0, -0.22, 0);
    shin.position.y = -0.44;
    add(shin, BOX(0.14, 0.42, 0.15), M.dark, 0, -0.21, 0);
    add(shin, BOX(0.16, 0.08, 0.26), M.armor, 0, -0.42, 0.04);
    add(shin, BOX(0.15, 0.03, 0.03), M.n2, 0, -0.18, 0.08);
  }

  const spinners: THREE.Object3D[] = [], orbit: THREE.Object3D[] = [], spiderLegs: THREE.Group[] = [];
  let scarf: THREE.Object3D | null = null;

  switch (style) {
    case 'heavy': { // 해머독: 거대한 유압 주먹
      for (const hand of [handL, handR]) {
        add(hand, BOX(0.34, 0.34, 0.34), M.metal, 0, -0.12, 0);
        add(hand, BOX(0.36, 0.06, 0.36), M.n1, 0, -0.02, 0);
        add(hand.parent!, new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), M.n2, 0.09, -0.15, -0.08);
      }
      add(armL, BOX(0.32, 0.18, 0.32), M.armor, 0, 0.02, 0); add(armR, BOX(0.32, 0.18, 0.32), M.armor, 0, 0.02, 0);
      add(torso, BOX(0.62, 0.26, 0.36), M.armor, 0, 0.42, 0);
      if (skin === 0) { add(head, BOX(0.32, 0.12, 0.32), M.armor, 0, 0.3, 0); }
      else if (skin === 1) { add(head, BOX(0.36, 0.26, 0.36), M.armor, 0, 0.22, 0); add(head, BOX(0.3, 0.05, 0.05), M.n2, 0, 0.18, 0.18); add(armL, BOX(0.42, 0.3, 0.1), M.metal, -0.1, -0.1, 0.12); }
      else { add(head, BOX(0.34, 0.06, 0.4), M.dark, 0, 0.3, 0.04); add(head, BOX(0.24, 0.06, 0.08), M.n1, 0, 0.36, 0); add(head, BOX(0.06, 0.06, 0.08), M.n2, 0.1, 0.36, 0); }
      break;
    }
    case 'biker': { // 레드라인: 체인소 팔
      const saw = new THREE.Group(); saw.position.set(0, -0.15, 0.25); handR.add(saw);
      add(saw, BOX(0.1, 0.16, 0.7), M.metal, 0, 0, 0.1);
      add(saw, BOX(0.03, 0.2, 0.72), M.n1, 0, 0, 0.1);
      const disc = add(saw, new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), M.n2, 0.07, 0, -0.15, 0, 0, Math.PI / 2);
      spinners.push(disc);
      add(torso, BOX(0.55, 0.45, 0.06), M.dark, 0, 0.3, -0.17); // 재킷 등판
      add(torso, BOX(0.3, 0.3, 0.02), M.n2, 0, 0.32, -0.21);
      if (skin === 0) for (let i = 0; i < 5; i++) add(head, BOX(0.05, 0.14 - Math.abs(i - 2) * 0.02, 0.05), M.n1, 0, 0.36, -0.1 + i * 0.06);
      else if (skin === 1) { add(head, new THREE.SphereGeometry(0.2, 8, 6), M.armor, 0, 0.17, 0); add(head, BOX(0.3, 0.09, 0.05), M.n2, 0, 0.17, 0.17); }
      else { add(head, BOX(0.3, 0.3, 0.3), M.white, 0, 0.16, 0.01); add(head, BOX(0.06, 0.06, 0.02), M.dark, -0.06, 0.2, 0.16); add(head, BOX(0.06, 0.06, 0.02), M.dark, 0.06, 0.2, 0.16); add(head, new THREE.ConeGeometry(0.05, 0.22, 4), M.n1, 0.14, 0.38, 0, 0, 0, -0.5); add(head, new THREE.ConeGeometry(0.05, 0.22, 4), M.n1, -0.14, 0.38, 0, 0, 0, 0.5); }
      break;
    }
    case 'ninja': { // 미라주: 쌍검, 스카프
      for (const hand of [handL, handR]) { add(hand, BOX(0.03, 0.06, 0.75), M.n1, 0, -0.06, 0.35); add(hand, BOX(0.08, 0.08, 0.08), M.metal, 0, -0.06, 0); }
      scarf = add(torso, BOX(0.12, 0.04, 0.7), M.n2, 0.08, 0.5, -0.4, -0.3);
      add(head, BOX(0.29, 0.29, 0.29), M.dark, 0, 0.15, -0.01);
      add(head, BOX(0.3, 0.04, 0.05), M.n1, 0, 0.18, 0.14);
      if (skin === 1) { add(head, new THREE.ConeGeometry(0.07, 0.18, 4), M.n2, -0.09, 0.36, 0); add(head, new THREE.ConeGeometry(0.07, 0.18, 4), M.n2, 0.09, 0.36, 0); add(head, BOX(0.18, 0.1, 0.12), M.white, 0, 0.12, 0.16); }
      else if (skin === 2) { add(head, BOX(0.4, 0.06, 0.4), M.armor, 0, 0.3, 0); add(head, BOX(0.04, 0.22, 0.04), M.n2, 0, 0.42, 0.12, 0.3); }
      break;
    }
    case 'spider': { // 실크: 등의 나노와이어 다리 6개
      const back = new THREE.Group(); back.position.set(0, 0.4, -0.18); torso.add(back);
      add(back, skin === 1 ? new THREE.SphereGeometry(0.26, 8, 6) : BOX(0.3, 0.3, 0.2), M.armor, 0, 0, -0.05);
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? -1 : 1, k = i % 3;
        const leg = new THREE.Group(); leg.position.set(side * 0.12, 0.05 - k * 0.08, 0); back.add(leg);
        leg.rotation.set(0.3 - k * 0.4, side * (0.9 + k * 0.25), side * 0.6);
        add(leg, BOX(0.04, 0.04, 0.55), skin === 2 ? M.metal : M.dark, 0, 0, -0.27);
        const tip = new THREE.Group(); tip.position.set(0, 0, -0.55); leg.add(tip); tip.rotation.x = 1.1;
        add(tip, BOX(0.03, 0.03, 0.5), M.n1, 0, 0, -0.25);
        if (skin === 2) add(tip, new THREE.ConeGeometry(0.04, 0.15, 4), M.n2, 0, 0, -0.55, -Math.PI / 2);
        spiderLegs.push(leg);
      }
      if (skin === 1) { for (let i = 0; i < 3; i++) add(head, new THREE.ConeGeometry(0.03, 0.12, 4), M.n2, -0.08 + i * 0.08, 0.35, 0); }
      add(head, BOX(0.04, 0.04, 0.02), M.n2, -0.06, 0.12, 0.14); add(head, BOX(0.04, 0.04, 0.02), M.n2, 0.06, 0.12, 0.14);
      break;
    }
    case 'sniper': { // 레일: 긴 레일건, 코트
      const gun = new THREE.Group(); gun.position.set(0, -0.08, 0.1); handR.add(gun);
      add(gun, BOX(0.08, 0.12, 1.25), M.metal, 0, 0, 0.45);
      add(gun, BOX(0.03, 0.03, 1.3), M.n1, 0, 0.07, 0.45);
      add(gun, new THREE.CylinderGeometry(0.05, 0.05, 0.26, 6), M.dark, 0, 0.13, 0.25, Math.PI / 2);
      add(hips, new THREE.CylinderGeometry(0.24, 0.36, 0.7, 6, 1, true), M.body, 0, -0.32, 0);
      if (skin === 1) add(head, new THREE.ConeGeometry(0.24, 0.42, 6), M.body, 0, 0.32, -0.04);
      else if (skin === 2) { add(torso, BOX(0.2, 0.2, 0.7), M.metal, -0.36, 0.55, 0); add(torso, BOX(0.06, 0.06, 0.72), M.n2, -0.36, 0.67, 0); }
      else add(head, BOX(0.3, 0.08, 0.3), M.body, 0, 0.3, 0);
      break;
    }
    case 'pilot': { // 하이브: 백팩 + 미니 드론
      add(torso, BOX(0.42, 0.42, 0.22), M.armor, 0, 0.32, -0.25);
      add(torso, new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), M.n1, 0.15, 0.7, -0.28);
      add(torso, new THREE.CylinderGeometry(0.015, 0.015, 0.35, 4), M.n2, -0.12, 0.62, -0.28);
      add(handR, BOX(0.08, 0.14, 0.3), M.metal, 0, -0.08, 0.12);
      const drone = new THREE.Group(); root.add(drone);
      add(drone, new THREE.OctahedronGeometry(0.15, 0), M.metal);
      add(drone, new THREE.TorusGeometry(0.2, 0.02, 4, 12), M.n1, 0, 0, 0, Math.PI / 2);
      orbit.push(drone);
      if (skin === 1) { add(head, BOX(0.11, 0.11, 0.06), M.n2, -0.07, 0.17, 0.15); add(head, BOX(0.11, 0.11, 0.06), M.n2, 0.07, 0.17, 0.15); }
      else if (skin === 2) { add(torso, BOX(1.1, 0.04, 0.28), M.armor, 0, 0.55, -0.32); add(torso, BOX(1.1, 0.02, 0.04), M.n2, 0, 0.58, -0.3); }
      else add(head, BOX(0.3, 0.06, 0.3), M.armor, 0, 0.3, 0);
      break;
    }
    case 'hacker': { // 글리치: 후드 + 홀로 스크린
      add(head, BOX(0.34, 0.34, 0.32), M.body, 0, 0.17, -0.03);
      add(head, BOX(0.22, 0.16, 0.04), M.dark, 0, 0.13, 0.13);
      add(head, BOX(0.16, 0.03, 0.02), M.n1, 0, 0.13, 0.155);
      for (let i = 0; i < 3; i++) {
        const sc = new THREE.Group(); root.add(sc);
        add(sc, BOX(0.36, 0.22, 0.01), M.n2, 0, 0, 0);
        sc.userData.phase = (i / 3) * Math.PI * 2;
        orbit.push(sc);
      }
      if (skin === 1) { add(head, new THREE.TorusGeometry(0.19, 0.025, 4, 12, Math.PI), M.n1, 0, 0.22, 0); add(head, new THREE.ConeGeometry(0.06, 0.12, 3), M.n2, -0.1, 0.38, 0); add(head, new THREE.ConeGeometry(0.06, 0.12, 3), M.n2, 0.1, 0.38, 0); }
      else if (skin === 2) for (let i = 0; i < 5; i++) add(head, new THREE.ConeGeometry(0.04, 0.2, 3), M.n1, -0.14 + i * 0.07, 0.4, 0, 0, 0, (i - 2) * 0.25);
      break;
    }
    case 'scientist': { // 호라이즌: 연구 가운 + 중력 링
      add(hips, new THREE.CylinderGeometry(0.25, 0.38, 0.65, 6, 1, true), M.white, 0, -0.3, 0);
      add(torso, BOX(0.52, 0.5, 0.32), M.white, 0, 0.3, -0.005);
      add(head, BOX(0.22, 0.05, 0.03), M.n2, 0, 0.17, 0.14);
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55 + i * 0.12, 0.02, 4, 24), M.n1);
        ring.position.y = 1.0; ring.userData.tilt = i ? 1.2 : 0.5;
        root.add(ring); orbit.push(ring);
      }
      if (skin === 1) add(head, new THREE.SphereGeometry(0.26, 10, 8), glow(c2, 0.6), 0, 0.16, 0);
      else if (skin === 2) { const orb = add(torso, new THREE.SphereGeometry(0.14, 8, 6), M.dark, 0, 1.05, 0); spinners.push(orb); add(torso, new THREE.TorusGeometry(0.22, 0.015, 4, 16), M.n2, 0, 1.05, 0, Math.PI / 2); }
      break;
    }
  }

  // 발밑 네온 링 (팀 식별용 색)
  const foot = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 24), glow(c1, 1.5));
  foot.rotation.x = -Math.PI / 2; foot.position.y = 0.03;
  root.add(foot);

  const size = def.size;
  body.scale.setScalar(size);
  return { root, body, hips, torso, head, armL, armR, foreL, foreR, handL, handR, legL, legR, shinL, shinR, spinners, orbit, spiderLegs, scarf, uniforms, materials, def, c1, c2, size };
}

export interface AnimState {
  speed: number; // 이동 속도 (m/s)
  facing: number;
  action: AnimKind | null; actionT: number; // 초
  charging: boolean; stunned: boolean; rolling: number; // 0..1
  air: number; // 높이
  emote: number; emoteT: number;
  hurtT: number;
  cast: boolean;
}

const ACTION_DUR: Record<AnimKind, number> = { punch: 0.3, slash: 0.3, shoot: 0.22, cast: 0.45, slam: 0.5, spin: 0.7, throw: 0.35, dash: 0.4, charge: 0.4, leap: 0.5 };

export class HeroAnimator {
  rig: HeroRig;
  phase = 0;
  t = 0;
  constructor(rig: HeroRig) { this.rig = rig; }

  update(dt: number, s: AnimState) {
    const r = this.rig;
    this.t += dt;
    r.root.rotation.y = Math.PI / 2 - s.facing;
    const runK = Math.min(1, s.speed / 5.5);
    this.phase += dt * (4 + s.speed * 1.6);
    const ph = this.phase;
    const sw = Math.sin(ph) * 0.85 * runK;
    // 기본 자세 초기화
    r.body.position.set(0, s.air + Math.abs(Math.sin(ph)) * 0.06 * runK + Math.sin(this.t * 2) * 0.01, 0);
    r.body.rotation.set(0.12 * runK, 0, 0);
    r.torso.rotation.set(0, Math.sin(ph) * 0.12 * runK, 0);
    r.head.rotation.set(0, 0, 0);
    r.legL.rotation.set(sw, 0, 0); r.legR.rotation.set(-sw, 0, 0);
    r.shinL.rotation.set(Math.max(0, -Math.sin(ph + 1)) * 1.1 * runK, 0, 0); r.shinR.rotation.set(Math.max(0, Math.sin(ph + 1)) * 1.1 * runK, 0, 0);
    r.armL.rotation.set(-sw * 0.7, 0, 0.12); r.armR.rotation.set(sw * 0.7, 0, -0.12);
    r.foreL.rotation.set(-0.4 - 0.3 * runK, 0, 0); r.foreR.rotation.set(-0.4 - 0.3 * runK, 0, 0);
    // 무기 들기 기본 자세
    const style = r.def.style;
    if (style === 'sniper' || style === 'pilot') { r.armR.rotation.x = -1.1 + sw * 0.15; r.foreR.rotation.x = -0.3; r.armL.rotation.x = -0.9; r.armL.rotation.z = 0.5; r.foreL.rotation.x = -0.7; }
    if (style === 'ninja') { r.armL.rotation.x += -0.3; r.armR.rotation.x += -0.3; }

    // 동작
    if (s.action) {
      const dur = ACTION_DUR[s.action];
      const p = Math.min(1, s.actionT / dur);
      const e = Math.sin(p * Math.PI);
      switch (s.action) {
        case 'punch': r.armR.rotation.set(-1.6 * e - 0.2, 0, -0.1); r.foreR.rotation.set(-0.2 * (1 - e), 0, 0); r.torso.rotation.y = -0.5 * e; r.body.rotation.x += 0.15 * e; break;
        case 'slash': r.armR.rotation.set(-1.4, 0, -1.2 + 2.4 * p); r.foreR.rotation.set(-0.3, 0, 0); r.torso.rotation.y = 0.8 - 1.6 * p; if (style === 'ninja') { r.armL.rotation.set(-1.4, 0, 1.2 - 2.4 * p); } break;
        case 'shoot': r.armR.rotation.x = -1.5 + 0.25 * e; r.armL.rotation.x = -1.3; r.foreR.rotation.x = 0; r.body.rotation.x -= 0.08 * e; break;
        case 'cast': r.armL.rotation.set(-2.2 * e, 0, 0.3); r.armR.rotation.set(-2.2 * e, 0, -0.3); r.head.rotation.x = -0.3 * e; break;
        case 'slam': {
          const up = p < 0.55 ? p / 0.55 : 1 - (p - 0.55) / 0.45;
          r.armL.rotation.set(-3.0 * up, 0, 0.2); r.armR.rotation.set(-3.0 * up, 0, -0.2);
          r.body.position.y -= p > 0.55 ? 0.25 * (1 - up) : 0; r.body.rotation.x += p > 0.55 ? 0.5 * (1 - up) : -0.2 * up; break;
        }
        case 'spin': r.body.rotation.y = p * Math.PI * 4; r.armR.rotation.set(-1.5, 0, -0.2); r.armL.rotation.set(-1.5, 0, 0.2); break;
        case 'throw': r.armR.rotation.set(-2.8 + 3.2 * p, 0, -0.1); r.torso.rotation.y = -0.6 * e; break;
        case 'dash': r.body.rotation.x += 0.6 * e; r.armL.rotation.x = 0.9 * e; r.armR.rotation.x = style === 'heavy' ? -1.6 * e : 0.9 * e; break;
        case 'charge': r.armR.rotation.x = -1.55; r.armL.rotation.x = -1.4; r.foreR.rotation.x = 0; break;
        case 'leap': r.legL.rotation.x = -1.0 * e; r.legR.rotation.x = -1.0 * e; r.shinL.rotation.x = 1.6 * e; r.shinR.rotation.x = 1.6 * e; r.armL.rotation.x = -2 * e; r.armR.rotation.x = -2 * e; break;
      }
    }
    if (s.charging) { r.armR.rotation.x = -1.55; r.armL.rotation.x = -1.4; r.body.position.x = Math.sin(this.t * 60) * 0.01; }
    if (s.cast && !s.action) { r.armL.rotation.x -= 0.6; r.armR.rotation.x -= 0.6; }
    if (s.rolling > 0) { r.body.rotation.x = s.rolling * Math.PI * 2; r.body.position.y = 0.2 + s.air; r.legL.rotation.x = -1.2; r.legR.rotation.x = -1.2; r.shinL.rotation.x = 1.8; r.shinR.rotation.x = 1.8; }
    if (s.air > 0.2 && s.rolling <= 0) { r.legL.rotation.x = -0.6; r.legR.rotation.x = 0.3; r.shinL.rotation.x = 1.2; r.shinR.rotation.x = 0.6; r.armL.rotation.z = 0.8; r.armR.rotation.z = -0.8; }
    if (s.stunned) { r.head.rotation.z = Math.sin(this.t * 10) * 0.3; r.body.rotation.z = Math.sin(this.t * 7) * 0.12; }
    if (s.hurtT > 0) { const k = s.hurtT / 0.2; r.body.rotation.x -= 0.35 * k; r.head.rotation.x -= 0.3 * k; }
    if (s.emote >= 0 && s.emoteT < 2) {
      const t = s.emoteT;
      switch (s.emote % 6) {
        case 0: r.armR.rotation.set(-2.8, 0, -0.3 + Math.sin(t * 12) * 0.4); break; // 손 흔들기
        case 1: r.armR.rotation.set(-1.5, 0, 0); r.armL.rotation.set(0, 0, 0.4); r.torso.rotation.y = 0.4; r.foreR.rotation.x = -1.4 + Math.sin(t * 10) * 0.3; break; // 도발
        case 2: r.body.rotation.z = Math.sin(t * 8) * 0.25; r.armL.rotation.set(-2.5, 0, Math.sin(t * 8)); r.armR.rotation.set(-2.5, 0, -Math.sin(t * 8)); r.body.position.y += Math.abs(Math.sin(t * 8)) * 0.15; break; // 춤
        case 3: { const c = Math.abs(Math.sin(t * 14)); r.armL.rotation.set(-1.3, 0.6 * c, 0.2); r.armR.rotation.set(-1.3, -0.6 * c, -0.2); break; } // 박수
        case 4: r.armL.rotation.set(-0.5, 0, 0.8); r.armR.rotation.set(-0.5, 0, -0.8); r.body.position.y += Math.abs(Math.sin(t * 16)) * 0.1; break; // 분노
        case 5: r.armL.rotation.set(-2.6, 0, 0.6); r.armR.rotation.set(-2.6, 0, -0.6); r.foreL.rotation.x = -1.2; r.foreR.rotation.x = -1.2; break; // 하트
      }
    }
    // 부속 애니메이션
    for (const sp of r.spinners) sp.rotation.y += dt * 25;
    r.orbit.forEach((o, i) => {
      const a = this.t * (1.5 + i * 0.3) + (o.userData.phase ?? i * 2);
      if (r.def.style === 'scientist') { o.rotation.set(o.userData.tilt + Math.sin(this.t + i) * 0.2, this.t * (1 + i), 0); o.position.y = 1.0 + s.air; }
      else if (r.def.style === 'hacker') { o.position.set(Math.cos(a) * 0.75, 1.3 + s.air + Math.sin(a * 2) * 0.08, Math.sin(a) * 0.75); o.lookAt(o.position.x * 3, o.position.y, o.position.z * 3); }
      else { o.position.set(Math.cos(a) * 0.8, 1.9 + s.air + Math.sin(this.t * 3) * 0.1, Math.sin(a) * 0.8); o.rotation.y = this.t * 3; }
    });
    r.spiderLegs.forEach((l, i) => { l.rotation.x = (0.3 - (i % 3) * 0.4) + Math.sin(this.t * (3 + runK * 8) + i) * (0.12 + runK * 0.25); });
    if (r.scarf) r.scarf.rotation.x = -0.3 - runK * 0.6 + Math.sin(this.t * 9) * 0.1;
  }
}

export function actionDuration(a: AnimKind) { return ACTION_DUR[a]; }
