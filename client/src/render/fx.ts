import * as THREE from 'three';
import { decalMaterial, glowSpriteMaterial, glowMaterial, G } from './shaders';
import type { Quality } from '../settings';

/** 파티클 풀 (CPU 갱신, 단일 드로우콜) */
export class Particles {
  max: number;
  points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private maxLife: Float32Array; private grav: Float32Array; private drag: Float32Array; private baseSize: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;

  constructor(max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.baseSize = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `attribute float aSize; attribute float aAlpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard; float a = pow(1.0 - r, 1.6) * vA; gl_FragColor = vec4(vC * 2.2, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grav = 0, drag = 1.5) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.baseSize[i] = size; this.size[i] = size; this.alpha[i] = 1;
  }

  burst(x: number, y: number, z: number, n: number, color: THREE.Color, speed: number, size = 0.25, life = 0.6, grav = 0, up = 0.5) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7), u = (Math.random() - 0.2) * speed * up;
      this.spawn(x, y, z, Math.cos(a) * s, u, Math.sin(a) * s, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), grav);
    }
  }

  ring(x: number, z: number, r: number, n: number, color: THREE.Color, speed = 4, y = 0.2) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.spawn(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * speed, 0.5, Math.sin(a) * speed, color, 0.3, 0.5, 0, 3);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; } continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.4; }
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = f;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * f);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** 처치 시 디지털 분해: 복셀 큐브 풀 */
export class Voxels {
  mesh: THREE.InstancedMesh;
  private n: number;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private rot: Float32Array; private s: Float32Array;
  private cursor = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private sc = new THREE.Vector3(); private pv = new THREE.Vector3();

  constructor(n = 900) {
    this.n = n;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.rot = new Float32Array(n * 3); this.s = new Float32Array(n);
    const mat = glowMaterial(0xffffff, 1.6);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this.mesh.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
    this.life[i] = life; this.s[i] = size;
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** kind: 0 분해, 1 폭죽, 2 글리치 붕괴, 3 번개, 4 하트 */
  burst(x: number, z: number, c1: THREE.Color, c2: THREE.Color, kind: number) {
    const count = kind === 4 ? 60 : 110;
    for (let k = 0; k < count; k++) {
      const col = k % 3 === 0 ? c2 : c1;
      let px = x + (Math.random() - 0.5) * 0.7, py = 0.2 + Math.random() * 1.7, pz = z + (Math.random() - 0.5) * 0.7;
      let vx = (Math.random() - 0.5) * 5, vy = 2 + Math.random() * 5, vz = (Math.random() - 0.5) * 5;
      if (kind === 2) { vx *= 0.3; vz *= 0.3; vy = -1 - Math.random() * 2; }
      if (kind === 4) { const t = (k / count) * Math.PI * 2; const hx = 16 * Math.sin(t) ** 3, hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); px = x + hx * 0.06; py = 1.6 + hy * 0.06; pz = z; vx = 0; vy = 1.2; vz = 0; }
      if (kind === 1) { vy = 6 + Math.random() * 6; }
      this.spawn(px, py, pz, vx, vy, vz, kind === 4 ? new THREE.Color(1, 0.3, 0.7) : col, 0.08 + Math.random() * 0.12, 1.2 + Math.random() * 0.8);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= 9.8 * dt * 0.8;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < this.s[i] * 0.5) { this.p[i * 3 + 1] = this.s[i] * 0.5; this.v[i * 3 + 1] *= -0.3; this.v[i * 3] *= 0.7; this.v[i * 3 + 2] *= 0.7; }
      const sz = this.life[i] > 0 ? this.s[i] * Math.min(1, this.life[i] * 2) : 0;
      this.e.set(this.rot[i * 3] + this.life[i] * 3, this.rot[i * 3 + 1], this.rot[i * 3 + 2]);
      this.q.setFromEuler(this.e); this.sc.set(sz, sz, sz); this.pv.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      this.m.compose(this.pv, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 비 */
export class Rain {
  mesh: THREE.InstancedMesh;
  private n: number;
  private p: Float32Array;
  private m = new THREE.Matrix4();
  constructor(n: number) {
    this.n = n;
    const geo = new THREE.PlaneGeometry(0.025, 0.9);
    const mat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; void main(){ gl_FragColor = vec4(vec3(0.55, 0.65, 1.0), 0.28 * vUv.y); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.p[i * 3] = (Math.random() - 0.5) * 50; this.p[i * 3 + 1] = Math.random() * 22; this.p[i * 3 + 2] = (Math.random() - 0.5) * 40; }
  }
  update(dt: number, cx: number, cz: number, camQuat: THREE.Quaternion, splash: (x: number, z: number) => void) {
    const q = camQuat;
    for (let i = 0; i < this.n; i++) {
      this.p[i * 3 + 1] -= 24 * dt;
      this.p[i * 3] -= 3 * dt;
      if (this.p[i * 3 + 1] < 0) {
        if (i % 6 === 0) splash(cx + this.p[i * 3], cz + this.p[i * 3 + 2]);
        this.p[i * 3] = (Math.random() - 0.5) * 50; this.p[i * 3 + 1] = 18 + Math.random() * 5; this.p[i * 3 + 2] = (Math.random() - 0.5) * 40;
      }
      this.m.makeRotationFromQuaternion(q);
      this.m.setPosition(cx + this.p[i * 3], this.p[i * 3 + 1], cz + this.p[i * 3 + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** 바닥 데칼 풀 */
export class DecalPool {
  group = new THREE.Group();
  private free: THREE.Mesh[] = [];
  private geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private lineGeo: THREE.PlaneGeometry;
  constructor() {
    this.lineGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.lineGeo.translate(0.5, 0, 0);
  }
  get(shape: 0 | 1 | 2): THREE.Mesh {
    let m = this.free.pop();
    if (!m) { m = new THREE.Mesh(this.geo, decalMaterial()); m.renderOrder = 2; this.group.add(m); }
    m.geometry = shape === 2 ? this.lineGeo : this.geo;
    m.visible = true;
    (m.material as THREE.ShaderMaterial).uniforms.uShape.value = shape;
    m.rotation.set(0, 0, 0);
    return m;
  }
  release(m: THREE.Mesh) { m.visible = false; this.free.push(m); }

  /** 원/부채꼴/직선 배치 */
  place(m: THREE.Mesh, shape: number, x: number, z: number, opts: { r?: number; ang?: number; len?: number; w?: number; spread?: number; y?: number }) {
    const mat = m.material as THREE.ShaderMaterial;
    m.position.set(x, opts.y ?? 0.05, z);
    if (shape === 0) { const d = (opts.r ?? 1) * 2; m.scale.set(d, 1, d); m.rotation.y = 0; }
    else if (shape === 1) { const d = (opts.r ?? 1) * 2; m.scale.set(d, 1, d); m.rotation.y = -(opts.ang ?? 0); mat.uniforms.uAngle.value = opts.spread ?? 1; }
    else { m.scale.set(opts.len ?? 1, 1, opts.w ?? 1); m.rotation.y = -(opts.ang ?? 0); mat.uniforms.uAspect.value = (opts.len ?? 1) / Math.max(0.3, opts.w ?? 1); }
  }
}

/** 일회성 시각 효과 (충격파, 빔, 번개, 섬광) */
export class Transients {
  group = new THREE.Group();
  private items: { obj: THREE.Object3D; t: number; dur: number; update: (k: number, o: THREE.Object3D) => void; done?: () => void }[] = [];
  private spriteGeo = new THREE.PlaneGeometry(1, 1);
  constructor(private decals: DecalPool) {}

  add(obj: THREE.Object3D, dur: number, update: (k: number, o: THREE.Object3D) => void, done?: () => void) {
    this.group.add(obj);
    this.items.push({ obj, t: 0, dur, update, done });
  }

  shockwave(x: number, z: number, r: number, color: THREE.Color, dur = 0.45, kind = 5) {
    const d = this.decals.get(0);
    const mat = d.material as THREE.ShaderMaterial;
    mat.uniforms.uKind.value = kind; mat.uniforms.uColor.value.copy(color);
    this.items.push({ obj: d, t: 0, dur, update: k => { this.decals.place(d, 0, x, z, { r: r * (0.3 + 0.7 * Math.sqrt(k)) }); mat.uniforms.uAlpha.value = 1 - k; mat.uniforms.uProgress.value = 0; }, done: () => this.decals.release(d) });
  }

  flash(x: number, y: number, z: number, size: number, color: THREE.Color, dur = 0.25, cam?: THREE.Camera) {
    const m = new THREE.Mesh(this.spriteGeo, glowSpriteMaterial());
    (m.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(color);
    m.position.set(x, y, z);
    this.add(m, dur, (k, o) => { if (cam) o.quaternion.copy(cam.quaternion); const s = size * (0.6 + k * 0.6); o.scale.set(s, s, s); ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uAlpha.value = 1 - k; }, () => (m.material as THREE.Material).dispose());
  }

  beam(x: number, z: number, ang: number, len: number, width: number, color: THREE.Color, dur = 0.5) {
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0.5, 0, 0);
    const outer = new THREE.Mesh(geo, glowMaterial(color, 3, { additive: true, opacity: 0.7 }));
    const inner = new THREE.Mesh(geo, glowMaterial(0xffffff, 4, { additive: true }));
    const g = new THREE.Group(); g.add(outer, inner);
    g.position.set(x, 1.0, z); g.rotation.y = -ang;
    this.add(g, dur, k => {
      const w = width * (1 - k) ** 0.5;
      outer.scale.set(len, w * 0.8, w); inner.scale.set(len, w * 0.25, w * 0.3);
      (outer.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.7 * (1 - k);
    }, () => { geo.dispose(); (outer.material as THREE.Material).dispose(); (inner.material as THREE.Material).dispose(); });
  }

  bolt(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: THREE.Color, dur = 0.25) {
    const pts: THREE.Vector3[] = [];
    const segs = 9;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jit = i === 0 || i === segs ? 0 : 0.45;
      pts.push(new THREE.Vector3(x1 + (x2 - x1) * t + (Math.random() - 0.5) * jit, y1 + (y2 - y1) * t + (Math.random() - 0.5) * jit, z1 + (z2 - z1) * t + (Math.random() - 0.5) * jit));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    this.add(line, dur, k => { mat.opacity = 1 - k; }, () => { geo.dispose(); mat.dispose(); });
  }

  /** 하늘에서 떨어지는 기둥 (보급, 낙하) */
  pillar(x: number, z: number, color: THREE.Color, dur = 1.0, h = 30, w = 0.6) {
    const geo = new THREE.CylinderGeometry(w, w * 0.6, h, 8, 1, true); geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, glowMaterial(color, 2.5, { additive: true, opacity: 0.6 }));
    m.position.set(x, 0, z);
    this.add(m, dur, k => { (m.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.6 * (1 - k); m.scale.set(1 - k * 0.7, 1, 1 - k * 0.7); }, () => { geo.dispose(); (m.material as THREE.Material).dispose(); });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.update(k, it.obj);
      if (k >= 1) {
        if (it.obj.parent === this.group) this.group.remove(it.obj);
        it.done?.();
        this.items.splice(i, 1);
      }
    }
  }
}

/** 투사체 모양 */
export function projectileMesh(visual: number, color: THREE.Color): THREE.Object3D {
  const g = new THREE.Group();
  const core = glowMaterial(color, 3);
  const white = glowMaterial(0xffffff, 2.5);
  let geo: THREE.BufferGeometry;
  switch (visual) {
    case 1: geo = new THREE.TorusGeometry(0.6, 0.12, 4, 12, Math.PI); geo.rotateX(Math.PI / 2); geo.rotateY(Math.PI / 2); break; // 충격파
    case 2: geo = new THREE.CylinderGeometry(0.45, 0.45, 0.06, 10); break; // 톱날
    case 3: geo = new THREE.OctahedronGeometry(0.3, 0); geo.scale(1, 0.25, 1); break; // 수리검
    case 4: geo = new THREE.BoxGeometry(0.9, 0.05, 0.05); break; // 와이어
    case 5: geo = new THREE.BoxGeometry(1.8, 0.14, 0.14); break; // 레일
    case 6: geo = new THREE.ConeGeometry(0.12, 0.5, 5); geo.rotateZ(-Math.PI / 2); break; // 미사일
    case 8: geo = new THREE.BoxGeometry(0.35, 0.35, 0.35); break; // 코드
    case 9: geo = new THREE.IcosahedronGeometry(0.4, 0); break; // 중력 구체
    case 10: geo = new THREE.SphereGeometry(0.16, 6, 4); break; // 드론탄
    default: geo = new THREE.BoxGeometry(0.6, 0.1, 0.1); // 탄환/볼트
  }
  const m = new THREE.Mesh(geo, core);
  g.add(m);
  if (visual !== 2 && visual !== 1) { const inner = new THREE.Mesh(geo, white); inner.scale.setScalar(0.5); g.add(inner); }
  g.userData.spin = visual === 2 || visual === 3 || visual === 8 || visual === 9;
  return g;
}

export function qualityCounts(q: Quality) {
  return { particles: q === 'low' ? 1500 : q === 'mid' ? 3000 : 5000, rain: q === 'low' ? 250 : q === 'mid' ? 700 : 1300, voxels: q === 'low' ? 400 : 900 };
}

export { G };
