import * as THREE from 'three';

/** 전역 셰이더 유니폼 (시간, 시야 텍스처, 구역) */
export const G = {
  uTime: { value: 0 },
  uVisTex: { value: null as THREE.Texture | null },
  uVisOn: { value: 0 },
  uZone: { value: new THREE.Vector4(0, 0, 999, 0) }, // x, y, r, dps>0?
  uNext: { value: new THREE.Vector4(0, 0, 0, 0) }, // x, y, r, show
  uLightDir: { value: new THREE.Vector3(-0.45, 1.0, 0.55).normalize() },
  /** 네온 빛 강도 (설정). 영웅은 가독성을 위해 덜 줄인다 */
  uNeon: { value: 0.55 },
  uNeonHero: { value: 0.78 },
};

export function setNeon(v: number) { G.uNeon.value = v; G.uNeonHero.value = 0.5 + 0.5 * v; }

const VIS_FN = /* glsl */ `
uniform sampler2D uVisTex; uniform float uVisOn;
float visAt(vec3 wp) {
  if (uVisOn < 0.5) return 1.0;
  vec2 uv = (wp.xz + 48.0) / 96.0;
  return texture2D(uVisTex, uv).r;
}`;

const INST_VERT = /* glsl */ `
#ifdef USE_INSTANCING
  mat4 im = modelMatrix * instanceMatrix;
#else
  mat4 im = modelMatrix;
#endif
  vec4 wp = im * vec4(position, 1.0);
`;

/** 툰 셰이딩 + 림라이트 + 평면 법선(로우폴리) */
export function toonMaterial(opts: { color: THREE.ColorRepresentation; emissive?: THREE.ColorRepresentation; emissiveStrength?: number; rim?: THREE.ColorRepresentation; shared?: Record<string, THREE.IUniform>; transparent?: boolean }) {
  const shared = opts.shared ?? { uFlash: { value: 0 }, uOpacity: { value: 1 }, uDissolve: { value: 0 }, uTint: { value: new THREE.Color(0, 0, 0) } };
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uEmissive: { value: new THREE.Color(opts.emissive ?? 0x000000).multiplyScalar(opts.emissiveStrength ?? 1) },
      uRim: { value: new THREE.Color(opts.rim ?? 0x8a6bff) },
      uLightDir: G.uLightDir, uTime: G.uTime,
      ...shared,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vNormalW;
      void main() {
        ${INST_VERT}
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(im) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uEmissive; uniform vec3 uRim; uniform vec3 uLightDir; uniform float uFlash; uniform float uOpacity; uniform float uDissolve; uniform vec3 uTint; uniform float uTime;
      varying vec3 vWorld; varying vec3 vNormalW;
      float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main() {
        vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        if (uDissolve > 0.0) {
          float n = h3(floor(vWorld * 9.0));
          if (n < uDissolve) discard;
        }
        float ndl = dot(N, uLightDir);
        float toon = ndl > 0.55 ? 1.0 : ndl > 0.05 ? 0.68 : 0.42;
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        vec3 col = uColor * toon * vec3(0.95, 0.9, 1.1) + uRim * rim * 0.9 + uEmissive + uTint;
        col += vec3(1.0, 0.95, 1.0) * uFlash * 1.6;
        gl_FragColor = vec4(col, uOpacity);
      }`,
    transparent: opts.transparent ?? false,
  });
  return m;
}

/** 단색 발광 (네온 파츠) */
export function glowMaterial(color: THREE.ColorRepresentation, strength = 2.2, opts: { additive?: boolean; opacity?: number; shared?: Record<string, THREE.IUniform> } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(strength) }, uAlpha: { value: opts.opacity ?? 1 }, uTime: G.uTime, uNeonK: opts.shared ? G.uNeonHero : G.uNeon, ...(opts.shared ?? { uOpacity: { value: 1 }, uFlash: { value: 0 } }) },
    vertexShader: /* glsl */ `
      #ifdef USE_INSTANCING_COLOR
      varying vec3 vIC;
      #endif
      void main() {
        ${INST_VERT}
        #ifdef USE_INSTANCING_COLOR
        vIC = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAlpha; uniform float uOpacity; uniform float uFlash; uniform float uNeonK;
      #ifdef USE_INSTANCING_COLOR
      varying vec3 vIC;
      #endif
      void main() {
        vec3 c = uColor * (0.25 + 0.75 * uNeonK);
        #ifdef USE_INSTANCING_COLOR
        c *= vIC;
        #endif
        gl_FragColor = vec4(c + uFlash, uAlpha * uOpacity);
      }`,
    transparent: opts.additive || (opts.opacity ?? 1) < 1,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !opts.additive,
  });
}

/** 소품/엄폐물: 인스턴스 색 + 시야 어둡게 */
export function propMaterial(base: THREE.ColorRepresentation, opts: { stripes?: number; emissiveEdge?: number } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(base) }, uLightDir: G.uLightDir, uTime: G.uTime, uVisTex: G.uVisTex, uVisOn: G.uVisOn, uStripes: { value: opts.stripes ?? 0 }, uEdge: { value: opts.emissiveEdge ?? 0 }, uNeon: G.uNeon },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vLocal; varying vec3 vIC;
      void main() {
        ${INST_VERT}
        vWorld = wp.xyz; vLocal = position;
        #ifdef USE_INSTANCING_COLOR
        vIC = instanceColor;
        #else
        vIC = vec3(0.13, 0.95, 1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uLightDir; uniform float uStripes; uniform float uEdge; uniform float uTime; uniform float uNeon;
      varying vec3 vWorld; varying vec3 vLocal; varying vec3 vIC;
      ${VIS_FN}
      void main() {
        vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float ndl = dot(N, uLightDir);
        float toon = ndl > 0.55 ? 1.0 : ndl > 0.05 ? 0.7 : 0.45;
        vec3 col = uColor * toon;
        if (uStripes > 0.0) col *= 0.82 + 0.18 * step(0.5, fract((vLocal.x + vLocal.z) * uStripes));
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vIC * rim * 0.35 * uNeon;
        if (uEdge > 0.0) {
          float top = smoothstep(uEdge, 0.0, abs(vLocal.y - 0.5));
          col += vIC * top * 2.2 * uNeon;
        }
        col *= mix(0.42, 1.0, visAt(vWorld));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** 건물: 절차적 창문 + 네온 테두리 */
export function buildingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uLightDir: G.uLightDir, uTime: G.uTime, uVisTex: G.uVisTex, uVisOn: G.uVisOn, uAlpha: { value: 1 }, uNeon: G.uNeon },
    vertexShader: /* glsl */ `
      attribute vec3 aNeon; attribute float aSeed; attribute vec3 aSize;
      varying vec3 vWorld; varying vec3 vNeon; varying float vSeed; varying vec3 vLocal; varying vec3 vSize;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz; vNeon = aNeon; vSeed = aSeed; vLocal = position; vSize = aSize;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLightDir; uniform float uTime; uniform float uAlpha; uniform float uNeon;
      varying vec3 vWorld; varying vec3 vNeon; varying float vSeed; varying vec3 vLocal; varying vec3 vSize;
      ${VIS_FN}
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + vSeed * 17.0) * 43758.5453); }
      void main() {
        vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        vec3 V = normalize(cameraPosition - vWorld);
        if (dot(N, V) < 0.0) N = -N;
        float ndl = dot(N, uLightDir);
        vec3 base = vec3(0.045, 0.04, 0.075);
        vec3 col = base * (ndl > 0.4 ? 1.25 : 0.8);
        if (abs(N.y) < 0.5) {
          float u = abs(N.x) > 0.5 ? vWorld.z : vWorld.x;
          vec2 cell = vec2(floor(u / 1.1), floor(vWorld.y / 1.35));
          vec2 f = vec2(fract(u / 1.1), fract(vWorld.y / 1.35));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.75);
          float lit = step(0.58, h2(cell));
          float flick = 0.85 + 0.15 * sin(uTime * (2.0 + h2(cell + 3.0) * 6.0) + h2(cell) * 30.0);
          vec3 wc = mix(vec3(1.0, 0.75, 0.45), vNeon, step(0.6, h2(cell + 7.0)));
          col += win * lit * wc * (0.35 + 0.55 * uNeon) * flick * step(0.9, vWorld.y);
          col += win * (1.0 - lit) * vec3(0.02, 0.03, 0.06);
          // 상단 네온 띠
          float topBand = smoothstep(0.18, 0.0, abs(vWorld.y - (vSize.y - 0.35)));
          col += vNeon * topBand * 2.4 * uNeon;
          float baseBand = smoothstep(0.08, 0.0, abs(vWorld.y - 0.6));
          col += vNeon * baseBand * 1.2 * uNeon;
        } else {
          col = vec3(0.05, 0.045, 0.08);
          vec2 g = abs(fract(vWorld.xz * 0.5) - 0.5);
          col += vNeon * 0.05 * step(0.46, max(g.x, g.y));
        }
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vNeon * rim * 0.15;
        float dist = length(vWorld.xz);
        col *= mix(0.5, 1.0, visAt(vWorld));
        col = mix(col, vec3(0.06, 0.02, 0.1), smoothstep(46.0, 75.0, dist) * 0.6);
        gl_FragColor = vec4(col, uAlpha);
      }`,
  });
}

/** 홀로그램 (스캔라인, 깜빡임) */
export function hologramMaterial(color: THREE.ColorRepresentation, opts: { opacity?: number; pattern?: number } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: G.uTime, uOpacity: { value: opts.opacity ?? 0.5 }, uPattern: { value: opts.pattern ?? 0 }, uFade: { value: 1 }, uNeon: G.uNeon },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uPattern; uniform float uFade; uniform float uNeon;
      varying vec2 vUv; varying vec3 vWorld;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      void main() {
        float scan = 0.55 + 0.45 * sin(vWorld.y * 38.0 - uTime * 6.0);
        float band = smoothstep(0.0, 0.08, fract(vUv.y * 1.0 - uTime * 0.25)) ;
        float edge = max(smoothstep(0.06, 0.0, vUv.x), smoothstep(0.94, 1.0, vUv.x)) + max(smoothstep(0.05, 0.0, vUv.y), smoothstep(0.95, 1.0, vUv.y));
        float content = 0.0;
        if (uPattern > 0.5) {
          vec2 g = floor(vUv * vec2(6.0, 10.0) + vec2(0.0, floor(uTime * 2.0)));
          content = step(0.55, h(g + uPattern)) * 0.8;
          vec2 c = vUv - 0.5;
          content += smoothstep(0.02, 0.0, abs(length(c * vec2(1.0, 1.6)) - 0.28 - 0.03 * sin(uTime * 3.0))) * 1.5;
        }
        float flick = 0.85 + 0.15 * step(0.92, h(vec2(floor(uTime * 12.0), 1.0)));
        float a = (0.25 + 0.75 * content + edge * 1.3) * scan * flick * uOpacity * uFade * (0.6 + 0.4 * band);
        gl_FragColor = vec4(uColor * (1.5 + content) * (0.3 + 0.7 * uNeon), a * (0.45 + 0.55 * uNeon));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
}

/** 바닥: 젖은 아스팔트, 반사, 구역 표시, 전장의 안개 */
export function groundMaterial(groundMap: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: groundMap }, uTime: G.uTime, uVisTex: G.uVisTex, uVisOn: G.uVisOn, uZone: G.uZone, uNext: G.uNext,
      uRefl: { value: null as THREE.Texture | null }, uReflOn: { value: 0 }, uTexMat: { value: new THREE.Matrix4() }, uNeon: G.uNeon,
    },
    vertexShader: /* glsl */ `
      uniform mat4 uTexMat;
      varying vec3 vWorld; varying vec4 vReflUv;
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vReflUv = uTexMat * wp; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime; uniform vec4 uZone; uniform vec4 uNext;
      uniform sampler2D uRefl; uniform float uReflOn; uniform float uNeon;
      varying vec3 vWorld; varying vec4 vReflUv;
      ${VIS_FN}
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main() {
        vec2 p = vWorld.xz;
        vec2 uv = (p + 48.0) / 96.0;
        vec4 gm = texture2D(uMap, uv);
        float grit = n2(p * 1.5) * 0.6 + n2(p * 6.0) * 0.4;
        vec3 col = vec3(0.03, 0.028, 0.048) + grit * 0.01;
        // 타일 줄눈
        vec2 g = abs(fract(p / 2.0) - 0.5);
        col += gm.rgb * 0.06 * step(0.47, max(g.x, g.y));
        col += gm.rgb * 0.3 * (0.35 + 0.65 * uNeon); // 구역 색조/네온 반사 페인트
        float wet = clamp(gm.a + 0.25 * n2(p * 0.4), 0.0, 1.0);
        // 반사
        if (uReflOn > 0.5) {
          vec2 ruv = vReflUv.xy / vReflUv.w;
          ruv += (vec2(n2(p * 2.0 + uTime * 0.3), n2(p * 2.0 - uTime * 0.2)) - 0.5) * 0.012;
          vec3 refl = texture2D(uRefl, ruv).rgb;
          col += refl * (0.18 + 0.55 * wet);
        }
        // 빗방울 파문
        vec2 rc = floor(p * 1.3);
        float rt = fract(uTime * 0.8 + h(rc) * 10.0);
        float rd = length(fract(p * 1.3) - 0.5 - (vec2(h(rc + 1.0), h(rc + 2.0)) - 0.5) * 0.5);
        col += vec3(0.25, 0.3, 0.5) * wet * smoothstep(0.02, 0.0, abs(rd - rt * 0.45)) * (1.0 - rt) * 0.08;
        col *= mix(0.35, 1.0, visAt(vWorld));
        // 데이터 붕괴 구역
        float dz = length(p - uZone.xy) - uZone.z;
        if (dz > 0.0) {
          float blocks = step(0.85, h(floor(p * 1.5) + floor(uTime * 6.0)));
          col = mix(col, vec3(0.1, 0.0, 0.06), 0.4) + vec3(0.5, 0.04, 0.3) * blocks * 0.05 * smoothstep(0.0, 3.0, dz);
        }
        col += vec3(1.0, 0.15, 0.6) * smoothstep(0.3, 0.0, abs(dz)) * 1.2;
        if (uNext.w > 0.5) {
          float dn = abs(length(p - uNext.xy) - uNext.z);
          float ang = atan(p.y - uNext.y, p.x - uNext.x);
          float dash = step(0.5, fract(ang * uNext.z * 0.5 / 3.14159 * 2.0 - uTime * 0.5));
          col += vec3(0.9, 0.95, 1.0) * smoothstep(0.12, 0.0, dn) * dash * 0.9;
        }
        // 맵 경계 밖
        float r = length(p);
        col *= 1.0 - smoothstep(42.0, 46.0, r) * 0.7;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

/** 데이터 붕괴 경계: 글리치 벽 */
export function zoneWallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uColor: { value: new THREE.Color(1.0, 0.1, 0.55) } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vWorld; void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vWorld;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main() {
        float y = vUv.y;
        float bars = step(0.5, h(vec2(floor(vUv.x * 120.0), floor(y * 18.0 - uTime * 4.0))));
        float glitch = step(0.93, h(vec2(floor(uTime * 15.0), floor(y * 40.0))));
        float scan = 0.5 + 0.5 * sin(y * 120.0 + uTime * 10.0);
        float fade = (1.0 - y) * (1.0 - y);
        float a = (0.05 + bars * 0.09 + glitch * 0.3) * fade * (0.7 + 0.3 * scan);
        a += smoothstep(0.04, 0.0, y) * 0.8;
        vec3 c = mix(uColor, vec3(0.2, 0.9, 1.0), glitch * step(0.5, h(vec2(floor(uTime * 20.0), 3.0))));
        gl_FragColor = vec4(c * 1.8, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
}

/** 바닥 데칼: 장판, 경고, 조준 표시 (kind 별 패턴) */
export function decalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: G.uTime, uColor: { value: new THREE.Color(1, 0.2, 0.3) }, uKind: { value: 0 }, uProgress: { value: 0 }, uAlpha: { value: 1 },
      uShape: { value: 0 }, uAngle: { value: 1 }, uAspect: { value: 1 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uKind; uniform float uProgress; uniform float uAlpha; uniform float uShape; uniform float uAngle; uniform float uAspect;
      varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float r = length(c);
        float ang = atan(c.y, c.x);
        float a = 0.0; vec3 col = uColor;
        if (uShape < 0.5) { // 원
          if (r > 1.0) discard;
          float ring = smoothstep(0.06, 0.0, abs(r - 0.97));
          float fill = step(r, uProgress) * 0.35 + 0.12;
          if (uKind < 0.5) { // 경고
            a = ring * 0.9 + fill + smoothstep(0.03, 0.0, abs(r - uProgress)) * 0.8;
          } else if (uKind < 1.5) { // 장판 일반 (회전 링)
            float sw = 0.5 + 0.5 * sin(ang * 6.0 + uTime * 6.0 - r * 8.0);
            a = ring * 0.8 + sw * 0.18 * r + 0.06;
          } else if (uKind < 2.5) { // 중력/블랙홀 소용돌이
            float sw = 0.5 + 0.5 * sin(ang * 5.0 - log(r + 0.05) * 6.0 + uTime * 5.0);
            a = ring * 0.6 + sw * 0.35 * (1.0 - r) + 0.08;
            if (uProgress > 0.5) { col = mix(col, vec3(0.0), smoothstep(0.35, 0.0, r)); a += smoothstep(0.35, 0.0, r) * 0.9; }
          } else if (uKind < 3.5) { // 거미줄
            float spokes = smoothstep(0.04, 0.0, abs(fract(ang / 6.2832 * 12.0) - 0.5) * 0.1 * r * 10.0 - 0.0) ;
            float rings = smoothstep(0.04, 0.0, abs(fract(r * 6.0) - 0.5) - 0.44);
            a = ring * 0.8 + (spokes * 0.5 + rings * 0.6) * 0.6 + 0.05;
          } else if (uKind < 4.5) { // 해킹 격자
            vec2 g = abs(fract(c * 6.0) - 0.5);
            float grid = smoothstep(0.06, 0.0, 0.5 - max(g.x, g.y));
            float glyph = step(0.75, h(floor(c * 6.0) + floor(uTime * 4.0)));
            a = ring * 0.8 + grid * 0.35 + glyph * 0.25 + 0.05;
          } else { // 조준 표시 (아군/내 것)
            a = ring * 0.9 + 0.08 + smoothstep(0.02, 0.0, abs(fract(r * 4.0 - uTime) - 0.5) - 0.47) * 0.15;
          }
        } else if (uShape < 1.5) { // 부채꼴 (원점 = 아래 중앙 기준이 아니라 중심 기준, +x 방향)
          if (r > 1.0) discard;
          if (abs(ang) > uAngle * 0.5) discard;
          float edge = smoothstep(0.05, 0.0, abs(abs(ang) - uAngle * 0.5) * r) + smoothstep(0.05, 0.0, abs(r - 0.97));
          float fill = step(r, uProgress) * 0.3 + 0.1;
          a = edge * 0.8 + fill;
        } else { // 직선 (uv.x: 길이 방향 0..1)
          float y = abs(vUv.y - 0.5) * 2.0;
          float edge = smoothstep(0.1, 0.0, abs(y - 0.95));
          float fill = step(vUv.x, uProgress) * 0.3 + 0.1;
          float chev = smoothstep(0.08, 0.0, abs(fract(vUv.x * uAspect * 0.5 - y * 0.3 - uTime * 1.5) - 0.5) - 0.4) * 0.25;
          a = edge * 0.7 + fill + chev;
        }
        gl_FragColor = vec4(col * 1.6, clamp(a, 0.0, 1.0) * uAlpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** 발광 스프라이트 (빛 번짐) */
export function glowSpriteMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2); gl_FragColor = vec4(uColor * 2.0, a * uAlpha); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
