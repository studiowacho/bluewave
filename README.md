# Bluewave

Real-time spectral ocean in WebGL2 + Three.js. A cut-away water column (or an open sea to the horizon) driven by a fetch-limited JONSWAP wind-sea spectrum, a narrow-band swell, and an optional travelling rogue crest. Inspired by Kerem's Sea Bench.

## Run

```bash
npm install
npm run dev          # Vite dev server with hot reload
npm run build        # production bundle in dist/
npm run build:single # one self-contained HTML (three from jsDelivr) in dist-single/
```

## Controls

drag orbit · scroll/pinch zoom · double-click reset · space pause · r new sea · w rogue wave

## How it works (src/main.js)

- **Spectrum** – `buildSea()` samples 54 frequencies log-spaced around the JONSWAP peak (ω_p = 22·(g²/U·F)^⅓, γ = 3.3) with cos²-style directional spread, plus 8 swell components. Seeded, so the same seed always gives the same sea; slider changes keep per-wave phases so the surface morphs instead of popping.
- **Surface** – Gerstner sum in the vertex shader; the fragment shader re-evaluates the sum per pixel for normals and the Jacobian, fading waves shorter than the pixel footprint (`fwidth`) to avoid aliasing.
- **Shading** – Schlick Fresnel against a procedural sky, GGX sun glint, crest subsurface scattering, Jacobian whitecaps, two octaves of wind-driven capillary ripples, horizon fog in open-sea mode. ACES tone mapping.
- **Column** – walls are re-evaluated from the same wave function so their top edge matches the surface exactly; horizontal displacement is masked at the edges. Walls show depth absorption, caustic shimmer and a 1 m / 5 m measurement grid.
- **Rogue wave** – an asymmetric Gaussian crest (steep face, long back) with crest-ward compression, travelling at deep-water group speed along the wind.

## Libraries

- `three` (r187 locally; the single-file build pins r170 from jsDelivr)
- `vite` for dev/build
- `lil-gui` installed if you want a quick debug panel (`import GUI from 'lil-gui'`), not used by the shipped UI
- `puppeteer-core` + `tools/shot.mjs` for headless screenshots: `node tools/shot.mjs http://localhost:4173/ out.png`

## Ideas next

- Port the spectrum to an FFT on WebGPU compute (three's `WebGPURenderer` + TSL) for 256² × 3 cascades
- Persistent foam via a ping-pong render target accumulating the Jacobian
- Screen-space refraction of the wall grid through the surface
