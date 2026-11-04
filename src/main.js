// Blue Wave — real-time spectral ocean in a water column.
// Surface: sum of up to 64 Gerstner waves sampled from a fetch-limited JONSWAP
// spectrum (wind sea) plus a narrow-band swell and an optional travelling
// rogue crest. Shading: sky reflection with Fresnel, GGX sun glint, crest
// subsurface scattering, Jacobian foam, procedural capillary ripples.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWildlife, SPECIES, ICONS } from './wildlife.js';

const MAX_WAVES = 64;
const G = 9.81;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- params
const PRESETS = {
  calm:     { windKn: 10, fetchKm: 8,   spread: 36, chop: 0.7,  foam: 0.35, swellH: 0.6,  swellLen: 40,  size: 36,  depth: 12 },
  moderate: { windKn: 20, fetchKm: 30,  spread: 28, chop: 0.95, foam: 0.6,  swellH: 2.6,  swellLen: 34,  size: 44,  depth: 15 },
  fresh:    { windKn: 28, fetchKm: 60,  spread: 26, chop: 1.05, foam: 0.75, swellH: 2.2,  swellLen: 75,  size: 80,  depth: 26 },
  storm:    { windKn: 40, fetchKm: 200, spread: 22, chop: 1.15, foam: 0.95, swellH: 3.5,  swellLen: 170, size: 190, depth: 60 },
};

const params = {
  view: 'column',
  preset: 'moderate',
  windKn: 20, windFrom: 90, fetchKm: 30, spread: 28,
  swellH: 2.6, swellLen: 34, swellFrom: 215,
  chop: 0.95, ripple: 0.6, foam: 0.6,
  rogueH: 8,
  hour: 14.5, bearing: 0, exposure: 1.0,
  deep: '#02283a', scatter: '#1fa3a8', clarity: 0.62, glow: 0.8,
  size: 44, depth: 15, grid: true,
  rate: 1, paused: false, seed: 1,
  tab: 'sea',
};
const wild = {
  enabled: true, activity: 0.8, scale: 1, absorb: 1, amount: 1,
  on: Object.fromEntries(SPECIES.map((d) => [d.id, true])),
  n: Object.fromEntries(SPECIES.map((d) => [d.id, d.def])),
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
  uSurfAlpha: { value: 0.6 },
  uWaterCol: { value: new THREE.Color() },
};

// lights for the textured animal models
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x0b2a3a, 1.2);
const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
scene.add(hemi, sunLight, sunLight.target);

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
uniform float uSurfAlpha;
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

  // see-through water: transmission falls with Fresnel and foam
  float alpha = mix(uSurfAlpha, 1.0, clamp(F * 1.6 + foam * 1.2 + spec.r * 0.05, 0.0, 1.0));
  if (!gl_FrontFacing && uOpen > 0.5) discard;
  if (!gl_FrontFacing) {
    // seen from below through the glass: bright, milky underside
    col = uScatter * (amb * 0.45 + uSunColor * 0.3 * sunVis) + uDeep * 0.08 + foamCol * foam * 0.4;
    alpha = 0.82;
  }
  if (uOpen > 0.5) {
    vec3 fogc = skyColor(normalize(vec3(-V.x, 0.02, -V.z)), 0.0);
    float fg = 1.0 - exp(-dist * uFog);
    col = mix(col, fogc, fg);
    alpha = mix(alpha, 1.0, smoothstep(0.0, 0.5, fg) );
    alpha = mix(alpha, 1.0, smoothstep(22.0, 70.0, dist));
  }
  gl_FragColor = vec4(col, alpha);
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
uniform float uSide;
varying vec3 vWorld;
varying float vSurf;
varying float vU;
varying vec3 vN;
void main() {
  vec3 Vw = normalize(cameraPosition - vWorld);
  if (dot(vN, Vw) * uSide < 0.0) discard;
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

  // glass: clear near the surface, denser with depth; far walls seen from inside are darker
  float alpha = mix(0.3, 0.82, 1.0 - t) + 0.45 * exp(-below * 6.0);
  if (uGridOn > 0.5) alpha += 0.12;
  if (uSide < 0.0) { col *= 0.75; alpha = 0.9; }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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
const surfaceMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG, side: THREE.DoubleSide, transparent: true });
const wallMat = (side) => new THREE.ShaderMaterial({ uniforms: { ...U, uSide: { value: side } }, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, side: THREE.DoubleSide, transparent: true, depthWrite: false });
const SEABED_FRAG = /* glsl */`
${COMMON}
uniform vec3 uDeep;
uniform vec3 uScatter;
varying vec3 vWorld;
void main() {
  vec3 amb = skyColor(vec3(0.0, 1.0, 0.0), 0.0);
  float sunVis = smoothstep(-0.03, 0.06, uSunDir.y);
  float caust = pow(fbm(vWorld.xz * 0.35 + vec2(uTime * 0.12, uTime * 0.08)), 3.0) * 2.5;
  vec3 col = uDeep * (amb * 0.16 + 0.012) + uScatter * uSunColor * caust * 0.02 * sunVis * (1.0 - uOpen);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const seabedMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: FLOOR_VERT, fragmentShader: SEABED_FRAG });
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
const walls = new THREE.Mesh(new THREE.BufferGeometry(), wallMat(1));
const wallsBack = new THREE.Mesh(walls.geometry, wallMat(-1));
const seabed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), seabedMat);
wallsBack.frustumCulled = seabed.frustumCulled = false;
wallsBack.renderOrder = 1;
columnSurface.renderOrder = 2;
walls.renderOrder = 3;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), floorMat);
columnSurface.frustumCulled = walls.frustumCulled = false;

// open sea: dense near the centre, stretching to ~4 km at the rim
const OPEN_R = 4000;
const openSurface = new THREE.Mesh(
  gridGeometry(512, (u) => Math.sign(u) * OPEN_R * (0.034 * Math.abs(u) + 0.966 * Math.pow(Math.abs(u), 5))),
  surfaceMat,
);
openSurface.frustumCulled = false;
openSurface.renderOrder = 2;
const sky = new THREE.Mesh(new THREE.SphereGeometry(10000, 48, 24), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -1;

scene.add(columnSurface, walls, wallsBack, seabed, floor, openSurface, sky);

function gridStep(size) { return size <= 60 ? 1 : size <= 140 ? 2 : 5; }

function rebuildColumn() {
  const half = params.size / 2;
  columnSurface.geometry.dispose();
  walls.geometry.dispose();
  columnSurface.geometry = gridGeometry(COLUMN_SEGS, (u) => u * half);
  walls.geometry = wallGeometry(half, COLUMN_SEGS);
  wallsBack.geometry = walls.geometry;
  floor.position.y = -params.depth - 0.002;
  placeSeabed();
  U.uSpacing.value = params.size / COLUMN_SEGS;
  U.uHalf.value = half;
  U.uDepth.value = params.depth;
  U.uGridMinor.value = gridStep(params.size);
}

function placeSeabed() {
  if (params.view === 'open') { seabed.scale.set(8000, 1, 8000); seabed.position.y = -45; }
  else { seabed.scale.set(params.size, 1, params.size); seabed.position.y = -params.depth + 0.01; }
}
function applyView() {
  const open = params.view === 'open';
  columnSurface.visible = walls.visible = wallsBack.visible = floor.visible = !open;
  placeSeabed();
  openSurface.visible = sky.visible = open;
  U.uOpen.value = open ? 1 : 0;
  document.body.classList.toggle('open-water', open);
  scene.background = open ? null : BG;
  controls.maxPolarAngle = open ? Math.PI / 2 - 0.03 : Math.PI * 0.5;
  controls.minDistance = open ? 4 : params.size * 0.35;
  controls.maxDistance = open ? 900 : params.size * 7;
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

// CPU copy of the surface height (horizontal displacement ignored) for animals
function seaHeight(x, z) {
  const WA = U.uWA.value, WB = U.uWB.value;
  let h = 0;
  for (let i = 0; i < stats.count; i++) {
    const A = WA[i * 4 + 2];
    if (A === 0) continue;
    h += A * Math.sin(WB[i * 4] * (WA[i * 4] * x + WA[i * 4 + 1] * z) - WB[i * 4 + 1]);
  }
  const r = U.uRogue.value, r2 = U.uRogue2.value;
  if (r2.w > 0.5 && r.w > 0) {
    const sd = x * r.x + z * r.y - r.z, pe = -x * r.y + z * r.x;
    const sig = sd > 0 ? r2.x * 0.6 : r2.x * 1.3;
    h += r.w * Math.exp((-0.5 * sd * sd) / (sig * sig)) * Math.exp((-0.5 * pe * pe) / (r2.y * r2.y));
  }
  return h;
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
  sunLight.position.copy(U.uSunDir.value).multiplyScalar(100);
  sunLight.color.copy(warm).lerp(white, warmth);
  sunLight.intensity = 0.05 + 2.6 * day;
  hemi.intensity = 0.15 + 1.1 * day;
  hemi.color.setRGB(0.55 + 0.2 * warmth, 0.62 + 0.15 * warmth, 0.75);
  updateWaterCol();
}
function updateWaterCol() {
  const s = U.uSunDir.value.y;
  const day = THREE.MathUtils.smoothstep(s, -0.06, 0.25);
  U.uWaterCol.value.copy(U.uDeep.value).multiplyScalar(0.03 + 0.32 * day)
    .add(U.uScatter.value.clone().multiplyScalar(0.05 * day));
}
function applyWater() {
  U.uDeep.value.set(params.deep);
  U.uScatter.value.set(params.scatter);
  U.uFoam.value = params.foam;
  U.uRipple.value = params.ripple;
  U.uSSS.value = params.glow;
  U.uAbsorb.value = THREE.MathUtils.lerp(0.6, 0.03, params.clarity) * (40 / Math.max(params.size, 20)) ** 0.5;
  U.uGridOn.value = params.grid ? 1 : 0;
  U.uSurfAlpha.value = THREE.MathUtils.lerp(0.86, 0.38, params.clarity);
  wild.absorb = THREE.MathUtils.lerp(1.8, 0.45, params.clarity);
  updateWaterCol();
}

// ---------------------------------------------------------------- camera
const DEFAULT_DIR = new THREE.Vector3(0.7, 0.4, 0.6).normalize();
function resetCamera() {
  if (params.view === 'open') {
    controls.target.set(0, 1.5, 0);
    camera.position.set(-38, 11, 52);
  } else {
    controls.target.set(0, -params.depth * 0.32, 0);
    camera.position.copy(controls.target).addScaledVector(DEFAULT_DIR, params.size * 2.35 * (camera.aspect < 0.8 ? 1.45 : 1));
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
  if (hs < 0.02) return 'Glassy calm';
  if (hs < 0.1) return 'Rippled sea';
  if (hs < 0.5) return 'Smooth sea';
  if (hs < 1.25) return 'Slight sea';
  if (hs < 2.5) return 'Moderate sea';
  if (hs < 4) return 'Rough sea';
  if (hs < 6) return 'Very rough sea';
  if (hs < 9) return 'High sea';
  if (hs < 14) return 'Very high sea';
  return 'Phenomenal sea';
}
function updateHud() {
  const wind = params.windKn < 0.5 ? 'no wind' : `${Math.round(params.windKn)} kn wind`;
  $('r-summary').textContent = `${douglas(stats.hs)}, ${stats.hs.toFixed(1)} m waves, ${wind}${params.paused ? ', paused' : ''}`;
}

// ---------------------------------------------------------------- controls
const sync = [];
const syncAll = () => sync.forEach((f) => f());
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function slider(parent, key, label, min, max, step, fmt, onInput, obj = params) {
  const row = el('div', 'row');
  const id = `c-${key}`;
  const lab = el('label', null, label); lab.htmlFor = id;
  const out = el('output'); out.htmlFor = id;
  const inp = el('input'); inp.type = 'range'; inp.id = id; inp.min = min; inp.max = max; inp.step = step;
  const paint = () => {
    inp.value = obj[key];
    out.textContent = fmt(obj[key]);
    inp.style.setProperty('--p', `${((obj[key] - min) / (max - min)) * 100}%`);
  };
  inp.addEventListener('input', () => { obj[key] = parseFloat(inp.value); paint(); onInput(); });
  row.append(lab, out, inp);
  parent.append(row);
  sync.push(paint);
  paint();
}
function segmented(parent, key, label, options, onPick) {
  const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', label);
  const btns = options.map(([value, text]) => {
    const b = el('button', null, text); b.type = 'button'; b.id = `c-${key}-${value}`;
    b.addEventListener('click', () => { params[key] = value; paint(); onPick(value); });
    seg.append(b);
    return [value, b];
  });
  const paint = () => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(params[key] === v)));
  parent.append(seg);
  sync.push(paint);
  paint();
}
function toggle(parent, key, label, onFlip, obj = params) {
  const b = el('button', 'toggle'); b.type = 'button'; b.id = `c-${key}`;
  b.append(el('span', null, label), el('i'));
  const paint = () => b.setAttribute('aria-pressed', String(!!obj[key]));
  b.addEventListener('click', () => { obj[key] = !obj[key]; paint(); onFlip(); });
  parent.append(b);
  sync.push(paint);
  paint();
}
function button(parent, label, onClick, cls = '') {
  const b = el('button', `btn ${cls}`.trim(), label); b.type = 'button';
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
}

const WATERS = [
  { id: 'ocean', label: 'Ocean', deep: '#02283a', scatter: '#1fa3a8', clarity: 0.62 },
  { id: 'tropical', label: 'Tropical', deep: '#00384a', scatter: '#2fd6c4', clarity: 0.88 },
  { id: 'atlantic', label: 'Atlantic', deep: '#0b1d27', scatter: '#4a8a8e', clarity: 0.32 },
  { id: 'midnight', label: 'Midnight', deep: '#020b1d', scatter: '#2160c4', clarity: 0.5 },
];
params.water = 'ocean';

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
const seaChanged = () => { params.preset = 'custom'; buildSea(false); syncAll(); updateHud(); };

function setPopulation() {
  for (const d of SPECIES) wild.n[d.id] = Math.max(1, Math.min(d.max, Math.round(d.def * wild.amount)));
}

const panels = {};
function buildPanels() {
  // Sea
  const sea = el('div', 'panel');
  segmented(sea, 'preset', 'Sea state', [['calm', 'Calm'], ['moderate', 'Moderate'], ['fresh', 'Fresh'], ['storm', 'Storm']], (n) => applyPreset(n));
  slider(sea, 'swellH', 'Wave height', 0, 8, 0.05, (x) => `${x.toFixed(1)} m`, seaChanged);
  slider(sea, 'windKn', 'Wind', 0, 50, 0.5, (x) => `${Math.round(x)} kn`, seaChanged);
  slider(sea, 'chop', 'Choppiness', 0, 1.5, 0.01, (x) => `${Math.round((x / 1.5) * 100)}%`, () => buildSea(false));
  button(sea, 'Send a rogue wave', sendRogue, 'primary');
  panels.sea = { title: 'Sea', node: sea };

  // Wildlife
  const life = el('div', 'panel');
  const chips = el('div', 'chips');
  for (const d of SPECIES) {
    const c = el('button', 'chip'); c.type = 'button'; c.id = `c-sp-${d.id}`;
    c.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[d.id]}</svg><span>${d.label}</span>`;
    const paint = () => c.setAttribute('aria-pressed', String(wild.on[d.id]));
    c.addEventListener('click', () => { wild.on[d.id] = !wild.on[d.id]; paint(); });
    chips.append(c);
    sync.push(paint);
    paint();
  }
  life.append(chips);
  slider(life, 'amount', 'Population', 0.25, 2.5, 0.05, (x) => (x < 0.6 ? 'Sparse' : x < 1.4 ? 'Balanced' : 'Busy'), setPopulation, wild);
  slider(life, 'activity', 'Liveliness', 0, 3, 0.05, (x) => (x < 0.5 ? 'Calm' : x < 1.5 ? 'Natural' : 'Playful'), () => {}, wild);
  const acts = el('div', 'actions');
  button(acts, 'Breach', () => { wild.on.whale = true; syncAll(); wildlife.breach(); }, 'small');
  button(acts, 'Leap', () => { wild.on.dolphin = true; syncAll(); wildlife.leap(); }, 'small');
  button(acts, 'Fly by', () => { wild.on.pelican = true; syncAll(); wildlife.flyover(); }, 'small');
  life.append(acts);
  panels.life = { title: 'Wildlife', node: life };

  // Light
  const light = el('div', 'panel');
  slider(light, 'hour', 'Time of day', 5.5, 19.5, 0.05, fmtClock, () => { applyLight(); });
  const sw = el('div', 'swatches'); sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Water colour');
  for (const w of WATERS) {
    const b = el('button', 'swatch'); b.type = 'button'; b.id = `c-water-${w.id}`;
    const dot = el('i'); dot.style.background = `radial-gradient(circle at 35% 30%, ${w.scatter}, ${w.deep} 75%)`;
    b.append(dot, el('span', null, w.label));
    const paint = () => b.setAttribute('aria-pressed', String(params.water === w.id));
    b.addEventListener('click', () => { Object.assign(params, { water: w.id, deep: w.deep, scatter: w.scatter, clarity: w.clarity }); applyWater(); syncAll(); });
    sw.append(b);
    sync.push(paint);
    paint();
  }
  light.append(sw);
  slider(light, 'clarity', 'Clarity', 0, 1, 0.01, (x) => `${Math.round(x * 100)}%`, applyWater);
  toggle(light, 'grid', 'Measurement grid', applyWater);
  panels.light = { title: 'Light', node: light };
}

const pop = $('pop');
let openPanel = null;
function showPanel(id) {
  openPanel = openPanel === id ? null : id;
  document.querySelectorAll('.tool').forEach((t) => t.setAttribute('aria-expanded', String(t.dataset.panel === openPanel)));
  pop.classList.toggle('open', !!openPanel);
  pop.inert = !openPanel;
  pop.setAttribute('aria-hidden', String(!openPanel));
  document.body.classList.toggle('sheet-open', !!openPanel);
  if (!openPanel) return;
  $('pop-title').textContent = panels[openPanel].title;
  $('pop-body').replaceChildren(panels[openPanel].node);
  pop.scrollTop = 0;
}
pop.inert = true;
document.querySelectorAll('.tool').forEach((t) => t.addEventListener('click', () => showPanel(t.dataset.panel)));
$('pop-close').addEventListener('click', () => showPanel(openPanel));
renderer.domElement.addEventListener('pointerdown', () => { if (openPanel) showPanel(openPanel); });
// swipe the sheet's header down to dismiss it on touch screens
(() => {
  let y0 = null, dy = 0;
  const head = pop.querySelector('.pop-head');
  head.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; pop.style.transition = 'none'; }, { passive: true });
  head.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    pop.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  head.addEventListener('touchend', () => {
    pop.style.transition = ''; pop.style.transform = '';
    if (dy > 70 && openPanel) showPanel(openPanel);
    y0 = null;
  });
})();

function setView(v) {
  params.view = v;
  $('view-column').setAttribute('aria-pressed', String(v === 'column'));
  $('view-open').setAttribute('aria-pressed', String(v === 'open'));
  applyView(); resetCamera(); updateHud();
}
$('view-column').addEventListener('click', () => setView('column'));
$('view-open').addEventListener('click', () => setView('open'));

let wildlife;
function togglePause() { params.paused = !params.paused; updateHud(); }
function newSea() { params.seed += 1; buildSea(true); updateHud(); }

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (e.key === 'Escape' && openPanel) { showPanel(openPanel); return; }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); togglePause(); }
  else if (e.key === 'r' || e.key === 'R') newSea();
  else if (e.key === 'w' || e.key === 'W') sendRogue();
  else if (e.key === 'b' || e.key === 'B') { wild.on.whale = true; syncAll(); wildlife.breach(); }
  else if (e.key === 'l' || e.key === 'L') { wild.on.dolphin = true; syncAll(); wildlife.leap(); }
  else if (e.key === 'p' || e.key === 'P') { wild.on.pelican = true; syncAll(); wildlife.flyover(); }
});
renderer.domElement.addEventListener('dblclick', resetCamera);

function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 52 : 38;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------------------------------------------------------------- boot
buildPanels();
rebuildColumn();
buildSea(true);
wildlife = createWildlife({
  scene, U, common: COMMON, seaHeight, state: wild, GLTFLoader, packedModels: !!window.BLUE_WAVE_PACKED || new URLSearchParams(location.search).has('packed'),
  getBounds: () => (params.view === 'open'
    ? { open: true, half: 45, depth: 40 }
    : { open: false, half: params.size / 2, depth: params.depth }),
});
applyLight();
applyWater();
applyView();
resize();
resetCamera();
updateHud();

let lastT = performance.now();
let simTime = 0, frames = 0, fpsAcc = 0, hudAcc = 0;
window.__sea = { params, U, rogue, stats, wild, camera, controls, get wildlife() { return wildlife; }, get time() { return simTime; } };
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
  wildlife.update(dt, simTime, camera, renderer);
  controls.update();
  if (params.view === 'open' && camera.position.y < 2.5) camera.position.y = 2.5;
  renderer.render(scene, camera);

});
