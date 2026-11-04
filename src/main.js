// Bluewave — real-time spectral ocean in a water column.
// Surface: sum of up to 64 Gerstner waves sampled from a fetch-limited JONSWAP
// spectrum (wind sea) plus a narrow-band swell and an optional travelling
// rogue crest. Shading: sky reflection with Fresnel, GGX sun glint, crest
// subsurface scattering, Jacobian foam, procedural capillary ripples.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAX_WAVES = 64;
const G = 9.81;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- params
const PRESETS = {
  calm:     { windKn: 6,  fetchKm: 3,   spread: 40, chop: 0.6,  foam: 0.3,  swellH: 0.12, swellLen: 30,  size: 30,  depth: 10 },
  moderate: { windKn: 12, fetchKm: 10,  spread: 30, chop: 0.85, foam: 0.55, swellH: 0.25, swellLen: 38,  size: 40,  depth: 14 },
  fresh:    { windKn: 22, fetchKm: 40,  spread: 26, chop: 1.0,  foam: 0.75, swellH: 0.8,  swellLen: 70,  size: 80,  depth: 26 },
  storm:    { windKn: 40, fetchKm: 200, spread: 22, chop: 1.15, foam: 0.95, swellH: 2.4,  swellLen: 170, size: 190, depth: 60 },
};

const params = {
  view: 'column',
  preset: 'moderate',
  windKn: 12, windFrom: 90, fetchKm: 10, spread: 30,
  swellH: 0.25, swellLen: 38, swellFrom: 215,
  chop: 0.85, ripple: 0.6, foam: 0.55,
  rogueH: 6,
  hour: 14.5, bearing: 0, exposure: 1.0,
  deep: '#02283a', scatter: '#1fa3a8', clarity: 0.4, glow: 0.8,
  size: 40, depth: 14, grid: true,
  rate: 1, paused: false, seed: 1,
};

// ---------------------------------------------------------------- renderer
const stage = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  stage.innerHTML = '<div class="fallback"><div><h2>This needs WebGL 2</h2><p>Open the page in a current version of Chrome, Edge, Safari or Firefox with hardware acceleration turned on.</p></div></div>';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color('#0a0d0f');
scene.background = BG;

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.8;

// ---------------------------------------------------------------- uniforms
const U = {
  uWA: { value: new Float32Array(MAX_WAVES * 4) },
  uWB: { value: new Float32Array(MAX_WAVES * 4) },
  uCount: { value: 0 },
  uRogue: { value: new THREE.Vector4(1, 0, -1e4, 0) },
  uRogue2: { value: new THREE.Vector4(10, 1e5, 0.5, 0) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uTime: { value: 0 },
  uDeep: { value: new THREE.Color() },
  uScatter: { value: new THREE.Color() },
  uFoam: { value: 0.5 },
  uRipple: { value: 0.6 },
  uSSS: { value: 0.8 },
  uHs: { value: 0.4 },
  uOpen: { value: 0 },
  uFog: { value: 0.0012 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uSpacing: { value: 0.15 },
  uHalf: { value: 20 },
  uDepth: { value: 14 },
  uAbsorb: { value: 0.15 },
  uGridMinor: { value: 1 },
  uGridOn: { value: 1 },
  uBg: { value: BG.clone() },
};

// ---------------------------------------------------------------- GLSL
const COMMON = /* glsl */`
#define MAX_WAVES ${MAX_WAVES}
#define PI 3.14159265359
uniform vec4 uWA[MAX_WAVES];   // dir.x, dir.z, amplitude, choppiness
uniform vec4 uWB[MAX_WAVES];   // wavenumber k, phase, -, -
uniform int uCount;
uniform vec4 uRogue;           // dir.x, dir.z, position along dir, height
uniform vec4 uRogue2;          // sigma, lateral sigma, compression, active
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uHalf;
uniform float uOpen;

void evalSea(vec2 p, float kMax, out vec3 disp, out vec3 nrm, out float jac) {
  disp = vec3(0.0);
  vec3 sl = vec3(0.0);
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uCount) break;
    vec4 a = uWA[i];
    vec4 b = uWB[i];
    float k = b.x;
    float fade = 1.0 - smoothstep(kMax * 0.5, kMax, k);
    if (fade <= 0.0) continue;
    float A = a.z * fade;
    float th = k * dot(a.xy, p) - b.y;
    float s = sin(th), c = cos(th);
    disp.xz += a.w * A * a.xy * c;
    disp.y += A * s;
    float kA = k * A;
    sl.x += a.x * kA * c;
    sl.z += a.y * kA * c;
    sl.y += a.w * kA * s;
  }
  if (uRogue2.w > 0.5) {
    vec2 D = uRogue.xy;
    vec2 P = vec2(-D.y, D.x);
    float s = dot(p, D) - uRogue.z;
    float pe = dot(p, P);
    float sig = s > 0.0 ? uRogue2.x * 0.6 : uRogue2.x * 1.3;   // steeper face, long back
    float ls = uRogue2.y;
    float ep = exp(-0.5 * pe * pe / (ls * ls));
    float es = exp(-0.5 * s * s / (sig * sig));
    float eta = uRogue.w * es * ep;
    disp.y += eta;
    vec2 grad = D * (-s / (sig * sig) * eta) + P * (-pe / (ls * ls) * eta);
    sl.x += grad.x;
    sl.z += grad.y;
    float rc = uRogue2.z * ep;
    disp.xz += -D * rc * s * es;
    sl.y += rc * es * (1.0 - s * s / (sig * sig));
  }
  nrm = normalize(vec3(-sl.x, max(1.0 - sl.y, 0.08), -sl.z));
  jac = 1.0 - sl.y;
}

vec3 skyColor(vec3 d, float disk) {
  float e = uSunDir.y;
  float day = smoothstep(-0.12, 0.25, e);
  vec3 zen = mix(vec3(0.012, 0.018, 0.04), vec3(0.075, 0.2, 0.5), day);
  vec3 hor = mix(vec3(0.42, 0.2, 0.12), vec3(0.56, 0.68, 0.8), smoothstep(0.02, 0.4, e));
  hor *= mix(0.18, 1.0, day);
  float y = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(hor, zen, pow(y, 0.5));
  float sd = max(dot(normalize(d), uSunDir), 0.0);
  c += uSunColor * (0.06 * pow(sd, 5.0) + 0.16 * pow(sd, 40.0)) * (1.0 - 0.6 * y);
  c += uSunColor * disk * smoothstep(0.99955, 0.99985, sd) * 12.0;
  if (d.y < 0.0) c = mix(c, hor * 0.3, smoothstep(0.0, -0.25, d.y));
  return c;
}

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = m * p; a *= 0.5; }
  return v;
}
`;
const GRID_FN = /* glsl */`
float gridLine(vec2 c) {
  vec2 w = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, 1e-4);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
`;

const SURFACE_VERT = /* glsl */`
${COMMON}
uniform float uSpacing;
attribute float aSpacing;
varying vec2 vP;
varying vec3 vWorld;
varying float vH;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 p = wp.xz;
  float sp = uOpen > 0.5 ? aSpacing : uSpacing;
  vec3 d, n; float j;
  evalSea(p, 2.0 * PI / (sp * 3.0), d, n, j);
  if (uOpen < 0.5) {
    float m = smoothstep(0.0, uHalf * 0.06, uHalf - max(abs(p.x), abs(p.y)));
    d.xz *= m;
  }
  wp += d;
  vP = p;
  vWorld = wp;
  vH = d.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SURFACE_FRAG = /* glsl */`
${COMMON}
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform float uFoam;
uniform float uRipple;
uniform float uSSS;
uniform float uHs;
uniform float uFog;
uniform vec2 uWindDir;
varying vec2 vP;
varying vec3 vWorld;
varying float vH;

void main() {
  vec2 p = vP;
  float fw = max(length(fwidth(p)), 1e-4);
  vec3 d, N; float j;
  evalSea(p, 2.0 * PI / (fw * 3.0), d, N, j);

  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // capillary ripples riding the wind
  float rf = uRipple * exp(-dist * 0.018) * clamp(0.25 / fw, 0.0, 1.0);
  if (rf > 0.002) {
    vec2 q1 = p * 0.9 - uWindDir * uTime * 0.55;
    vec2 q2 = p * 2.3 - vec2(uWindDir.y, -uWindDir.x) * uTime * 0.35 - uWindDir * uTime * 0.8;
    float e = 0.05;
    float a0 = fbm(q1), ax = fbm(q1 + vec2(e, 0.0)), az = fbm(q1 + vec2(0.0, e));
    float b0 = fbm(q2), bx = fbm(q2 + vec2(e, 0.0)), bz = fbm(q2 + vec2(0.0, e));
    vec2 g = vec2(ax - a0, az - a0) / e * 0.9 + vec2(bx - b0, bz - b0) / e * 2.3 * 0.35;
    N = normalize(N + vec3(-g.x, 0.0, -g.y) * 0.16 * rf);
  }
  float ndv = dot(N, V);
  if (ndv < 0.02) N = normalize(N + V * (0.02 - ndv));

  vec3 L = normalize(uSunDir);
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float NdL = clamp(dot(N, L), 0.0, 1.0);
  float sunVis = smoothstep(-0.03, 0.06, L.y);

  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R, 0.0);

  // GGX sun glint
  vec3 Hv = normalize(L + V);
  float NdH = clamp(dot(N, Hv), 0.0, 1.0);
  float rough = 0.07 + 0.05 * clamp(dist * 0.004, 0.0, 1.0);
  float a2 = pow(rough, 4.0);
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float Fs = 0.02 + 0.98 * pow(1.0 - clamp(dot(Hv, V), 0.0, 1.0), 5.0);
  vec3 spec = uSunColor * min(D * Fs * NdL / max(4.0 * NdV, 0.15), 60.0) * sunVis;

  // body colour + crest subsurface scattering
  vec3 amb = skyColor(vec3(0.0, 1.0, 0.0), 0.0) * 0.55 + skyColor(normalize(vec3(V.x, 0.15, V.z)), 0.0) * 0.45;
  float hgt = clamp(vH / (uHs + 0.05) * 0.7 + 0.35, 0.0, 2.5);
  float k1 = hgt * pow(clamp(dot(L, -V) * 0.5 + 0.5, 0.0, 1.0), 4.0) * pow(0.5 - 0.5 * dot(L, N), 3.0);
  float k2 = pow(NdV, 2.0);
  vec3 sss = uScatter * uSunColor * (k1 * uSSS * 3.2 + k2 * 0.1 + NdL * 0.05) * sunVis;
  vec3 body = uDeep * (amb * 0.5 + 0.03) + sss + uScatter * amb * 0.05 * hgt;

  vec3 col = mix(body, refl, F) + spec;

  // whitecaps from surface compression
  float fm = clamp((1.0 - smoothstep(0.15, 0.85, j)) * uFoam * 1.6, 0.0, 1.0);
  float pat = fbm(p * 1.4 + uWindDir * uTime * 0.25) * 0.65 + fbm(p * 4.5 - uWindDir * uTime * 0.4) * 0.45;
  float foam = smoothstep(0.55, 0.85, pat + fm * 0.55) * fm;
  foam += smoothstep(0.82, 0.95, pat) * uFoam * 0.12 * hgt * 0.5;
  vec3 foamCol = vec3(0.9, 0.94, 0.95) * (amb * 0.75 + uSunColor * (NdL * 0.55 + 0.1) * sunVis);
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0));

  if (uOpen > 0.5) {
    vec3 fogc = skyColor(normalize(vec3(-V.x, 0.02, -V.z)), 0.0);
    col = mix(col, fogc, 1.0 - exp(-dist * uFog));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WALL_VERT = /* glsl */`
${COMMON}
uniform float uSpacing;
uniform float uDepth;
attribute float aTop;
attribute float aU;
varying vec3 vWorld;
varying float vSurf;
varying float vU;
varying vec3 vN;
void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 d, n; float j;
  evalSea(wp.xz, 2.0 * PI / (uSpacing * 3.0), d, n, j);
  vSurf = d.y;
  wp.y = aTop > 0.5 ? d.y : -uDepth;
  vWorld = wp;
  vU = aU;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const WALL_FRAG = /* glsl */`
${COMMON}
${GRID_FN}
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform float uAbsorb;
uniform float uGridMinor;
uniform float uGridOn;
uniform float uDepth;
varying vec3 vWorld;
varying float vSurf;
varying float vU;
varying vec3 vN;
void main() {
  float below = max(vSurf - vWorld.y, 0.0);
  vec3 L = normalize(uSunDir);
  float sunVis = smoothstep(-0.03, 0.06, L.y);
  vec3 amb = skyColor(vec3(0.0, 1.0, 0.0), 0.0);

  float t = exp(-below * uAbsorb);
  vec3 lit = uScatter * (amb * 0.5 + uSunColor * sunVis * 0.22 * max(L.y, 0.0) + 0.02);
  vec3 deep = uDeep * (amb * 0.18 + 0.015);
  vec3 col = mix(deep, lit, t);
  col *= 0.78 + 0.4 * max(dot(vN, L), 0.0) * sunVis;

  // light shafts / caustic shimmer near the top
  vec2 cq = vec2(vU * 0.35, vWorld.y * 0.12) + vec2(uTime * 0.05, uTime * 0.02);
  float shaft = fbm(vec2(vU * 0.6 + vWorld.y * 0.15 * L.x, uTime * 0.12));
  float caust = pow(fbm(cq * 3.0 + vec2(0.0, uTime * 0.25)), 3.0) * 2.2;
  col += uScatter * uSunColor * (caust * 0.25 + smoothstep(0.45, 0.9, shaft) * 0.12) * exp(-below * uAbsorb * 1.4) * sunVis;

  // meniscus glow where the surface meets the glass
  col += uScatter * 0.9 * exp(-below * 7.0) * (amb + uSunColor * 0.4 * sunVis);
  col += vec3(0.75, 0.9, 0.92) * smoothstep(0.06, 0.0, below) * 0.18;

  // measurement grid: minor lines + heavy line every 5
  if (uGridOn > 0.5) {
    vec2 gc = vec2(vU, vWorld.y) / uGridMinor;
    float minor = gridLine(gc);
    float major = gridLine(gc / 5.0);
    float zero = 1.0 - min(abs(vWorld.y) / max(fwidth(vWorld.y), 1e-4), 1.0);
    vec3 gcol = vec3(0.82, 0.94, 0.92);
    col = mix(col, gcol, minor * 0.035 + major * 0.12 + zero * 0.12);
  }

  // faint glass reflection
  vec3 V = normalize(cameraPosition - vWorld);
  float fr = 0.03 + 0.25 * pow(1.0 - clamp(dot(vN, V), 0.0, 1.0), 5.0);
  col = mix(col, skyColor(reflect(-V, vN), 0.0), fr * 0.5);

  // darker toward the floor
  col *= mix(0.55, 1.0, smoothstep(-uDepth, -uDepth * 0.4, vWorld.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FLOOR_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FLOOR_FRAG = /* glsl */`
uniform vec3 uBg;
uniform float uHalf;
uniform float uGridMinor;
uniform float uGridOn;
varying vec3 vWorld;
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float gridLine(vec2 c) {
  vec2 w = fwidth(c);
  vec2 g = abs(fract(c - 0.5) - 0.5) / max(w, 1e-4);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  vec2 p = vWorld.xz;
  float r = length(p) / (uHalf * 3.2);
  float fade = exp(-r * r * 3.5);
  float sd = max(sdBox(p, vec2(uHalf)), 0.0);
  float shadow = 1.0 - 0.75 * exp(-sd / (uHalf * 0.12));
  vec3 col = uBg * mix(1.0, shadow, fade);
  if (uGridOn > 0.5) {
    float minor = gridLine(p / uGridMinor);
    float major = gridLine(p / (uGridMinor * 5.0));
    col += vec3(0.8, 0.92, 0.9) * (minor * 0.006 + major * 0.02) * fade;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FRAG = /* glsl */`
${COMMON}
varying vec3 vDir;
void main() {
  vec3 col = skyColor(normalize(vDir), 1.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------- materials
const surfaceMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG, side: THREE.DoubleSide });
const wallMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, side: THREE.DoubleSide });
const floorMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG });
const skyMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false });

// ---------------------------------------------------------------- geometry
function gridGeometry(n, mapFn) {
  const verts = (n + 1) * (n + 1);
  const pos = new Float32Array(verts * 3);
  const spacing = new Float32Array(verts);
  const coord = (i) => mapFn(i / n * 2 - 1);
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(coord(i));
  const sp = xs.map((x, i) => Math.abs((xs[Math.min(i + 1, n)] - xs[Math.max(i - 1, 0)]) / (i === 0 || i === n ? 1 : 2)));
  let v = 0;
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      pos[v * 3] = xs[x]; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = xs[z];
      spacing[v] = Math.max(sp[x], sp[z]);
      v++;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let k = 0;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSpacing', new THREE.BufferAttribute(spacing, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function wallGeometry(half, n) {
  const sides = [
    { from: [-half, half], to: [half, half], normal: [0, 0, 1] },
    { from: [half, half], to: [half, -half], normal: [1, 0, 0] },
    { from: [half, -half], to: [-half, -half], normal: [0, 0, -1] },
    { from: [-half, -half], to: [-half, half], normal: [-1, 0, 0] },
  ];
  const pos = [], nrm = [], top = [], u = [], idx = [];
  let base = 0;
  sides.forEach((s) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = s.from[0] + (s.to[0] - s.from[0]) * t;
      const z = s.from[1] + (s.to[1] - s.from[1]) * t;
      const along = (s.normal[0] !== 0 ? z : x);
      for (const tp of [1, 0]) {
        pos.push(x, 0, z); nrm.push(...s.normal); top.push(tp); u.push(along);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
    base += (n + 1) * 2;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
  g.setIndex(idx);
  return g;
}

const COLUMN_SEGS = 320;
const columnSurface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMat);
const walls = new THREE.Mesh(new THREE.BufferGeometry(), wallMat);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), floorMat);
columnSurface.frustumCulled = walls.frustumCulled = false;

// open sea: dense near the centre, stretching to ~4 km at the rim
const OPEN_R = 4000;
const openSurface = new THREE.Mesh(
  gridGeometry(512, (u) => Math.sign(u) * OPEN_R * (0.034 * Math.abs(u) + 0.966 * Math.pow(Math.abs(u), 5))),
  surfaceMat,
);
openSurface.frustumCulled = false;
const sky = new THREE.Mesh(new THREE.SphereGeometry(10000, 48, 24), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -1;

scene.add(columnSurface, walls, floor, openSurface, sky);

function gridStep(size) { return size <= 60 ? 1 : size <= 140 ? 2 : 5; }

function rebuildColumn() {
  const half = params.size / 2;
  columnSurface.geometry.dispose();
  walls.geometry.dispose();
  columnSurface.geometry = gridGeometry(COLUMN_SEGS, (u) => u * half);
  walls.geometry = wallGeometry(half, COLUMN_SEGS);
  floor.position.y = -params.depth - 0.002;
  U.uSpacing.value = params.size / COLUMN_SEGS;
  U.uHalf.value = half;
  U.uDepth.value = params.depth;
  U.uGridMinor.value = gridStep(params.size);
}

function applyView() {
  const open = params.view === 'open';
  columnSurface.visible = walls.visible = floor.visible = !open;
  openSurface.visible = sky.visible = open;
  U.uOpen.value = open ? 1 : 0;
  document.body.classList.toggle('open-water', open);
  scene.background = open ? null : BG;
  controls.maxPolarAngle = open ? Math.PI / 2 - 0.03 : Math.PI * 0.5;
  controls.minDistance = open ? 4 : params.size * 0.35;
  controls.maxDistance = open ? 900 : params.size * 7;
  document.querySelector('.spec .eyebrow').textContent = open ? 'Study 01 · open water' : 'Study 01 · water column';
}

// ---------------------------------------------------------------- spectrum
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

const N_WIND = 54, N_SWELL = 8;
const omega = new Float32Array(MAX_WAVES);
const phase = new Float32Array(MAX_WAVES);
const stats = { hs: 0, tp: 0, lp: 0, count: 0, wp: 1 };

function buildSea(resetPhase) {
  const r = mulberry(params.seed * 7919 + 13);
  const U10 = Math.max(params.windKn * 0.5144, 0.4);
  const F = Math.max(params.fetchKm, 0.5) * 1000;
  const wp = 22 * Math.cbrt((G * G) / (U10 * F));
  const alpha = 0.076 * Math.pow((U10 * U10) / (F * G), 0.22);
  const travel = (params.windFrom + 180) * DEG;
  const wmin = wp * 0.55, wmax = wp * 6.5;
  const lr = Math.log(wmax / wmin);
  const WA = U.uWA.value, WB = U.uWB.value;
  let i = 0, m0w = 0, m0s = 0;

  for (let n = 0; n < N_WIND; n++, i++) {
    const jit = r(), g1 = gauss(r);
    const w0 = wmin * Math.exp((lr * n) / N_WIND);
    const w1 = wmin * Math.exp((lr * (n + 1)) / N_WIND);
    const w = wmin * Math.exp((lr * (n + jit)) / N_WIND);
    const sig = w <= wp ? 0.07 : 0.09;
    const peak = Math.exp(-((w - wp) ** 2) / (2 * sig * sig * wp * wp));
    const S = ((alpha * G * G) / w ** 5) * Math.exp(-1.25 * (wp / w) ** 4) * Math.pow(3.3, peak);
    const A = Math.sqrt(2 * S * (w1 - w0)) * (params.windKn < 0.1 ? 0 : 1);
    const spreadRad = params.spread * DEG * (1 + 0.5 * Math.max(0, w / wp - 1));
    const ang = travel + g1 * spreadRad * 0.5;
    WA[i * 4] = Math.sin(ang); WA[i * 4 + 1] = -Math.cos(ang); WA[i * 4 + 2] = A; WA[i * 4 + 3] = params.chop;
    WB[i * 4] = (w * w) / G;
    omega[i] = w;
    m0w += (A * A) / 2;
  }

  const sTravel = (params.swellFrom + 180) * DEG;
  const As = params.swellH / Math.sqrt(8 * N_SWELL);
  for (let n = 0; n < N_SWELL; n++, i++) {
    const g1 = gauss(r), g2 = r();
    const lam = params.swellLen * (1 + (n - (N_SWELL - 1) / 2) * 0.03 + (g2 - 0.5) * 0.01);
    const k = TAU / lam;
    const ang = sTravel + g1 * 3 * DEG;
    WA[i * 4] = Math.sin(ang); WA[i * 4 + 1] = -Math.cos(ang); WA[i * 4 + 2] = As; WA[i * 4 + 3] = params.chop * 0.7;
    WB[i * 4] = k;
    omega[i] = Math.sqrt(G * k);
    m0s += (As * As) / 2;
  }
  U.uCount.value = i;
  for (let n = i; n < MAX_WAVES; n++) { WA[n * 4 + 2] = 0; WB[n * 4] = 0; }

  if (resetPhase) {
    const rp = mulberry(params.seed * 104729 + 7);
    for (let n = 0; n < MAX_WAVES; n++) phase[n] = rp() * TAU;
  }
  for (let n = 0; n < MAX_WAVES; n++) WB[n * 4 + 1] = phase[n];

  stats.count = i;
  stats.wp = wp;
  stats.hs = 4 * Math.sqrt(m0w + m0s);
  const swellDominant = m0s > m0w;
  stats.tp = swellDominant ? TAU / Math.sqrt((G * TAU) / params.swellLen) : TAU / wp;
  stats.lp = (G * stats.tp * stats.tp) / TAU;
  U.uHs.value = stats.hs;
  U.uWindDir.value.set(Math.sin(travel), -Math.cos(travel));
}

// ---------------------------------------------------------------- rogue wave
const rogue = { active: false, pos: 0, end: 0, c: 1, ramp: 1 };
function sendRogue() {
  const open = params.view === 'open';
  const lam = open ? Math.max(stats.lp * 2.2, 60) : THREE.MathUtils.clamp(params.size * 0.55, 14, 160);
  const sigma = lam / 4;
  const dirA = (params.windFrom + 180) * DEG;
  const reach = open ? 260 : (params.size / 2) * 1.42;
  rogue.active = true;
  rogue.pos = -(reach + sigma * 2.2);
  rogue.end = reach + sigma * 4;
  rogue.c = Math.sqrt((G * lam) / TAU) * 1.3;
  rogue.ramp = open ? 0 : 1;
  U.uRogue.value.set(Math.sin(dirA), -Math.cos(dirA), rogue.pos, 0);
  U.uRogue2.value.set(sigma, open ? 140 : 1e5, Math.min(0.8, 0.3 + 0.4 * params.chop), 1);
}
function updateRogue(dt) {
  if (!rogue.active) return;
  rogue.pos += rogue.c * dt;
  const span = rogue.end * 2;
  const t = (rogue.pos + rogue.end) / span;
  const env = params.view === 'open' ? Math.min(1, t / 0.25, (1 - t) / 0.25) : 1;
  const h = params.rogueH * Math.max(0, env);
  U.uRogue.value.z = rogue.pos;
  U.uRogue.value.w = h;
  if (rogue.pos > rogue.end) { rogue.active = false; U.uRogue2.value.w = 0; }
}

// ---------------------------------------------------------------- light & colour
function sunElevation(h) { return 62 * Math.sin((Math.PI * (h - 6)) / 13); }
function sunAngles() {
  const h = params.hour;
  const el = sunElevation(h);
  const az = 90 + ((h - 6) / 13) * 180 + params.bearing;
  return { el, az };
}
function applyLight() {
  const { el, az } = sunAngles();
  const e = el * DEG, a = az * DEG;
  U.uSunDir.value.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
  const s = Math.sin(e);
  const day = THREE.MathUtils.smoothstep(s, -0.06, 0.2);
  const warmth = THREE.MathUtils.smoothstep(s, 0.0, 0.45);
  const warm = new THREE.Color(1.0, 0.42, 0.16), white = new THREE.Color(1.0, 0.95, 0.88);
  U.uSunColor.value.copy(warm).lerp(white, warmth).multiplyScalar(0.1 + 3.2 * day);
  renderer.toneMappingExposure = params.exposure;
}
function applyWater() {
  U.uDeep.value.set(params.deep);
  U.uScatter.value.set(params.scatter);
  U.uFoam.value = params.foam;
  U.uRipple.value = params.ripple;
  U.uSSS.value = params.glow;
  U.uAbsorb.value = THREE.MathUtils.lerp(0.6, 0.03, params.clarity) * (40 / Math.max(params.size, 20)) ** 0.5;
  U.uGridOn.value = params.grid ? 1 : 0;
}

// ---------------------------------------------------------------- camera
const DEFAULT_DIR = new THREE.Vector3(0.66, 0.5, 0.56).normalize();
function resetCamera() {
  if (params.view === 'open') {
    controls.target.set(0, 1.5, 0);
    camera.position.set(-38, 11, 52);
  } else {
    controls.target.set(0, -params.depth * 0.32, 0);
    camera.position.copy(controls.target).addScaledVector(DEFAULT_DIR, params.size * 2.6 * (camera.aspect < 0.8 ? 1.45 : 1));
  }
  controls.update();
}
function rescaleCamera(oldSize) {
  const off = camera.position.clone().sub(controls.target).multiplyScalar(params.size / oldSize);
  controls.target.set(0, -params.depth * 0.32, 0);
  camera.position.copy(controls.target).add(off);
  controls.update();
}

// ---------------------------------------------------------------- HUD
const $ = (id) => document.getElementById(id);
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const fmtClock = (h) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };
function douglas(hs) {
  if (hs < 0.02) return 'glassy calm';
  if (hs < 0.1) return 'rippled sea';
  if (hs < 0.5) return 'smooth sea';
  if (hs < 1.25) return 'slight sea';
  if (hs < 2.5) return 'moderate sea';
  if (hs < 4) return 'rough sea';
  if (hs < 6) return 'very rough sea';
  if (hs < 9) return 'high sea';
  if (hs < 14) return 'very high sea';
  return 'phenomenal sea';
}
function updateHud() {
  $('r-state').textContent = douglas(stats.hs);
  $('r-hs').textContent = `${stats.hs.toFixed(2)} m`;
  $('r-tp').textContent = `${stats.tp.toFixed(1)} s`;
  $('r-lp').textContent = `${stats.lp < 10 ? stats.lp.toFixed(1) : Math.round(stats.lp)} m`;
  $('r-st').textContent = stats.hs > 0.005 ? `1/${Math.round(stats.lp / stats.hs)}` : '—';
  $('r-wind').textContent = params.windKn < 0.5 ? 'calm' : `${Math.round(params.windKn)} kn from ${compass(params.windFrom)}`;
  const { el } = sunAngles();
  $('r-light').textContent = `${fmtClock(params.hour)} · sun ${Math.round(el)}°`;
  const g = gridStep(params.size);
  $('r-grid').textContent = params.view === 'open' ? 'off in open water' : `${g} m · heavy line ${g * 5} m`;
  $('r-spec').textContent = `JONSWAP ${N_WIND} + swell ${N_SWELL}`;
  $('r-seed').textContent = String(params.seed);
  $('r-engine').textContent = `WebGL2 · three r${THREE.REVISION}`;
}

// ---------------------------------------------------------------- panel
const controlsRoot = $('controls');
const sync = [];
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function group(title, note) {
  const s = el('section', 'grp');
  s.append(el('h3', null, title));
  if (note) s.append(el('p', 'note', note));
  controlsRoot.append(s);
  return s;
}
function slider(parent, key, label, min, max, step, fmt, onInput) {
  const row = el('div', 'row');
  const id = `c-${key}`;
  const lab = el('label', null, label); lab.htmlFor = id;
  const out = el('output'); out.htmlFor = id;
  const inp = el('input'); inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = step;
  const paint = () => {
    inp.value = params[key];
    out.textContent = fmt(params[key]);
    inp.style.setProperty('--p', `${((params[key] - min) / (max - min)) * 100}%`);
  };
  inp.addEventListener('input', () => { params[key] = parseFloat(inp.value); paint(); onInput(); });
  row.append(lab, out, inp);
  parent.append(row);
  sync.push(paint);
  paint();
}
function segmented(parent, key, label, options, onPick, extra) {
  const wrap = el('div');
  wrap.style.display = 'grid'; wrap.style.gap = '6px';
  const head = el('div', 'seg-label'); head.append(el('span', null, label));
  const hint = el('span'); head.append(hint);
  const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', label);
  const btns = options.map(([value, text]) => {
    const b = el('button', null, text); b.type = 'button'; b.id = `c-${key}-${value}`;
    b.addEventListener('click', () => { params[key] = value; paint(); onPick(value); });
    seg.append(b);
    return [value, b];
  });
  const paint = () => { btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(params[key] === v))); hint.textContent = extra ? extra() : ''; };
  wrap.append(head, seg);
  parent.append(wrap);
  sync.push(paint);
  paint();
}
function toggle(parent, key, label, onFlip) {
  const b = el('button', 'toggle'); b.type = 'button'; b.id = `c-${key}`;
  b.append(el('span', null, label), el('i'));
  const paint = () => b.setAttribute('aria-pressed', String(!!params[key]));
  b.addEventListener('click', () => { params[key] = !params[key]; paint(); onFlip(); });
  parent.append(b);
  sync.push(paint);
  paint();
}
function swatch(parent, key, label, onInput) {
  const l = el('label', 'swatch');
  const inp = el('input'); inp.type = 'color'; inp.id = `c-${key}`;
  const small = el('small');
  const paint = () => { inp.value = params[key]; small.textContent = params[key].replace('#', ''); };
  inp.addEventListener('input', () => { params[key] = inp.value; paint(); onInput(); });
  l.append(inp, el('span', null, label), small);
  parent.append(l);
  sync.push(paint);
  paint();
}
function button(parent, label, key, onClick, primary) {
  const b = el('button', primary ? 'btn primary' : 'btn'); b.type = 'button';
  b.append(el('span', null, label));
  if (key) b.append(el('kbd', null, key));
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}
const syncAll = () => sync.forEach((f) => f());

const seaChanged = () => { params.preset = 'custom'; buildSea(false); syncPresetOnly(); updateHud(); };
let syncPresetOnly = () => {};

function applyPreset(name) {
  const p = PRESETS[name];
  const oldSize = params.size;
  Object.assign(params, p, { preset: name });
  rebuildColumn();
  buildSea(false);
  updateHud();
  applyWater();
  applyView();
  if (params.view === 'column') rescaleCamera(oldSize);
  syncAll();
}

function buildPanel() {
  const v = group('View');
  segmented(v, 'view', 'Scene', [['column', 'Water column'], ['open', 'Open sea']], () => { applyView(); resetCamera(); updateHud(); });

  const s = group('Wind sea');
  segmented(s, 'preset', 'Sea state', [['calm', 'Calm'], ['moderate', 'Moderate'], ['fresh', 'Fresh'], ['storm', 'Storm']], (n) => applyPreset(n), () => (params.preset === 'custom' ? 'custom' : ''));
  syncPresetOnly = () => sync[1]();
  slider(s, 'windKn', 'Wind speed', 0, 50, 0.5, (x) => `${x.toFixed(1)} kn`, seaChanged);
  slider(s, 'windFrom', 'Wind from', 0, 359, 1, (x) => `${compass(x)} ${Math.round(x)}°`, seaChanged);
  slider(s, 'fetchKm', 'Fetch', 1, 300, 1, (x) => `${Math.round(x)} km`, seaChanged);
  slider(s, 'spread', 'Directional spread', 5, 80, 1, (x) => `${Math.round(x)}°`, seaChanged);

  const w = group('Swell', 'A long, narrow-band sea from a distant storm, laid over the wind sea.');
  slider(w, 'swellH', 'Swell height', 0, 8, 0.05, (x) => `${x.toFixed(2)} m`, seaChanged);
  slider(w, 'swellLen', 'Swell wavelength', 10, 250, 1, (x) => `${Math.round(x)} m`, seaChanged);
  slider(w, 'swellFrom', 'Swell from', 0, 359, 1, (x) => `${compass(x)} ${Math.round(x)}°`, seaChanged);

  const sh = group('Shape', 'Choppiness pulls the surface toward each crest, sharpening peaks and widening troughs.');
  slider(sh, 'chop', 'Choppiness', 0, 1.5, 0.01, (x) => x.toFixed(2), () => buildSea(false));
  slider(sh, 'ripple', 'Capillary ripples', 0, 1, 0.01, (x) => x.toFixed(2), applyWater);
  slider(sh, 'foam', 'Whitecaps', 0, 1, 0.01, (x) => x.toFixed(2), applyWater);

  const r = group('Rogue wave', 'A single travelling crest, sent along the wind direction.');
  slider(r, 'rogueH', 'Crest height', 1, 30, 0.5, (x) => `${x.toFixed(1)} m`, () => {});
  const rb = el('div', 'btns'); r.append(rb);
  button(rb, 'Send rogue wave', 'W', sendRogue, true);

  const l = group('Light');
  slider(l, 'hour', 'Time of day', 5.5, 19.5, 0.05, (x) => `${fmtClock(x)} · sun ${Math.round(sunElevation(x))}°`, () => { applyLight(); updateHud(); });
  slider(l, 'bearing', 'Sun bearing', -180, 180, 1, (x) => `${x > 0 ? '+' : ''}${Math.round(x)}°`, applyLight);
  slider(l, 'exposure', 'Exposure', 0.3, 2.2, 0.01, (x) => x.toFixed(2), applyLight);

  const c = group('Water');
  const sw = el('div', 'swatches'); c.append(sw);
  swatch(sw, 'deep', 'Deep', applyWater);
  swatch(sw, 'scatter', 'Scatter', applyWater);
  slider(c, 'glow', 'Crest glow', 0, 2, 0.01, (x) => x.toFixed(2), applyWater);
  slider(c, 'clarity', 'Clarity', 0, 1, 0.01, (x) => x.toFixed(2), applyWater);

  const col = group('Column');
  slider(col, 'size', 'Width', 20, 220, 1, (x) => `${Math.round(x)} m`, (() => {
    let last = params.size;
    return () => { rebuildColumn(); applyWater(); applyView(); if (params.view === 'column') rescaleCamera(last); last = params.size; updateHud(); };
  })());
  slider(col, 'depth', 'Depth', 3, 90, 0.5, (x) => `${x.toFixed(1)} m`, () => { rebuildColumn(); });
  toggle(col, 'grid', 'Measurement grid', applyWater);

  const t = group('Time');
  slider(t, 'rate', 'Playback rate', 0, 2, 0.01, (x) => `${x.toFixed(2)}×`, () => {});
  const tb = el('div', 'btns'); t.append(tb);
  pauseBtn = button(tb, 'Pause', 'Space', togglePause);
  button(tb, 'New sea', 'R', newSea);
}
let pauseBtn;
function togglePause() {
  params.paused = !params.paused;
  pauseBtn.firstChild.textContent = params.paused ? 'Play' : 'Pause';
  $('paused-tag').hidden = !params.paused;
}
function newSea() {
  params.seed += 1;
  buildSea(true);
  updateHud();
}

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.key === 'r' || e.key === 'R') newSea();
  else if (e.key === 'w' || e.key === 'W') sendRogue();
});
renderer.domElement.addEventListener('dblclick', resetCamera);

const panel = $('panel');
const sheetBtn = $('sheet-toggle');
if (window.matchMedia('(max-width: 760px)').matches) panel.classList.add('collapsed');
sheetBtn.addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  sheetBtn.textContent = panel.classList.contains('collapsed') ? 'Controls' : 'Hide';
});
sheetBtn.textContent = panel.classList.contains('collapsed') ? 'Controls' : 'Hide';

function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 52 : 38;
  // keep the subject centred in the space left of the docked panel
  const shift = w > 760 ? 160 : 0;
  if (shift) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------------------------------------------------------------- boot
buildPanel();
rebuildColumn();
buildSea(true);
applyLight();
applyWater();
applyView();
resize();
resetCamera();
updateHud();

let lastT = performance.now();
let simTime = 0, frames = 0, fpsAcc = 0, hudAcc = 0;
window.__sea = { params, U, rogue, stats, get time() { return simTime; } };
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const raw = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  const dt = params.paused ? 0 : raw * params.rate;
  simTime += dt;
  U.uTime.value = simTime;
  const WB = U.uWB.value;
  for (let i = 0; i < stats.count; i++) {
    phase[i] = (phase[i] + omega[i] * dt) % TAU;
    WB[i * 4 + 1] = phase[i];
  }
  updateRogue(dt);
  controls.update();
  if (params.view === 'open' && camera.position.y < 2.5) camera.position.y = 2.5;
  renderer.render(scene, camera);

  frames++; fpsAcc += raw; hudAcc += raw;
  if (fpsAcc > 0.5) { $('r-fps').textContent = `${Math.round(frames / fpsAcc)} fps`; frames = 0; fpsAcc = 0; }
  if (hudAcc > 0.25) {
    hudAcc = 0;
    const s = Math.floor(simTime);
    $('r-time').textContent = `T+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
});
