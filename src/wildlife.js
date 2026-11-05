// Procedural 3D sea life for Swell Study.
// Every species is one InstancedMesh built from lathed bodies + fin triangles,
// animated on the GPU (body undulation, wing/flipper flaps) and steered on the
// CPU along smooth seeded paths that read the live sea surface.
import * as THREE from 'three';

export const SPECIES = [
  { id: 'fish',    label: 'Fish',     unit: 'school', max: 240, def: 90, len: 0.6, bend: [0.09, 9, 15, 0], belly: 0.7 },
  { id: 'shark',   label: 'Sharks',   unit: 'reef',   max: 6,   def: 2,  len: 3.0,  bend: [0.07, 5, 4.5, 0], belly: 1.0 },
  { id: 'turtle',  label: 'Turtles',  unit: 'green',  max: 8,   def: 3,  len: 1.0,  flap: [0.22, 1.8], belly: 0.4 },
  // whale: bend.w = 2 switches on the spine model; spine = [fluke amplitude, wave number, rigid fraction, fluke flex]
  { id: 'whale',   label: 'Whales',   unit: 'humpback', max: 3, def: 1,  len: 12,   bend: [0, 0, 0, 2], spine: [0.075, 5.2, 0.22, 1.0], belly: 1.4 },
  { id: 'seal',    label: 'Seals',    unit: 'harbour', max: 8,  def: 3,  len: 1.6,  bend: [0.08, 6, 5, 1], belly: 0.6 },
  { id: 'dolphin', label: 'Dolphins', unit: 'pod',    max: 10,  def: 5,  len: 2.2,  bend: [0.06, 5, 9, 1], belly: 1.1 },
  { id: 'gull',    label: 'Seagulls', unit: 'flock',  max: 24,  def: 8,  len: 0.45, flap: [0.5, 9], belly: 0.05, air: true },
  { id: 'pelican', label: 'Pelicans', unit: 'V',      max: 9,   def: 5,  len: 1.1,  flap: [0.55, 4.2], belly: 0.05, air: true },
];

export const ICONS = {
  fish: '<path d="M3 12c2.6-3.6 8.4-4.8 12.6-1.1L20 8v8l-4.4-2.9C11.4 16.8 5.6 15.6 3 12z"/><circle cx="7" cy="11.2" r=".6" fill="currentColor"/>',
  shark: '<path d="M2 14.5c3.5-1.6 8-2.3 11.5-1.9L15.8 7l1.2 5.9c1.8.4 3.4 1.1 4.6 2.1"/><path d="M21.6 15c-.6-1.8-1.3-3.3-2.2-4.6M2 14.5c3 1.4 9 1.9 14.6.8M9 15.6l-.8 2.4"/>',
  turtle: '<ellipse cx="12" cy="12" rx="5.2" ry="4"/><path d="M17.2 12h2.6M7.6 9 4.4 6.4M7.6 15l-3.2 2.6M15.6 9l2.2-2M15.6 15l2.2 2M9 9.6l3 2.4 3-2.4M9 14.4l3-2.4 3 2.4"/>',
  whale: '<path d="M2 12.5c1.6-3.7 7.4-5 12.6-3.3 3 1 4.8 3 5 5.3H9.4C5.6 14.5 3 13.8 2 12.5z"/><path d="M19.6 14.5l2.4-3M19.6 14.5l2.4 2M7 14.4l-1 3"/>',
  seal: '<path d="M3.4 15.6c1.4-4.6 5.2-7.6 9.4-7.6 3.2 0 5.6 1.8 6.4 4.4l1.8.6-1.8.8c-.8 2.2-3.2 3.4-6 3.4H6.6"/><path d="M6.6 17.2 3 18.6l.4-3M10.6 16.6l-1 2.6"/><circle cx="16.6" cy="11" r=".6" fill="currentColor"/>',
  dolphin: '<path d="M3 15.8c2-5.6 7.6-8.6 12.6-7.4l1.6-2 .4 2.6c1.6.8 2.8 2 3.4 3.4l-2.2.2"/><path d="M3 15.8l-1-2.6M3 15.8l2.6.2M10 11.6l-.6 3"/>',
  gull: '<path d="M2.5 9.5c2.4-.6 4.6.4 6 2.4L12 14l3.5-2.1c1.4-2 3.6-3 6-2.4"/><path d="M12 14v1.6"/>',
  pelican: '<path d="M2 10.6c3-.8 6 .2 7.6 2.2L12 14.6l2.4-1.8c1.6-2 4.6-3 7.6-2.2"/><path d="M12 14.6l3.6 1.6-3.6.4"/>',
};

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const TAU = Math.PI * 2;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- geometry kit
function part(geo, color, wing = 0, wingSpan = 1) {
  geo.deleteAttribute('uv');
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const wg = new Float32Array(n);
  const pos = g.attributes.position.array;
  for (let i = 0; i < n; i++) {
    col[i * 3] = color[0]; col[i * 3 + 1] = color[1]; col[i * 3 + 2] = color[2];
    wg[i] = wing ? Math.min(1, Math.abs(pos[i * 3]) / wingSpan) : 0;
  }
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aWing', new THREE.BufferAttribute(wg, 1));
  return g;
}
// body of revolution along +z (nose at +0.5, tail at -0.5); profile = [t 0..1 tail→nose, radius]
function body(profile, color, sx = 1, sy = 1, opts = {}) {
  const pts = profile.map(([t, r]) => new THREE.Vector2(Math.max(r, 0.0005), t - 0.5));
  const g = new THREE.LatheGeometry(pts, opts.segs || 16);
  g.rotateX(Math.PI / 2);
  g.scale(sx, sy, opts.len || 1);
  if (opts.offset) g.translate(...opts.offset);
  g.computeVertexNormals();
  return part(g, color, opts.wing || 0, opts.wingSpan || 1);
}
// flat polygon fin from 3D points (fan), double-sided in the shader
function fin(points, color, wing = 0, wingSpan = 1, mirror = false) {
  const tris = [];
  const P = mirror ? points.map(([x, y, z]) => [-x, y, z]) : points;
  for (let i = 1; i < P.length - 1; i++) tris.push(...P[0], ...P[i], ...P[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return part(g, color, wing, wingSpan);
}
function pair(points, color, wing = 0, wingSpan = 1) {
  return [fin(points, color, wing, wingSpan), fin(points, color, wing, wingSpan, true)];
}
function merge(parts) {
  const flat = parts.flat();
  const total = flat.reduce((s, g) => s + g.attributes.position.count, 0);
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['aCol', 3], ['aWing', 1]]) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of flat) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

const C = {
  silver: [0.78, 0.84, 0.9], fin: [0.55, 0.62, 0.7],
  sharkGrey: [0.42, 0.47, 0.52], sharkFin: [0.36, 0.4, 0.45],
  dolphin: [0.34, 0.39, 0.45], whale: [0.16, 0.18, 0.21], whaleFin: [0.62, 0.64, 0.66],
  seal: [0.42, 0.4, 0.37], sealDark: [0.3, 0.28, 0.26],
  shell: [0.34, 0.32, 0.18], skin: [0.5, 0.47, 0.33],
  white: [0.95, 0.95, 0.94], gullWing: [0.7, 0.73, 0.77], black: [0.08, 0.08, 0.09], yellow: [0.95, 0.75, 0.22],
  pelBody: [0.82, 0.8, 0.74], pelWing: [0.5, 0.46, 0.42], pelBeak: [0.92, 0.62, 0.3],
};

const GEOMETRY = {
  fish: () => merge([
    body([[0, 0], [0.06, 0.03], [0.22, 0.07], [0.5, 0.11], [0.76, 0.1], [0.92, 0.06], [1, 0]], C.silver, 0.5, 1),
    fin([[0, 0, -0.44], [0, 0.15, -0.62], [0, 0, -0.54], [0, -0.15, -0.62]], C.fin),
    fin([[0, 0.1, 0.06], [0, 0.17, -0.1], [0, 0.07, -0.16]], C.fin),
    pair([[0.04, -0.03, 0.14], [0.13, -0.06, 0.02], [0.04, -0.04, 0.05]], C.fin),
  ]),
  shark: () => merge([
    body([[0, 0], [0.05, 0.02], [0.25, 0.065], [0.55, 0.095], [0.8, 0.08], [0.93, 0.05], [1, 0.01]], C.sharkGrey, 0.8, 1),
    fin([[0, 0.07, 0.12], [0, 0.25, -0.03], [0, 0.06, -0.08]], C.sharkFin),
    fin([[0, 0, -0.45], [0, 0.24, -0.62], [0, 0.02, -0.53], [0, -0.12, -0.57]], C.sharkFin),
    fin([[0, -0.04, -0.2], [0, -0.09, -0.27], [0, -0.03, -0.27]], C.sharkFin),
    pair([[0.05, -0.04, 0.14], [0.24, -0.12, -0.02], [0.05, -0.04, 0.02]], C.sharkFin),
  ]),
  dolphin: () => merge([
    body([[0, 0], [0.05, 0.03], [0.3, 0.08], [0.6, 0.1], [0.82, 0.085], [0.9, 0.045], [0.95, 0.025], [1, 0.012]], C.dolphin, 0.85, 1),
    fin([[0, 0.08, 0.08], [0, 0.21, -0.06], [0, 0.08, -0.07]], C.dolphin),
    pair([[0, 0, -0.45], [0.16, 0.01, -0.59], [0.06, 0, -0.56], [0, 0, -0.53]], C.dolphin),
    pair([[0.06, -0.05, 0.16], [0.18, -0.12, 0.04], [0.06, -0.05, 0.06]], C.dolphin),
  ]),
  whale: () => merge([
    body([[0, 0], [0.05, 0.035], [0.3, 0.09], [0.55, 0.12], [0.75, 0.12], [0.92, 0.09], [1, 0.03]], C.whale, 1.0, 0.85),
    pair([[0.09, -0.06, 0.28], [0.42, -0.16, 0.02], [0.4, -0.15, -0.01], [0.09, -0.06, 0.17]], C.whaleFin),
    fin([[0, 0.08, -0.1], [0, 0.13, -0.18], [0, 0.07, -0.2]], C.whale),
    pair([[0, 0, -0.45], [0.18, 0.01, -0.58], [0.15, 0, -0.62], [0.05, 0, -0.56], [0, 0, -0.54]], C.whale),
  ]),
  seal: () => merge([
    body([[0, 0.02], [0.12, 0.07], [0.45, 0.15], [0.75, 0.13], [0.9, 0.09], [0.97, 0.06], [1, 0]], C.seal, 0.9, 0.85),
    pair([[0.04, 0, -0.42], [0.16, 0, -0.62], [0.05, 0, -0.56]], C.sealDark),
    pair([[0.1, -0.08, 0.18], [0.22, -0.15, 0.04], [0.1, -0.08, 0.08]], C.sealDark),
  ]),
  turtle: () => merge([
    body([[0, 0], [0.1, 0.2], [0.5, 0.33], [0.88, 0.22], [1, 0]], C.shell, 1.15, 0.42),
    body([[0, 0.02], [0.3, 0.07], [0.7, 0.075], [1, 0]], C.skin, 1, 0.85, { len: 0.28, offset: [0, 0.01, 0.6] }),
    pair([[0.2, -0.02, 0.24], [0.72, -0.05, 0.04], [0.64, -0.05, -0.04], [0.2, -0.02, 0.1]], C.skin, 1, 0.72),
    pair([[0.16, -0.03, -0.3], [0.36, -0.05, -0.46], [0.18, -0.03, -0.42]], C.skin),
  ]),
  gull: () => merge([
    body([[0, 0], [0.1, 0.06], [0.4, 0.11], [0.75, 0.1], [0.9, 0.075], [1, 0.03]], C.white, 0.9, 1),
    body([[0, 0.02], [1, 0.0]], C.yellow, 1, 1, { len: 0.12, offset: [0, 0, 0.55], segs: 6 }),
    pair([[0.04, 0.03, 0.16], [0.6, 0.07, 0.1], [0.6, 0.07, -0.08], [0.04, 0.03, -0.1]], C.gullWing, 1, 1.15),
    pair([[0.6, 0.07, 0.1], [1.15, 0.0, -0.05], [0.6, 0.07, -0.08]], C.black, 1, 1.15),
    fin([[0, 0.02, -0.4], [0.1, 0.02, -0.6], [-0.1, 0.02, -0.6]], C.white),
  ]),
  pelican: () => merge([
    body([[0, 0], [0.1, 0.07], [0.4, 0.13], [0.75, 0.12], [0.9, 0.08], [1, 0.05]], C.pelBody, 0.9, 1),
    body([[0, 0.05], [0.4, 0.04], [1, 0.012]], C.pelBeak, 0.7, 1.1, { len: 0.55, offset: [0, -0.02, 0.76], segs: 8 }),
    pair([[0.05, 0.03, 0.2], [0.7, 0.06, 0.14], [0.7, 0.06, -0.12], [0.05, 0.03, -0.14]], C.pelWing, 1, 1.25),
    pair([[0.7, 0.06, 0.14], [1.25, 0.0, 0.0], [1.2, 0.0, -0.1], [0.7, 0.06, -0.12]], C.black, 1, 1.25),
    fin([[0, 0.02, -0.4], [0.12, 0.02, -0.56], [-0.12, 0.02, -0.56]], C.pelWing),
  ]),
};

// ---------------------------------------------------------------- shaders
// Shared vertex deformation. Bodies lie along +z (head +0.5, tail -0.5), y up.
//  - generic species: travelling sine displacement + wing/flipper flap
//  - whale (uBend.w = 2): a vertical spine. Cross-sections rotate with the local
//    slope, so the flukes pitch through each stroke and normals stay correct.
//    The CPU supplies the stroke: aInst.x = phase, .y = steer (-1..1), .w = stroke strength.
const DEFORM_GLSL = /* glsl */`
  uniform vec4 uBend;   // amplitude, spatial freq, speed, mode (0 lateral, 1 vertical, 2 spine)
  uniform vec2 uFlap;   // amplitude, speed
  uniform vec4 uSpine;  // fluke amplitude, wave number, rigid fraction, fluke flex
  uniform float uClock;
  float spineH(float u, float ph, float amp) {
    float env = pow(smoothstep(uSpine.z, 1.0, u), 1.45);
    // small counter-motion of the head: the body pivots about a point ~1/3 back
    float recoil = -0.12 * max(0.0, 1.0 - u / 0.33) * sin(ph - uSpine.y);
    return amp * (env * sin(ph - uSpine.y * u) + recoil);
  }
  void animalDeform(inout vec3 p, inout vec3 n, float wing, vec4 inst) {
    if (uBend.w > 1.5) {
      float u = clamp(0.5 - p.z, 0.0, 1.0);          // 0 rostrum .. 1 fluke tip
      float ph = inst.x;
      float amp = uSpine.x * inst.w;
      // pectoral flippers: held out, used for steering, a slight sway with the stroke
      float pec = wing * wing * smoothstep(0.12, 0.22, u) * (1.0 - smoothstep(0.5, 0.62, u));
      p.y += pec * (sign(p.x) * inst.y * 0.05 + 0.01 * sin(ph + 1.2) * inst.w);
      float h = spineH(u, ph, amp);
      float e = 0.01;
      float dhdu = (spineH(u + e, ph, amp) - spineH(u - e, ph, amp)) / (2.0 * e);
      float th = atan(-dhdu);                          // slope dy/dz of the spine
      // flukes are flexible: extra pitch that leads the stroke
      th += uSpine.w * 0.35 * smoothstep(0.84, 0.97, u) * cos(ph - uSpine.y * u) * inst.w;
      float c = cos(th), sn = sin(th);
      float yl = p.y;
      p.y = h + yl * c;
      p.z = p.z - yl * sn;
      n = vec3(n.x, n.y * c + n.z * sn, -n.y * sn + n.z * c);
    } else {
      float w = smoothstep(0.35, -0.5, p.z);
      float b = sin(p.z * uBend.y - uClock * uBend.z + inst.x) * uBend.x * (0.12 + w * w * 1.1);
      if (uBend.w < 0.5) p.x += b; else p.y += b;
      float fl = sin(uClock * uFlap.y + inst.x) * uFlap.x * inst.y;
      p.y += wing * wing * fl;
      p.x *= 1.0 - 0.12 * abs(fl) * wing;
      n.y += -sign(p.x) * fl * wing * 0.8;
    }
  }
`;

function animalMaterial(common, U, def) {
  const own = {
    uBend: { value: new THREE.Vector4(...(def.bend || [0, 0, 0, 0])) },
    uFlap: { value: new THREE.Vector2(...(def.flap || [0, 0])) },
    uSpine: { value: new THREE.Vector4(...(def.spine || [0, 0, 0, 0])) },
    uBelly: { value: def.belly },
    uClock: U.uClock,
    uAnimalAbsorb: U.uAnimalAbsorb,
    uDeep: U.uDeep, uScatter: U.uScatter,
  };
  return new THREE.ShaderMaterial({
    uniforms: { ...U, ...own },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${DEFORM_GLSL}
      attribute vec3 aCol;
      attribute float aWing;
      attribute vec4 aInst; // phase, flap gate, surface height, tint index
      attribute vec3 aTint;
      varying vec3 vCol;
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vBelly;
      varying float vSurf;
      void main() {
        vec3 p = position;
        vec3 n = normal;
        animalDeform(p, n, aWing, aInst);
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vN = normalize(mat3(modelMatrix * instanceMatrix) * normalize(n));
        vWorld = wp.xyz;
        vCol = aCol * aTint;
        vBelly = normal.y;
        vSurf = aInst.z;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      ${common}
      uniform vec3 uDeep;
      uniform vec3 uScatter;
      uniform float uBelly;
      uniform float uAnimalAbsorb;
      uniform float uFog;
      varying vec3 vCol;
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vBelly;
      varying float vSurf;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);
        float sunVis = smoothstep(-0.03, 0.06, L.y);
        vec3 base = vCol * mix(1.0 + uBelly, 1.0, smoothstep(-0.5, 0.35, vBelly));
        vec3 amb = skyColor(vec3(0.0, 1.0, 0.0), 0.0) * 0.55 + skyColor(normalize(vec3(V.x, 0.2, V.z)), 0.0) * 0.25;
        float ndl = max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 60.0) * 0.35;
        vec3 col = base * (amb * 0.8 + uSunColor * ndl * 0.75 * sunVis) + uSunColor * spec * sunVis;
        col += amb * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.12;

        float depth = vSurf - vWorld.y;
        if (depth > 0.0) {
          float caust = pow(fbm(vWorld.xz * 0.7 + vec2(uTime * 0.25, uTime * 0.18)), 3.0) * 3.0;
          col += uScatter * uSunColor * caust * max(N.y, 0.0) * exp(-depth * 0.35) * 0.35 * sunVis;
          col *= exp(-depth * vec3(0.3, 0.085, 0.055) * uAnimalAbsorb);
          vec3 water = uDeep * (amb * 0.5 + 0.03) + uScatter * amb * 0.08;
          float dist = length(cameraPosition - vWorld);
          float f = 1.0 - exp(-(depth * 0.07 + dist * 0.012 * uOpen) * uAnimalAbsorb);
          col = mix(col, water, clamp(f, 0.0, 0.97));
        } else if (uOpen > 0.5) {
          float dist = length(cameraPosition - vWorld);
          vec3 fogc = skyColor(normalize(vec3(-V.x, 0.02, -V.z)), 0.0);
          col = mix(col, fogc, 1.0 - exp(-dist * uFog));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------- spray particles
function makeSpray(U) {
  const N = 2400;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N);
  const size = new Float32Array(N), kind = new Float32Array(N), seed = new Float32Array(N);
  const decay = new Float32Array(N), grav = new Float32Array(N), drag = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.random();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 800 }, uSunColor: U.uSunColor, uSunDir: U.uSunDir, uTime: U.uTime },
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uScale;
      attribute float aLife;
      attribute float aSize;
      attribute float aKind;
      attribute float aSeed;
      varying float vLife;
      varying float vKind;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        vLife = aLife; vKind = aKind; vSeed = aSeed;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float grow = aKind > 0.5 ? (1.0 + 2.2 * (1.0 - aLife)) : (0.4 + 0.6 * aLife);
        gl_PointSize = aLife > 0.0 ? aSize * grow * uScale / max(-mv.z, 0.1) : 0.0;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying float vLife;
      varying float vKind;
      varying float vSeed;
      varying vec3 vWorld;
      vec3 spectrum(float t) { // 0 violet .. 1 red
        return clamp(vec3(
          1.6 * t - 0.25 + 0.6 * exp(-pow((t - 0.05) * 7.0, 2.0)),
          1.0 - abs(t - 0.55) * 2.4,
          1.0 - t * 2.2), 0.0, 1.0);
      }
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        vec3 L = normalize(uSunDir);
        float day = smoothstep(-0.05, 0.3, L.y);
        vec3 ray = normalize(vWorld - cameraPosition);
        vec3 base = vec3(0.86, 0.92, 0.95) * (0.3 + 0.55 * day) + uSunColor * 0.08;
        float a;
        vec3 col;
        if (vKind > 0.5) {
          // mist: soft puff, sun sparkle and a faint rainbow ~42 degrees from the antisolar point
          a = smoothstep(0.5, 0.0, d) * vLife * 0.16;
          col = base;
          float ang = degrees(acos(clamp(dot(ray, -L), -1.0, 1.0)));
          float t = (ang - 33.0) / 15.0;
          if (t > 0.0 && t < 1.0) {
            float band = sin(3.14159 * t);
            col = mix(col, spectrum(t) * (0.9 + uSunColor * 0.15), 0.75 * band * day);
            a *= 1.0 + 0.9 * band * day;
          }
          float glint = pow(max(dot(ray, L), 0.0), 6.0) + 0.35 * step(0.93, fract(sin(vSeed * 91.7 + uTime * 9.0) * 43758.5));
          col += uSunColor * glint * 0.25 * day;
        } else {
          a = smoothstep(0.5, 0.1, d) * vLife * 0.8;
          float twinkle = step(0.9, fract(sin(vSeed * 57.3 + uTime * 14.0) * 43758.5));
          col = base + uSunColor * twinkle * 0.35 * day;
        }
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  let head = 0;
  function emit(x, y, z, n, speed, opts = {}) {
    const mist = opts.mist ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const i = head; head = (head + 1) % N;
      const a = Math.random() * TAU;
      const spread = opts.spread ?? 1;
      const up = opts.up ?? 1;
      const r = Math.random();
      pos[i * 3] = x + Math.cos(a) * (opts.radius || 0.2) * r;
      pos[i * 3 + 1] = y + (opts.lift || 0) * Math.random();
      pos[i * 3 + 2] = z + Math.sin(a) * (opts.radius || 0.2) * r;
      vel[i * 3] = Math.cos(a) * speed * spread * (0.3 + 0.7 * Math.random());
      vel[i * 3 + 1] = speed * up * (0.5 + 0.8 * Math.random());
      vel[i * 3 + 2] = Math.sin(a) * speed * spread * (0.3 + 0.7 * Math.random());
      life[i] = 1;
      kind[i] = mist;
      size[i] = (opts.size || 0.25) * (0.6 + 0.8 * Math.random());
      decay[i] = 1 / ((opts.life || 1.4) * (0.75 + 0.5 * Math.random()));
      grav[i] = opts.gravity ?? 1;
      drag[i] = opts.drag ?? 0.6;
    }
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aKind.needsUpdate = true;
  }
  function update(dt) {
    const w = U.uWindDir.value;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) continue;
      vel[i * 3 + 1] -= 9.81 * grav[i] * dt;
      const k = 1 - drag[i] * dt;
      vel[i * 3] *= k; vel[i * 3 + 1] *= kind[i] ? k : 1; vel[i * 3 + 2] *= k;
      if (kind[i]) { vel[i * 3] += w.x * 1.6 * dt; vel[i * 3 + 2] += w.y * 1.6 * dt; }
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      life[i] -= dt * decay[i];
      if (life[i] < 0) life[i] = 0;
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
  }
  // a whale's breath: a tall bushy column of mist with a few heavier drops
  function blow(x, y, z) {
    emit(x, y, z, 170, 7.5, { mist: true, spread: 0.2, radius: 0.35, size: 0.55, life: 3.2, gravity: 0.12, drag: 1.1, lift: 0.4 });
    emit(x, y, z, 40, 6, { spread: 0.18, radius: 0.2, size: 0.18, life: 1.6 });
  }
  function bigSplash(x, y, z, r) {
    emit(x, y, z, 320, 8, { radius: r, size: 0.5, life: 1.8, spread: 0.9 });
    emit(x, y, z, 120, 3.2, { mist: true, radius: r * 1.2, size: 0.9, life: 2.6, gravity: 0.08, drag: 1.4, spread: 1 });
  }
  return { points, emit, update, mat, blow, bigSplash };
}

// ---------------------------------------------------------------- wildlife
export function createWildlife({ scene, U, common, seaHeight, getBounds, state, GLTFLoader, modelBase = './models/', packedModels = false }) {
  U.uClock = { value: 0 };
  U.uAnimalAbsorb = { value: 1 };

  const spray = makeSpray(U);
  scene.add(spray.points);

  const herds = {};
  const rnd = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

  for (const def of SPECIES) {
    const geo = GEOMETRY[def.id]();
    const inst = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const tint = new THREE.InstancedBufferAttribute(new Float32Array(def.max * 3).fill(1), 3);
    geo.setAttribute('aInst', inst);
    geo.setAttribute('aTint', tint);
    const mesh = new THREE.InstancedMesh(geo, animalMaterial(common, U, def), def.max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    const h = { def, mesh, inst, tint, above: new Int8Array(def.max), aux: new Float32Array(def.max * 4), clock: 0, len: def.len, cap: def.max };
    for (let i = 0; i < def.max; i++) {
      inst.array[i * 4] = rnd(i, 1) * TAU;
      const v = 0.88 + 0.24 * rnd(i, 2);
      tint.array[i * 3] = v; tint.array[i * 3 + 1] = v; tint.array[i * 3 + 2] = v;
    }
    herds[def.id] = h;
  }
  // fish schools get distinct colours
  const SCHOOL_TINTS = [[1, 1, 1], [1.25, 1.0, 0.45], [0.6, 0.85, 1.25], [1.3, 0.75, 0.5]];
  for (let i = 0; i < herds.fish.def.max; i++) {
    const t = SCHOOL_TINTS[i % 4], v = 0.9 + 0.2 * rnd(i, 3);
    herds.fish.tint.array.set([t[0] * v, t[1] * v, t[2] * v], i * 3);
  }

  const m = new THREE.Matrix4(), rollM = new THREE.Matrix4(), pitchM = new THREE.Matrix4();
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), vel = new THREE.Vector3(), sc = new THREE.Vector3();
  function place(h, i, pos, dir, scale, roll = 0, pitch = 0) {
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
    dir.normalize();
    if (Math.abs(dir.y) > 0.995) dir.x += 0.01;
    m.lookAt(dir, ORIGIN, UP);
    if (pitch) m.multiply(pitchM.makeRotationX(pitch));
    if (roll) m.multiply(rollM.makeRotationZ(roll));
    m.scale(sc.set(scale, scale, scale));
    m.setPosition(pos);
    h.mesh.setMatrixAt(i, m);
  }

  const events = { breach: -1, leap: false, flyover: false };
  let simNow = 0;

  // -- path helpers (all in species clock τ)
  const lis = (A, f, ph, t) => A * Math.sin(f * t + ph);

  function stepFish(h, n, b, tau) {
    const L = h.len * state.scale;
    const schools = Math.max(1, Math.min(4, Math.ceil(n / 40)));
    const A = Math.max(1, b.half - 3);
    for (let i = 0; i < n; i++) {
      const s = i % 4 < schools ? i % 4 : i % schools;
      const fn = (t, out) => {
        const lag = rnd(i, 4) * 1.6;
        const tt = t - lag;
        const f = 0.9 / A;
        const cx = lis(A, f * (1 + 0.21 * s), s * 1.7, tt);
        const cz = lis(A * 0.85, f * (1.37 - 0.13 * s), 0.6 + s * 2.3, tt);
        const cy = -Math.min(Math.max(b.depth * (0.22 + 0.13 * s), 1.6), 22) + 1.1 * Math.sin(0.11 * tt + s);
        const r = 0.5 + 2.4 * rnd(i, 5);
        const w = (0.35 + 0.15 * rnd(i, 6)) * (s % 2 ? -1 : 1);
        const a = rnd(i, 7) * TAU + w * tt;
        out.set(cx + r * Math.cos(a), cy + (rnd(i, 8) - 0.5) * 1.8 + 0.35 * Math.sin(tt * 0.8 + i), cz + r * Math.sin(a));
      };
      fn(tau, p1); fn(tau + 0.08, p2);
      clampWater(p1, b, L, 0.5); clampWater(p2, b, L, 0.5);
      vel.subVectors(p2, p1);
      setSurf(h, i, p1);
      place(h, i, p1, vel, L * (0.85 + 0.3 * rnd(i, 9)));
    }
  }
  function clampWater(p, b, L, below) {
    if (!b.open) {
      const lim = b.half - L * 0.6;
      p.x = Math.max(-lim, Math.min(lim, p.x));
      p.z = Math.max(-lim, Math.min(lim, p.z));
      p.y = Math.max(-b.depth + L * 0.3, p.y);
    }
    const s = seaHeight(p.x, p.z);
    if (p.y > s - below) p.y = s - below;
    return s;
  }
  function setSurf(h, i, p) { h.inst.array[i * 4 + 2] = seaHeight(p.x, p.z); }

  function cruise(h, n, b, tau, speed, depthFrac, depthMin, depthMax, wobble, extra) {
    const L = h.len * state.scale;
    const A = Math.max(0.5, b.half - L * 0.7);
    for (let i = 0; i < n; i++) {
      const fx = (speed / A) * (0.75 + 0.5 * rnd(i, 11));
      const fz = fx * (1.29 + 0.2 * rnd(i, 12));
      const ph1 = rnd(i, 13) * TAU, ph2 = rnd(i, 14) * TAU;
      const base = -Math.min(Math.max(b.depth * depthFrac, depthMin), depthMax);
      const fn = (t, out) => out.set(lis(A, fx, ph1, t), base + wobble * Math.sin(0.17 * t + ph1), lis(A * 0.9, fz, ph2, t));
      fn(tau - 0.1, p0); fn(tau, p1); fn(tau + 0.1, p2);
      const ex = extra ? extra(i, p1, p2, L) : null;
      clampWater(p1, b, L, ex?.below ?? L * 0.25);
      clampWater(p2, b, L, ex?.below ?? L * 0.25);
      vel.subVectors(p2, p1);
      vel.y *= 0.5;
      setSurf(h, i, p1);
      place(h, i, p1, vel, L * (0.9 + 0.2 * rnd(i, 15)), ex?.roll || 0);
    }
  }

  // ---- whale: a heavy swimmer steered by heading, not a fixed path.
  // One stroke clock drives everything: fluke beat (shader), thrust surge,
  // a slight body pitch. Behaviour cycles cruise → ascend → surface (blows) →
  // fluke-up dive, with ballistic breaches on demand.
  const whales = [];
  const wf = new THREE.Vector3();
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const BREACH_MODES = ['windup', 'rise', 'air', 'recover'];
  function whaleMode(w, mode, dur = 0) { w.mode = mode; w.modeT = 0; w.modeDur = dur; }
  function whaleFwd(w, out) {
    const cp = Math.cos(w.pitch);
    return out.set(Math.sin(w.yaw) * cp, Math.sin(w.pitch), Math.cos(w.yaw) * cp);
  }
  function whaleBlow(w, L) {
    whaleFwd(w, wf);
    const x = w.pos.x + wf.x * L * 0.3, z = w.pos.z + wf.z * L * 0.3;
    spray.blow(x, seaHeight(x, z) + 0.3, z);
  }

  function stepWhale(h, n, b, dt) {
    dt = Math.min(dt, 0.05);
    const L = Math.min(h.len, b.open ? 14 : b.half * 0.55) * state.scale;
    const lim = b.open ? b.half - L : b.half - L * 0.5;
    const floor = b.open ? -Math.max(b.depth, 30) : -b.depth + L * 0.16;
    const cruiseY = Math.max(-Math.min(Math.max(b.depth * 0.5, L * 0.3 + 1), 14), floor + L * 0.15);
    const vCruise = 0.17 * L;          // ~2 m/s for a 12 m humpback
    const g = 9.81 * (L / 12);         // Froude-scaled so a small column whale keeps real timing
    for (let i = 0; i < n; i++) {
      let w = whales[i];
      if (!w) {
        w = whales[i] = {
          pos: new THREE.Vector3((rnd(i, 21) - 0.5) * lim, cruiseY, (rnd(i, 22) - 0.5) * lim),
          vel: new THREE.Vector3(), yaw: rnd(i, 23) * TAU, pitch: 0, roll: 0, yawRate: 0,
          speed: vCruise, phase: rnd(i, 24) * TAU, amp: 1, wander: 0, mode: 'cruise', modeT: 0,
          modeDur: 10 + 25 * rnd(i, 26), blows: 0, nextBlow: 0, spin: 0, sink: 0, tailUp: 0,
        };
        w.wander = w.yaw;
      }
      w.modeT += dt;
      const hard = lim + 0.18 * L;   // steering aims inside lim; this is only a backstop
      if (!b.open) { w.pos.x = clamp(w.pos.x, -hard, hard); w.pos.z = clamp(w.pos.z, -hard, hard); }
      const surf = seaHeight(w.pos.x, w.pos.z);

      // --- behaviour: what depth, speed and stroke strength the whale wants
      let targetY = cruiseY + 0.5 * Math.sin(w.modeT * 0.09 + i * 2.1);
      let speedT = vCruise, ampT = 1, maxPitch = 0.3, pitchGain = 1, pitchRate = 0.55, yawFree = true;
      switch (w.mode) {
        case 'cruise':
          if (w.modeT > w.modeDur) whaleMode(w, 'ascend');
          break;
        case 'ascend':
          targetY = surf - 0.07 * L; speedT = vCruise * 0.9;
          if (w.pos.y > surf - 0.15 * L) {
            whaleMode(w, 'surface'); w.blows = 2 + Math.floor(rnd(i, w.phase) * 2); w.nextBlow = 0.8;
            spray.emit(w.pos.x, surf, w.pos.z, 40, 2.2, { radius: L * 0.2, size: 0.35 });
          }
          break;
        case 'surface':
          targetY = surf - 0.07 * L; speedT = vCruise * 0.6; ampT = 0.45; pitchGain = 3; maxPitch = 0.1;
          if (w.modeT > w.nextBlow) {
            if (w.blows-- > 0) { whaleBlow(w, L); w.nextBlow = w.modeT + 5 + 3 * Math.random(); }
            else whaleMode(w, 'dive');
          }
          break;
        case 'dive':
          // fluke-up: tip the head down hard and glide, so the tail lifts clear of the water
          targetY = floor; speedT = vCruise * 0.75; ampT = w.modeT < 3.5 ? 0.12 : 0.8;
          maxPitch = 0.9; pitchGain = 6; pitchRate = 0.75;
          if (w.modeT > 3 && w.pos.y < Math.max(cruiseY, floor + 0.35 * L)) whaleMode(w, 'cruise', 25 + 25 * Math.random());
          break;
        case 'windup':
          targetY = Math.max(floor + 0.1 * L, surf - 1.1 * L); speedT = vCruise * 1.3; ampT = 1; maxPitch = 0.75; pitchGain = 3; pitchRate = 0.9;
          if (w.pos.y < targetY + 0.15 * L || w.modeT > 6) whaleMode(w, 'rise');
          break;
        case 'rise': {
          const headY = w.pos.y + Math.sin(w.pitch) * 0.45 * L;
          if (headY > surf && !w.splashed) { w.splashed = true; spray.emit(w.pos.x, surf, w.pos.z, 120, 5, { radius: L * 0.15, size: 0.4 }); }
          // drive up steeply, accelerating with hard fluke strokes
          speedT = 0.85 * L; ampT = 1.45; pitchRate = 1.6; yawFree = false;
          if (w.pos.y > surf - 0.05 * L) {
            whaleFwd(w, w.vel).multiplyScalar(w.speed);
            w.spin = (Math.random() < 0.5 ? -1 : 1) * (1.4 + 0.6 * Math.random());
            whaleMode(w, 'air');
          } else if (w.modeT > 6) whaleMode(w, 'cruise', 20);
          break;
        }
      }

      if (w.mode === 'air') {
        // ballistic: gravity only. The body keeps rotating — pitch falls back, it spins onto its side
        w.vel.y -= g * dt;
        w.pos.addScaledVector(w.vel, dt);
        w.pitch -= 0.5 * dt;
        w.roll = clamp(w.roll + w.spin * dt, -2.3, 2.3);
        w.amp = damp(w.amp, 0.15, 2, dt);
        w.phase += TAU * 0.25 * dt;
        if (w.vel.y < 0 && w.pos.y < seaHeight(w.pos.x, w.pos.z) - 0.04 * L) {
          whaleFwd(w, wf);
          spray.bigSplash(w.pos.x, seaHeight(w.pos.x, w.pos.z), w.pos.z, L * 0.35);
          w.sink = w.vel.y * 0.5;
          w.speed = Math.hypot(w.vel.x, w.vel.z) * 0.6;
          w.yaw = Math.atan2(w.vel.x, w.vel.z);
          whaleMode(w, 'recover');
        }
      } else {
        if (w.mode === 'recover') {
          speedT = vCruise * 0.5; ampT = w.modeT < 1.5 ? 0.2 : 0.7; targetY = surf - 0.3 * L; maxPitch = 0.25;
          if (w.modeT > 3.4 && w.blows !== -9) { whaleBlow(w, L); w.blows = -9; }
          if (w.modeT > 7) whaleMode(w, 'cruise', 20 + 20 * Math.random());
        }
        // --- heading: slow wander, look-ahead wall avoidance, capped turn rate
        w.wander += dt * 0.16 * Math.sin(w.modeT * 0.13 + i * 3.7 + w.phase * 0.02);
        let desired = w.wander;
        const look = L * 0.45 + w.speed * 3;
        const ax = w.pos.x + Math.sin(w.yaw) * look, az = w.pos.z + Math.cos(w.yaw) * look;
        const over = b.open ? Math.hypot(ax, az) - lim : Math.max(Math.abs(ax), Math.abs(az)) - lim;
        if (over > 0) {
          // ease toward the middle; the closer the wall, the stronger the pull
          const home = Math.atan2(-w.pos.x, -w.pos.z);
          desired = w.yaw + angDiff(home, w.yaw) * clamp(over / (0.3 * L), 0.35, 1);
          w.wander = damp(w.wander, w.yaw + angDiff(home, w.yaw), 0.5, dt);
        }
        const maxTurn = clamp(w.speed / (0.85 * L), 0.05, 0.5);
        const yawT = yawFree ? clamp(angDiff(desired, w.yaw) * (over > 0 ? 0.8 : 0.45), -maxTurn, maxTurn) : 0;
        w.yawRate = damp(w.yawRate, yawT, 0.9, dt);
        w.yaw += w.yawRate * dt;
        // --- pitch follows the climb; the body always points where it travels
        const pitchT = w.mode === 'rise' ? 1.2 : clamp((targetY - w.pos.y) / L * 0.9 * pitchGain, -maxPitch, maxPitch);
        w.pitch = damp(w.pitch, w.pos.y < floor + 0.05 * L ? Math.max(pitchT, 0.15) : pitchT, pitchRate, dt);
        // --- bank into turns, settle back after the breach spin
        const rollT = clamp(-w.yawRate * 1.5, -0.28, 0.28);
        w.roll = damp(w.roll, rollT, w.mode === 'recover' ? 0.5 : 0.8, dt);
        // --- one stroke clock: frequency follows speed (Strouhal-like), thrust surges twice per beat
        w.speed = damp(w.speed, speedT, w.mode === 'rise' ? 1.8 : 0.35, dt);
        w.amp = damp(w.amp, ampT, 1.2, dt);
        const freq = clamp(w.speed / (0.6 * L), 0.12, 0.85) * (0.55 + 0.45 * Math.min(w.amp, 1));
        w.phase += TAU * freq * dt;
        const surge = 1 + 0.05 * w.amp * Math.sin(2 * w.phase);
        whaleFwd(w, wf);
        w.pos.addScaledVector(wf, w.speed * surge * dt);
        if (w.mode === 'recover') { w.pos.y += w.sink * dt; w.sink = damp(w.sink, 0, 1.4, dt); }
        w.pos.y = Math.max(w.pos.y, floor);
        if (!['rise', 'recover'].includes(w.mode)) w.pos.y = Math.min(w.pos.y, surf - 0.04 * L);
      }

      // --- surface interactions
      whaleFwd(w, wf);
      const surfNow = seaHeight(w.pos.x, w.pos.z);
      const tailY = w.pos.y - wf.y * 0.48 * L;
      const tailUp = tailY > surfNow + 0.05 ? 1 : 0;
      if (tailUp !== w.tailUp && w.mode === 'dive') {
        const tx = w.pos.x - wf.x * 0.48 * L, tz = w.pos.z - wf.z * 0.48 * L;
        spray.emit(tx, surfNow, tz, tailUp ? 50 : 70, tailUp ? 1.6 : 2.4, { radius: L * 0.12, size: 0.3, life: 1.6 });
      }
      w.tailUp = tailUp;

      h.inst.array[i * 4] = w.phase;
      h.inst.array[i * 4 + 1] = clamp(-w.yawRate / 0.3, -1, 1);
      h.inst.array[i * 4 + 2] = surfNow;
      h.inst.array[i * 4 + 3] = w.amp;
      // a faint pitching of the whole body in time with the stroke
      const pitchSave = w.pitch;
      w.pitch += 0.015 * w.amp * Math.cos(w.phase);
      whaleFwd(w, wf);
      w.pitch = pitchSave;
      place(h, i, w.pos, wf, L, w.roll);
    }
    // occasional breaches on their own
    if (n && Math.random() < dt * 0.005) breach();
  }
  function breach() {
    const n = state.on.whale ? state.n.whale : 0;
    for (let i = 0; i < n; i++) {
      const w = whales[i];
      if (w && !BREACH_MODES.includes(w.mode)) { whaleMode(w, 'windup'); w.blows = 0; w.splashed = false; return true; }
    }
    return false;
  }

  function stepDolphins(h, n, b, tau) {
    const L = h.len * state.scale;
    const A = Math.max(1, b.half - 3);
    const f = 4.2 / A;
    if (events.leap) { h.aux[3] = -(tau / 4.6) % 1 + 1; events.leap = false; }
    for (let j = 0; j < n; j++) {
      const lag = j * 0.4;
      const lat = [Math.sin(j * 2.1) * 1.4, Math.cos(j * 1.7) * 1.4];
      const at = (t, out) => {
        const tt = t - lag;
        out.set(lis(A, f, 0.4, tt) + lat[0], 0, lis(A * 0.85, f * 1.27, 2.1, tt) + lat[1]);
        const surf = seaHeight(out.x, out.z);
        const base = surf - 1.1;
        const u = (((tt / 4.6) + h.aux[3] + j * 0.05) % 1 + 1) % 1;
        out.y = u < 0.3 ? base + 2.9 * Math.sin(Math.PI * u / 0.3) : base + 0.25 * Math.sin(tt * 3 + j);
        if (!b.open) out.y = Math.max(out.y, -b.depth + 0.6);
        return surf;
      };
      const surf = at(tau, p1); at(tau + 0.06, p2);
      vel.subVectors(p2, p1);
      h.inst.array[j * 4 + 2] = surf;
      const above = p1.y > surf ? 1 : 0;
      if (above !== h.above[j]) { spray.emit(p1.x, surf, p1.z, 28, 3.2, { radius: 0.4 }); h.above[j] = above; }
      place(h, j, p1, vel, L * (0.92 + 0.16 * rnd(j, 31)));
    }
  }

  function stepGulls(h, n, b, tau) {
    const L = h.len * state.scale;
    const R = b.open ? 55 : b.half * 1.7;
    for (let i = 0; i < n; i++) {
      const f = (7 / R) * (0.7 + 0.6 * rnd(i, 41));
      const ph1 = rnd(i, 42) * TAU, ph2 = rnd(i, 43) * TAU;
      const alt = 4 + 9 * rnd(i, 44);
      const at = (t, out) => out.set(lis(R, f, ph1, t), alt + 1.4 * Math.sin(0.4 * t + ph1), lis(R * 0.8, f * 1.31, ph2, t));
      at(tau - 0.1, p0); at(tau, p1); at(tau + 0.1, p2);
      p1.y = Math.max(p1.y, seaHeight(p1.x, p1.z) + 2);
      vel.subVectors(p2, p0);
      const turn = (p1.x - p0.x) * (p2.z - p1.z) - (p1.z - p0.z) * (p2.x - p1.x);
      const roll = Math.max(-0.9, Math.min(0.9, -turn * 0.25 / Math.max(vel.lengthSq() * 0.25, 1e-3)));
      h.inst.array[i * 4 + 1] = 0.25 + 0.75 * smooth(-0.2, 0.5, Math.sin(0.35 * tau + ph1));
      h.inst.array[i * 4 + 2] = -100;
      place(h, i, p1, vel, L, roll);
    }
  }

  function stepPelicans(h, n, b, tau) {
    const L = h.len * state.scale;
    const R = b.open ? 70 : b.half * 1.9;
    const D = 2 * R + 30;
    const speed = 9;
    if (events.flyover) { h.aux[0] = -(tau * speed) + 2; events.flyover = false; }
    const d = tau * speed + h.aux[0] + D / 2;
    const pass = Math.floor(d / D);
    const s = (d - pass * D) - D / 2;
    const th = rnd(pass, 51) * TAU;
    const dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const off = (rnd(pass, 52) - 0.5) * R * 0.8;
    for (let k = 0; k < n; k++) {
      const rank = Math.ceil(k / 2), side = k === 0 ? 0 : (k % 2 ? 1 : -1);
      p1.copy(dir).multiplyScalar(s - rank * 2.6).addScaledVector(perp, off + side * rank * 2.3);
      const surf = seaHeight(p1.x, p1.z);
      p1.y = Math.max(surf, 0) + 2.4 + 0.35 * Math.sin(tau * 0.8 - rank * 0.5);
      vel.copy(dir);
      vel.y = 0.04 * Math.cos(tau * 0.8 - rank * 0.5);
      h.inst.array[k * 4] = -rank * 0.7;
      h.inst.array[k * 4 + 1] = smooth(0, 0.35, Math.sin(0.55 * tau - rank * 0.35));
      h.inst.array[k * 4 + 2] = -100;
      place(h, k, p1, vel, L);
    }
  }

  // ---------------------------------------------------------------- generated models
  const REAL_LEN = { fish: 0.55, shark: 3.0, turtle: 1.0, whale: 12, seal: 1.6, dolphin: 2.3, gull: 0.55, pelican: 1.3 };
  const SURFACE = { fish: [0.28, 0.3], shark: [0.5, 0.0], dolphin: [0.3, 0.0], whale: [0.42, 0.0], seal: [0.36, 0.0], turtle: [0.6, 0.0], gull: [0.85, 0.0], pelican: [0.85, 0.0] };
  // set to -1 for any model that comes out tail-first
  const FLIP = {};
  // The generated humpback holds its pectoral flippers ~40° below horizontal, like
  // landing gear. Rotate them up about their root so they ride out to the sides.
  function liftFlippers(g) {
    const P = g.attributes.position, N = g.attributes.normal;
    const rootX = 0.085, rootY = -0.03, lift = 0.5;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), u = 0.5 - P.getZ(i);
      const dx = Math.abs(x) - rootX, dy = y - rootY;
      if (dx <= 0 || dy > 0.02 || u < 0.2 || u > 0.54) continue;
      const wgt = smooth(0.02, 0.1, Math.hypot(dx, dy)) * smooth(0.2, 0.27, u) * (1 - smooth(0.47, 0.54, u));
      if (!wgt) continue;
      const a = lift * wgt, c = Math.cos(a), sn = Math.sin(a), sg = Math.sign(x);
      P.setXY(i, sg * (rootX + dx * c - dy * sn), rootY + dx * sn + dy * c);
      if (N) {
        const nx = N.getX(i) * sg, ny = N.getY(i);
        N.setXY(i, sg * (nx * c - ny * sn), nx * sn + ny * c);
      }
    }
    P.needsUpdate = true; if (N) N.needsUpdate = true;
  }
  function adopt(def, gltf) {
    const h = herds[def.id];
    gltf.scene.updateMatrixWorld(true);
    let src = null, most = 0;
    gltf.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count > most) { src = o; most = o.geometry.attributes.position.count; } });
    if (!src) return;
    let g = src.geometry.clone();
    g.applyMatrix4(src.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    g.computeBoundingBox();
    const c = new THREE.Vector3(); g.boundingBox.getCenter(c); g.translate(-c.x, -c.y, -c.z);
    const size = new THREE.Vector3(); g.boundingBox.getSize(size);
    const winged = !!def.air || def.id === 'turtle';
    const xLonger = size.x >= size.z;
    const bodyOnX = winged ? !xLonger : xLonger;
    if (bodyOnX) g.rotateY(-Math.PI / 2); // body axis onto +z
    g.computeBoundingBox(); g.boundingBox.getSize(size);
    const P = g.attributes.position;
    // Higgsfield/SAM models come out with the head on +z and y up
    let dir = 1;
    if (FLIP[def.id]) dir *= FLIP[def.id];
    if (dir < 0) g.rotateY(Math.PI);
    g.computeBoundingBox(); g.boundingBox.getSize(size); g.boundingBox.getCenter(c);
    g.translate(-c.x, -c.y, -c.z);
    const k = 1 / Math.max(size.z, 1e-6);
    g.scale(k, k, k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (def.id === 'whale') liftFlippers(g);
    const halfSpan = (size.x * k) / 2, bodyHalf = def.id === 'turtle' ? 0.36 : def.id === 'whale' ? 0.08 : 0.12;
    const wing = new Float32Array(P.count);
    if (winged || def.id === 'whale') for (let i = 0; i < P.count; i++) wing[i] = Math.min(1, Math.max(0, (Math.abs(P.getX(i)) - bodyHalf) / Math.max(halfSpan - bodyHalf, 0.05)));
    g.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
    g.setAttribute('aInst', h.inst);
    g.setAttribute('aTint', h.tint);
    const tris = (g.index ? g.index.count : P.count) / 3;

    const orig = Array.isArray(src.material) ? src.material[0] : src.material;
    const [rough, metal] = SURFACE[def.id];
    const mat = new THREE.MeshStandardMaterial({
      map: orig.map || null, vertexColors: !orig.map && !!g.attributes.color,
      color: orig.map || g.attributes.color ? 0xffffff : (orig.color || new THREE.Color(0.6, 0.6, 0.6)),
      roughness: rough, metalness: metal, side: THREE.DoubleSide,
    });
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    const uni = h.mesh.material.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uBend: uni.uBend, uFlap: uni.uFlap, uSpine: uni.uSpine, uClock: U.uClock, uAnimalAbsorb: U.uAnimalAbsorb, uOpen: U.uOpen, uWaterCol: U.uWaterCol });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aInst; attribute float aWing; attribute vec3 aTint;
          ${DEFORM_GLSL}
          varying vec3 vWorldW; varying float vSurfW; varying vec3 vTintW;`)
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(normal);
          vec3 animP = vec3(position);
          animalDeform(animP, objectNormal, aWing, aInst);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = animP;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vWorldW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vSurfW = aInst.z; vTintW = aTint;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uAnimalAbsorb; uniform float uOpen; uniform vec3 uWaterCol;
          varying vec3 vWorldW; varying float vSurfW; varying vec3 vTintW;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          diffuseColor.rgb *= vTintW;`)
        .replace('#include <tonemapping_fragment>', `
          float dW = vSurfW - vWorldW.y;
          if (dW > 0.0) {
            gl_FragColor.rgb *= exp(-dW * vec3(0.3, 0.085, 0.055) * uAnimalAbsorb);
            float fW = 1.0 - exp(-(dW * 0.07 + length(cameraPosition - vWorldW) * 0.012 * uOpen) * uAnimalAbsorb);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterCol, clamp(fW, 0.0, 0.97));
          }
          #include <tonemapping_fragment>`);
    };
    // generated models keep their own colours: neutral tint except fish schools
    if (def.id !== 'fish') h.tint.array.fill(1);
    else for (let i = 0; i < def.max; i++) { const v = 0.85 + 0.3 * rnd(i, 3); h.tint.array.set([v, v, v], i * 3); }
    h.tint.needsUpdate = true;
    h.mesh.geometry.dispose();
    h.mesh.geometry = g;
    h.mesh.material = mat;
    h.len = REAL_LEN[def.id];
    h.cap = Math.max(1, Math.floor(2.5e6 / Math.max(tris, 1)));
    h.glb = true;
    console.info(`Blue Wave: loaded ${def.id} model (${Math.round(tris)} triangles, ${bodyOnX ? 'x' : 'z'} axis, ${dir > 0 ? '+' : '-'} head)`);
  }
  function b64(str, Type) { const bin = atob(str); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Type(u8.buffer); }
  async function loadPacked(def) {
    const res = await fetch(`${modelBase}${def.id}.json`);
    if (!res.ok) return;
    const d = await res.json();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b64(d.position, Float32Array), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(b64(d.uv, Float32Array), 2));
    if (d.index) g.setIndex(new THREE.BufferAttribute(b64(d.index, d.indexType === 5125 ? Uint32Array : Uint16Array), 1));
    const map = await new THREE.TextureLoader().loadAsync(`${modelBase}${def.id}.png`);
    map.flipY = false;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map })));
    adopt(def, { scene: group });
  }
  if (packedModels) {
    for (const def of SPECIES) loadPacked(def).catch(() => {});
  } else if (GLTFLoader) {
    const loader = new GLTFLoader();
    for (const def of SPECIES) {
      loader.load(`${modelBase}${def.id}.glb`, (gltf) => { try { adopt(def, gltf); } catch (e) { console.warn(`Blue Wave: ${def.id} model failed`, e); } }, undefined, () => {});
    }
  }

  function update(dt, now, camera, renderer) {
    simNow = now;
    const b = getBounds();
    const a = dt * state.activity;
    U.uClock.value += a;
    U.uAnimalAbsorb.value = state.absorb;
    for (const def of SPECIES) {
      const h = herds[def.id];
      const n = state.on[def.id] && state.enabled ? Math.min(state.n[def.id], def.max, h.cap) : 0;
      h.mesh.count = n;
      if (!n) continue;
      h.clock += a;
      const tau = h.clock;
      switch (def.id) {
        case 'fish': stepFish(h, n, b, tau); break;
        case 'shark': cruise(h, n, b, tau, 1.3, 0.5, 2.5, 20, 1.4); break;
        case 'turtle':
          for (let i = 0; i < n; i++) h.inst.array[i * 4 + 1] = 1;
          cruise(h, n, b, tau, 0.55, 0.22, 1.4, 7, 0.8, (i) => ({ roll: 0.15 * Math.sin(tau * 0.6 + i), below: 0.6 }));
          break;
        case 'whale': stepWhale(h, n, b, a); break;
        case 'seal':
          cruise(h, n, b, tau, 1.6, 0.06, 0.7, 1.6, 0.5, (i) => ({ roll: 1.3 * Math.sin(tau * 0.55 + i * 1.7), below: 0.35 }));
          break;
        case 'dolphin': stepDolphins(h, n, b, tau); break;
        case 'gull': stepGulls(h, n, b, tau); break;
        case 'pelican': stepPelicans(h, n, b, tau); break;
      }
      h.mesh.instanceMatrix.needsUpdate = true;
      h.inst.needsUpdate = true;
    }
    if (events.breach >= 0) { breach(); events.breach = -1; }
    spray.update(dt);
    const hgt = renderer.domElement.height;
    spray.mat.uniforms.uScale.value = hgt / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  return {
    update,
    breach: () => { events.breach = 1; },
    leap: () => { events.leap = true; },
    flyover: () => { events.flyover = true; },
    blow: (x, y, z) => spray.blow(x, y, z),
    whales,
  };
}
