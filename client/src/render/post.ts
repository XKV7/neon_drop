import * as THREE from 'three';
import type { Quality } from '../settings';

const FS_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** 포스트 프로세싱: 블룸(듀얼 필터) + 색수차 + 비네팅 + 톤매핑 + 피격/구역 효과 */
export class Post {
  renderer: THREE.WebGLRenderer;
  sceneRT: THREE.WebGLRenderTarget;
  private bright: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private brightMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  compMat: THREE.ShaderMaterial;
  levels = 5;
  quality: Quality = 'mid';
  w = 1; h = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const tp = THREE.HalfFloatType;
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: tp, samples: 0 });
    this.bright = new THREE.WebGLRenderTarget(4, 4, { type: tp });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.95 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b)); float k = smoothstep(uThreshold, uThreshold + 0.6, l); gl_FragColor = vec4(min(c * k, vec3(12.0)), 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.downMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
        void main(){ vec3 s = texture2D(tDiffuse, vUv).rgb * 4.0;
          s += texture2D(tDiffuse, vUv - uTexel).rgb; s += texture2D(tDiffuse, vUv + uTexel).rgb;
          s += texture2D(tDiffuse, vUv + vec2(uTexel.x, -uTexel.y)).rgb; s += texture2D(tDiffuse, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
          gl_FragColor = vec4(s / 8.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.upMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uHasPrev: { value: 0 } },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; uniform sampler2D tPrev; uniform vec2 uTexel; uniform float uHasPrev; varying vec2 vUv;
        void main(){ vec2 o = uTexel;
          vec3 s = texture2D(tDiffuse, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(o.x * 2.0, 0.0)).rgb
            + texture2D(tDiffuse, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, o.y * 2.0)).rgb;
          s += (texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv - o).rgb + texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb) * 2.0;
          s /= 12.0;
          if (uHasPrev > 0.5) s += texture2D(tPrev, vUv).rgb;
          gl_FragColor = vec4(s, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.75 }, uCA: { value: 0.0018 }, uVignette: { value: 0.55 }, uTime: { value: 0 },
        uHurt: { value: 0 }, uOutside: { value: 0 }, uLowHp: { value: 0 }, uGrain: { value: 0.012 }, uSat: { value: 1 }, uFlash: { value: 0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uCA; uniform float uVignette; uniform float uTime;
        uniform float uHurt; uniform float uOutside; uniform float uLowHp; uniform float uGrain; uniform float uSat; uniform float uFlash;
        varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
        void main(){
          vec2 uv = vUv;
          // 구역 밖: 가로 글리치 흔들림
          if (uOutside > 0.0) { float row = floor(uv.y * 60.0); float g = step(0.96, h(vec2(row, floor(uTime * 20.0)))); uv.x += (h(vec2(row, uTime)) - 0.5) * 0.01 * g * uOutside; }
          vec2 d = uv - 0.5;
          float ca = uCA * (1.0 + uHurt * 4.0 + uOutside * 1.2);
          vec3 c;
          c.r = texture2D(tScene, uv + d * ca * 2.0).r;
          c.g = texture2D(tScene, uv).g;
          c.b = texture2D(tScene, uv - d * ca * 2.0).b;
          c += texture2D(tBloom, uv).rgb * uBloom;
          c = aces(c * 1.05);
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(l), c, uSat * (1.0 - uOutside * 0.25));
          float v = smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0)));
          c *= mix(1.0 - uVignette, 1.0, v);
          // 피격, 저체력
          float edge = 1.0 - v;
          c += vec3(0.9, 0.05, 0.15) * edge * (uHurt * 0.9 + uLowHp * (0.35 + 0.25 * sin(uTime * 6.0)));
          c += vec3(0.8, 0.1, 0.5) * edge * uOutside * 0.15;
          c += uFlash;
          c += (h(uv * 900.0 + uTime) - 0.5) * uGrain;
          c = pow(c, vec3(1.0 / 2.2));
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.levels = q === 'low' ? 3 : q === 'mid' ? 4 : 5;
    this.sceneRT.samples = q === 'high' ? 4 : q === 'mid' ? 2 : 0;
    this.compMat.uniforms.uGrain.value = q === 'low' ? 0 : 0.012;
    this.resize(this.w, this.h, true);
  }

  resize(w: number, h: number, force = false) {
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.sceneRT.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 2)), bh = Math.max(1, Math.floor(h / 2));
    this.bright.setSize(bw, bh);
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = []; this.up = [];
    let cw = bw, ch = bh;
    for (let i = 0; i < this.levels; i++) {
      cw = Math.max(1, Math.floor(cw / 2)); ch = Math.max(1, Math.floor(ch / 2));
      this.down.push(new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType }));
    }
    for (let i = this.levels - 2; i >= 0; i--) {
      const t = this.down[i];
      this.up.push(new THREE.WebGLRenderTarget(t.width, t.height, { type: THREE.HalfFloatType }));
    }
    this.up.push(new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType }));
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    // 밝은 부분 추출
    this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.pass(this.brightMat, this.bright);
    // 다운샘플
    let src: THREE.WebGLRenderTarget = this.bright;
    for (const t of this.down) {
      this.downMat.uniforms.tDiffuse.value = src.texture;
      this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.downMat, t);
      src = t;
    }
    // 업샘플 + 누적
    let prev: THREE.WebGLRenderTarget | null = null;
    src = this.down[this.down.length - 1];
    for (let i = 0; i < this.up.length; i++) {
      const t = this.up[i];
      const skip = i < this.up.length - 1 ? this.down[this.down.length - 2 - i] : this.bright;
      this.upMat.uniforms.tDiffuse.value = src.texture;
      this.upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.upMat.uniforms.tPrev.value = skip.texture;
      this.upMat.uniforms.uHasPrev.value = i < this.up.length - 1 ? 1 : 0;
      this.pass(this.upMat, t);
      src = t; prev = t;
    }
    this.compMat.uniforms.tScene.value = this.sceneRT.texture;
    this.compMat.uniforms.tBloom.value = (prev ?? this.bright).texture;
    this.compMat.uniforms.uTime.value = time;
    this.pass(this.compMat, null);
  }
}
