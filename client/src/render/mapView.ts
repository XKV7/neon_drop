import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type MapData, type Obstacle, districtAt, Rng } from '@neon/shared';
import { buildingMaterial, propMaterial, glowMaterial, hologramMaterial, groundMaterial, G } from './shaders';

export const NEON = [0xff2bd6, 0x22f3ff, 0x9b5cff, 0xffe14d, 0x4dff88, 0xff7a1a];
const DISTRICT_TINT = ['#7a3cff', '#ff2bd6', '#2a7bff', '#ff7a1a', '#33ff99'];

interface InstRef { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }

export class MapView {
  group = new THREE.Group();
  ground: THREE.Mesh;
  groundMat: THREE.ShaderMaterial;
  bushHolos: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; rect: { x: number; y: number; hw: number; hh: number } }[] = [];
  private inst = new Map<number, InstRef[]>();
  private destroyed = new Set<number>();
  reflectables: THREE.Object3D[] = [];
  padMats: THREE.ShaderMaterial[] = [];
  private overhead: THREE.Mesh[] = [];
  private railZ = 0; private railHalfW = 0;
  map: MapData;

  constructor(map: MapData) {
    this.map = map;
    const tex = this.paintGround();
    this.groundMat = groundMaterial(tex);
    const gGeo = new THREE.CircleGeometry(95, 96);
    gGeo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(gGeo, this.groundMat);
    this.ground.renderOrder = -10;
    this.group.add(this.ground);
    this.buildBuildings();
    this.buildProps();
    this.buildDecor();
    this.buildPadsGates();
  }

  /** 구역 색조, 웅덩이(알파), 네온 반사 페인트를 캔버스로 생성 */
  private paintGround(): THREE.Texture {
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const toPx = (v: number) => ((v + 48) / 96) * S;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, S, S);
    // 구역 색조
    const img = ctx.getImageData(0, 0, S, S);
    for (let py = 0; py < S; py += 1) {
      for (let px = 0; px < S; px += 1) {
        const x = (px / S) * 96 - 48, y = (py / S) * 96 - 48;
        const d = districtAt(x, y);
        const c = new THREE.Color(DISTRICT_TINT[d]);
        const i = (py * S + px) * 4;
        const k = 0.1;
        img.data[i] = c.r * 255 * k; img.data[i + 1] = c.g * 255 * k; img.data[i + 2] = c.b * 255 * k; img.data[i + 3] = 40;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 도로 표시
    ctx.strokeStyle = 'rgba(255,225,77,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 14]);
    for (const a of [0, Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(toPx(Math.cos(a) * -40), toPx(Math.sin(a) * -40)); ctx.lineTo(toPx(Math.cos(a) * 40), toPx(Math.sin(a) * 40));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(34,243,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(toPx(0), toPx(0), (10 / 96) * S, 0, Math.PI * 2); ctx.stroke();
    // 웅덩이 (알파 = 젖음)
    ctx.globalCompositeOperation = 'lighter';
    for (const d of this.map.decor) {
      if (d.kind !== 'puddle') continue;
      const g = ctx.createRadialGradient(toPx(d.x), toPx(d.y), 0, toPx(d.x), toPx(d.y), (d.s / 96) * S * 1.6);
      g.addColorStop(0, 'rgba(10,10,30,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(toPx(d.x), toPx(d.y), (d.s / 96) * S * 1.6, (d.s / 96) * S, d.a, 0, Math.PI * 2); ctx.fill();
    }
    // 가로등/간판의 젖은 바닥 반사 (세로로 늘어진 빛)
    const glow = (x: number, y: number, color: number, r: number, stretch: number, a: number) => {
      const c = new THREE.Color(color);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, (r / 96) * S);
      g.addColorStop(0, `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(toPx(x), toPx(y)); ctx.scale(1, stretch); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, (r / 96) * S, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    };
    for (const d of this.map.decor) {
      if (d.kind === 'lamp') glow(d.x, d.y + 1.2, NEON[d.c], 3.2, 1.8, 0.7);
      if (d.kind === 'sign') { const o = this.map.obstacles.find(o => o.x === d.x && o.y === d.y); if (o) glow(o.x, o.y + o.hh + 2.5, NEON[d.c], o.hw * 1.2, 2.2, 0.55); }
      if (d.kind === 'billboard') glow(d.x, d.y, NEON[d.c], d.s * 1.6, 1.0, 0.5);
    }
    for (const p of this.map.pads) glow(p.x, p.y, 0x22f3ff, 2.5, 1, 0.8);
    glow(this.map.gates.ax, this.map.gates.ay, 0x9b5cff, 3, 1, 0.8);
    glow(this.map.gates.bx, this.map.gates.by, 0x9b5cff, 3, 1, 0.8);
    glow(0, 0, 0xff2bd6, 5, 1, 0.5);
    // 알파: 웅덩이 강도 → 별도 패스로 알파 채우기
    ctx.globalCompositeOperation = 'source-over';
    const data = ctx.getImageData(0, 0, S, S);
    const rng = new Rng(this.map.seed);
    const wet = new Float32Array(S * S);
    for (const d of this.map.decor) {
      if (d.kind !== 'puddle') continue;
      const cx = toPx(d.x), cy = toPx(d.y), rr = (d.s / 96) * S * 1.6;
      for (let py = Math.max(0, (cy - rr) | 0); py < Math.min(S, cy + rr); py++)
        for (let px = Math.max(0, (cx - rr) | 0); px < Math.min(S, cx + rr); px++) {
          const dx = (px - cx) / rr, dy = (py - cy) / (rr * 0.65);
          const v = 1 - Math.sqrt(dx * dx + dy * dy);
          if (v > 0) wet[py * S + px] = Math.max(wet[py * S + px], Math.min(1, v * 2.2));
        }
    }
    for (let i = 0; i < S * S; i++) data.data[i * 4 + 3] = Math.min(255, wet[i] * 255);
    void rng;
    ctx.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  private buildBuildings() {
    const geos: THREE.BufferGeometry[] = [];
    const add = (x: number, y: number, w: number, d: number, h: number, neon: number, seed: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2, y);
      const n = g.attributes.position.count;
      const c = new THREE.Color(neon);
      g.setAttribute('aNeon', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(seed), 1));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [w, h, d][i % 3]), 3));
      geos.push(g.toNonIndexed());
    };
    let k = 0;
    for (const o of this.map.obstacles) {
      if (o.kind === 'building' || o.kind === 'greenhouse') add(o.x, o.y, o.hw * 2, o.hh * 2, o.h, NEON[k++ % NEON.length], k * 1.37);
    }
    for (const d of this.map.decor) if (d.kind === 'skyline') add(d.x, d.y, d.s, d.s * 0.9, d.h, NEON[d.c], d.x * 0.1 + d.y);
    // 고가 철도 상판
    const rail = this.map.decor.find(d => d.kind === 'railBeam');
    if (rail) {
      // 상판을 공중으로 올리기 위해 별도 메시
      const g = new THREE.BoxGeometry(rail.s, 0.7, 7.5).toNonIndexed();
      g.translate(rail.x, rail.h, rail.y);
      const n = g.attributes.position.count;
      g.setAttribute('aNeon', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [0.13, 0.95, 1][i % 3]), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n).fill(9), 1));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [rail.s, rail.h + 0.7, 7.5][i % 3]), 3));
      const deckMat = buildingMaterial(); deckMat.transparent = true;
      const deck = new THREE.Mesh(g, deckMat);
      this.railZ = rail.y; this.railHalfW = rail.s / 2;
      this.group.add(deck);
      this.reflectables.push(deck);
      this.overhead.push(deck);
      // 상판 아래 네온 띠
      for (const side of [-3.6, 3.6]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(rail.s, 0.08, 0.12), glowMaterial(0x22f3ff, 3));
        strip.position.set(rail.x, rail.h - 0.38, rail.y + side);
        (strip.material as THREE.ShaderMaterial).transparent = true; this.overhead.push(strip);
        this.group.add(strip); this.reflectables.push(strip);
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos), buildingMaterial());
    this.group.add(mesh);
    this.reflectables.push(mesh);
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: { o?: Obstacle; m: THREE.Matrix4; color?: THREE.Color }[], reflect = true) {
    if (list.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.color) mesh.setColorAt(i, it.color);
      if (it.o) {
        const refs = this.inst.get(it.o.id) ?? [];
        refs.push({ mesh, index: i, matrix: it.m.clone() });
        this.inst.set(it.o.id, refs);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    if (reflect) this.reflectables.push(mesh);
    return mesh;
  }

  private buildProps() {
    const rng = new Rng(this.map.seed + 1);
    const M = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
    const neonC = () => new THREE.Color(NEON[rng.int(0, NEON.length - 1)]);
    const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0);
    const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10); unitCyl.translate(0, 0.5, 0);
    const byKind = (k: string) => this.map.obstacles.filter(o => o.kind === k);

    // 벽, 방벽, 상자
    this.instanced(unitBox, propMaterial(0x24233a, { emissiveEdge: 0.04 }), byKind('wall').map(o => ({ o, m: M(o.x, 0, o.y, o.hw * 2, o.h, o.hh * 2), color: neonC() })));
    this.instanced(unitBox, propMaterial(0x3b3a52, { stripes: 2 }), byKind('barrier').map(o => ({ o, m: M(o.x, 0, o.y, o.hw * 2, o.h, o.hh * 2), color: new THREE.Color(0xffe14d) })));
    this.instanced(unitBox, propMaterial(0x5a4632, { emissiveEdge: 0.03 }), byKind('crate').map(o => ({ o, m: M(o.x, 0, o.y, o.hw * 2, o.h, o.hh * 2), color: neonC() })));
    // 컨테이너 (골판)
    const contCols = [0x8a3b2a, 0x2a5a8a, 0x2a7a6a, 0x7a6a2a];
    const conts = byKind('container');
    for (let ci = 0; ci < contCols.length; ci++) {
      const sub = conts.filter((_, i) => i % contCols.length === ci);
      this.instanced(unitBox, propMaterial(contCols[ci], { stripes: 3 }), sub.map(o => ({ o, m: M(o.x, 0, o.y, o.hw * 2, o.h, o.hh * 2), color: neonC() })));
    }
    // 차량 잔해: 몸체 + 캐빈 + 하부 네온
    const cars = byKind('car');
    this.instanced(unitBox, propMaterial(0x3a3550), cars.map(o => ({ o, m: M(o.x, 0.15, o.y, o.hw * 2, 0.65, o.hh * 2), color: neonC() })));
    this.instanced(unitBox, propMaterial(0x1c1a2c), cars.map(o => ({ o, m: M(o.x, 0.8, o.y, o.hw * 1.2, 0.45, o.hh * 1.2) })));
    this.instanced(unitBox, glowMaterial(0xffffff, 1.6, { additive: true, opacity: 0.6 }), cars.map(o => ({ o, m: M(o.x, 0.04, o.y, o.hw * 2.2, 0.02, o.hh * 2.2), color: neonC() })), false);
    // 기둥 + 네온 링
    const pillars = byKind('pillar');
    this.instanced(unitCyl, propMaterial(0x2c2b40), pillars.map(o => ({ o, m: M(o.x, 0, o.y, o.r, o.h, o.r) })));
    const ring = new THREE.TorusGeometry(1, 0.06, 6, 20); ring.rotateX(Math.PI / 2);
    this.instanced(ring, glowMaterial(0xffffff, 2.5), pillars.flatMap(o => [1.2, 3.6].map(h => ({ o, m: M(o.x, h, o.y, o.r * 1.08, 1, o.r * 1.08), color: new THREE.Color(0x22f3ff) }))));
    // 탱크
    const tanks = byKind('tank');
    this.instanced(unitCyl, propMaterial(0x3f4a52, { stripes: 1 }), tanks.map(o => ({ o, m: M(o.x, 0, o.y, o.r, o.h, o.r) })));
    this.instanced(ring, glowMaterial(0xff7a1a, 2.5), tanks.map(o => ({ o, m: M(o.x, o.h * 0.7, o.y, o.r * 1.05, 1, o.r * 1.05), color: new THREE.Color(1, 1, 1) })));
    // 노점
    const stalls = byKind('stall');
    this.instanced(unitBox, propMaterial(0x2e2440, { emissiveEdge: 0.05 }), stalls.map(o => ({ o, m: M(o.x, 0, o.y, o.hw * 2, o.h, o.hh * 2), color: neonC() })));
    const awning = new THREE.BoxGeometry(1, 0.08, 1); awning.translate(0, 0, 0);
    this.instanced(awning, propMaterial(0x3a2050, { stripes: 4 }), stalls.map(o => ({ o, m: M(o.x, 2.3, o.y + 0.25, o.hw * 2.3, 1, o.hh * 2.8), color: neonC() })));
    this.instanced(new THREE.BoxGeometry(1, 0.06, 0.06), glowMaterial(0xffffff, 1.8), stalls.map(o => ({ o, m: M(o.x, 2.27, o.y + 0.25 + o.hh * 1.4, o.hw * 2.3, 1, 1), color: neonC() })));
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 1, 4); pole.translate(0, 0.5, 0);
    this.instanced(pole, propMaterial(0x555566), stalls.flatMap(o => [-1, 1].map(s => ({ o, m: M(o.x + s * o.hw, 0, o.y + o.hh, 1, 2.3, 1) }))));
    // 화단 + 나무
    const planters = byKind('planter');
    this.instanced(unitBox, propMaterial(0x34303e), planters.map(o => ({ o, m: M(o.x, 0, o.y, o.hw * 2, o.h * 0.8, o.hh * 2) })));
    this.instanced(unitBox, propMaterial(0x0f4a3a), planters.map(o => ({ o, m: M(o.x, o.h * 0.8, o.y, o.hw * 1.9, 0.25, o.hh * 1.6), color: new THREE.Color(0x4dff88) })));
    const trees = byKind('tree');
    this.instanced(unitCyl, propMaterial(0x3a2a2a), trees.map(o => ({ o, m: M(o.x, 0, o.y, 0.15, 1.6, 0.15) })));
    const canopy = new THREE.IcosahedronGeometry(1, 0);
    this.instanced(canopy, propMaterial(0x0d5a4a), trees.map(o => ({ o, m: M(o.x, 2.3, o.y, 1.1, 1.0, 1.1, rng.next() * 6), color: new THREE.Color(0x4dff88) })));
    // 조각상
    for (const o of byKind('statue')) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.1, 0.8, 8), propMaterial(0x2a2840));
      base.position.set(o.x, 0.4, o.y);
      const fig = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), propMaterial(0x51487a));
      fig.scale.set(0.8, 2.2, 0.8); fig.position.set(o.x, 2.7, o.y);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.05, 6, 32), glowMaterial(0xff2bd6, 3));
      halo.rotation.x = Math.PI / 2.3; halo.position.set(o.x, 3.6, o.y);
      halo.onBeforeRender = () => { halo.rotation.z = G.uTime.value * 0.6; };
      this.group.add(base, fig, halo);
      this.reflectables.push(fig, halo);
    }
  }

  private buildDecor() {
    const M = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    const lamps = this.map.decor.filter(d => d.kind === 'lamp');
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 1, 5); pole.translate(0, 0.5, 0);
    this.instanced(pole, propMaterial(0x3a3a4a), lamps.map(d => ({ m: M(d.x, 0, d.y, 1, d.h, 1) })));
    const head = new THREE.BoxGeometry(0.9, 0.12, 0.25);
    this.instanced(head, glowMaterial(0xffffff, 1.5), lamps.map(d => ({ m: M(d.x, d.h, d.y, 1, 1, 1), color: new THREE.Color(NEON[d.c]) })));
    // 건물 간판 (카메라 쪽 +z 면)
    for (const d of this.map.decor) {
      if (d.kind !== 'sign') continue;
      const o = this.map.obstacles.find(o => o.x === d.x && o.y === d.y);
      if (!o) continue;
      const w = Math.min(o.hw * 1.2, 2.2), h = Math.min(o.h * 0.45, 3);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), hologramMaterial(NEON[d.c], { opacity: 0.9, pattern: 1 + (d.a % 5) }));
      sign.position.set(o.x + (d.a % 2 ? -0.3 : 0.3) * o.hw, d.h, o.y + o.hh + 0.06);
      this.group.add(sign); this.reflectables.push(sign);
      // 세로 네온 간판
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.35, Math.min(o.h * 0.7, 4.5), 0.12), glowMaterial(NEON[(d.c + 2) % NEON.length], 2.6));
      v.position.set(o.x + o.hw + 0.25, o.h * 0.5, o.y + o.hh * 0.4);
      this.group.add(v); this.reflectables.push(v);
    }
    // 홀로그램 광고판 구역 (부시)
    this.map.bushes.forEach((b, i) => {
      const mat = hologramMaterial(NEON[i % 3], { opacity: 0.32, pattern: 0 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, 2.6, b.hh * 2, 1, 1, 1).translate(0, 1.3, 0), mat);
      box.position.set(b.x, 0, b.y);
      this.group.add(box);
      this.bushHolos.push({ mesh: box, mat, rect: b });
      const ad = new THREE.Mesh(new THREE.PlaneGeometry(b.hw * 2.2, 2.4), hologramMaterial(NEON[(i + 1) % 3], { opacity: 0.85, pattern: 2 + i }));
      ad.position.set(b.x, 4.2, b.y);
      ad.onBeforeRender = () => { ad.rotation.y = Math.sin(G.uTime.value * 0.3 + i) * 0.3; };
      this.group.add(ad); this.reflectables.push(ad);
    });
    // 풀
    const grass = this.map.decor.filter(d => d.kind === 'grass');
    const tuft = new THREE.ConeGeometry(0.12, 0.6, 4); tuft.translate(0, 0.3, 0);
    this.instanced(tuft, glowMaterial(0x4dff88, 0.9), grass.flatMap(d => [0, 1, 2].map(k => ({ m: M(d.x + Math.cos(d.a + k * 2) * 0.25, 0, d.y + Math.sin(d.a + k * 2) * 0.25, d.s, d.s * (0.8 + k * 0.2), d.s), color: new THREE.Color(1, 1, 1) }))), false);
  }

  private buildPadsGates() {
    for (const p of this.map.pads) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: G.uTime, uDir: { value: Math.atan2(p.ty - p.y, p.tx - p.x) } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uDir; varying vec2 vUv;
          void main(){ vec2 c = vUv * 2.0 - 1.0; float r = length(c); if (r > 1.0) discard;
            float ring = smoothstep(0.08, 0.0, abs(r - 0.92)) + smoothstep(0.05, 0.0, abs(r - fract(uTime * 0.8)));
            vec2 d = vec2(cos(uDir), sin(-uDir)); float along = dot(c, d); float across = abs(dot(c, vec2(-d.y, d.x)));
            float chev = smoothstep(0.08, 0.0, abs(fract(along * 2.0 - uTime * 2.0) - across * 0.8 - 0.3)) * step(across, 0.5);
            gl_FragColor = vec4(vec3(0.13, 0.95, 1.0) * 2.0, (ring + chev * 0.8) * 0.9); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
      disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, 0.04, p.y);
      this.group.add(disc);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.12, 16), propMaterial(0x26243a));
      base.position.set(p.x, 0.0, p.y);
      this.group.add(base);
    }
    const g = this.map.gates;
    for (const [x, y] of [[g.ax, g.ay], [g.bx, g.by]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.12, 8, 32), glowMaterial(0x9b5cff, 3));
      ring.position.set(x, 1.5, y);
      const portal = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), hologramMaterial(0x9b5cff, { opacity: 0.6, pattern: 7 }));
      portal.position.set(x, 1.5, y);
      ring.onBeforeRender = () => { ring.rotation.y = G.uTime.value * 0.8; portal.rotation.y = G.uTime.value * 0.8; };
      this.group.add(ring, portal);
      this.reflectables.push(ring, portal);
    }
  }

  setDestroyed(id: number) {
    if (this.destroyed.has(id)) return;
    this.destroyed.add(id);
    const refs = this.inst.get(id);
    if (!refs) return;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const r of refs) { r.mesh.setMatrixAt(r.index, zero); r.mesh.instanceMatrix.needsUpdate = true; }
  }

  /** 내 영웅이 들어간 홀로그램 구역은 투명하게 */
  updateBushFade(px: number, py: number) {
    // 고가 철도 아래(또는 카메라 시선이 가리는 바로 앞)에서는 상판을 투명하게
    const under = this.overhead.length > 0 && Math.abs(px) < this.railHalfW + 2 && py > this.railZ - 9 && py < this.railZ + 5;
    for (const m of this.overhead) {
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      const key = u.uAlpha ? 'uAlpha' : 'uOpacity';
      if (!u[key]) continue;
      u[key].value += ((under ? 0.18 : 1) - u[key].value) * 0.12;
    }
    for (const b of this.bushHolos) {
      const inside = Math.abs(px - b.rect.x) <= b.rect.hw + 0.3 && Math.abs(py - b.rect.y) <= b.rect.hh + 0.3;
      const target = inside ? 0.35 : 1;
      b.mat.uniforms.uFade.value += (target - b.mat.uniforms.uFade.value) * 0.15;
    }
  }
}
