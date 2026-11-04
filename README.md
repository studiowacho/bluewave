# Blue Wave

Real-time spectral ocean in WebGL2 + Three.js. A cut-away water column (or an open sea to the horizon) driven by a fetch-limited JONSWAP wind-sea spectrum, a narrow-band swell, and an optional travelling rogue crest. Inspired by Kerem's Sea Bench.

## Run

```bash
npm install
npm run dev          # Vite dev server with hot reload
npm run build        # production bundle in dist/
npm run build:single # one self-contained HTML (three from jsDelivr) in dist-single/
```

## Hosting and updates

Hosted on Vercel, linked to this GitHub repo. Every push to `main` builds and deploys to production automatically; every other branch or pull request gets its own preview URL.

To update:
- **With Claude:** open a chat, say "update Blue Wave in studiowacho/bluewave: …". Claude edits, commits and pushes; Vercel deploys in about 30 seconds.
- **Locally:** `npm run dev`, edit, then `git commit -am "…" && git push`.
- **Try something risky:** push to a branch (`git checkout -b experiment`) and open the preview URL Vercel posts on the commit before merging.

## Controls

drag orbit · scroll/pinch zoom · double-click reset · space pause · r new sea · w rogue wave · b whale breach · l dolphins leap · p pelican pass

## How it works (src/main.js)

- **Spectrum** – `buildSea()` samples 54 frequencies log-spaced around the JONSWAP peak (ω_p = 22·(g²/U·F)^⅓, γ = 3.3) with cos²-style directional spread, plus 8 swell components. Seeded, so the same seed always gives the same sea; slider changes keep per-wave phases so the surface morphs instead of popping.
- **Surface** – Gerstner sum in the vertex shader; the fragment shader re-evaluates the sum per pixel for normals and the Jacobian, fading waves shorter than the pixel footprint (`fwidth`) to avoid aliasing.
- **Shading** – Schlick Fresnel against a procedural sky, GGX sun glint, crest subsurface scattering, Jacobian whitecaps, two octaves of wind-driven capillary ripples, horizon fog in open-sea mode. ACES tone mapping.
- **Column** – walls are re-evaluated from the same wave function so their top edge matches the surface exactly; horizontal displacement is masked at the edges. Walls show depth absorption, caustic shimmer and a 1 m / 5 m measurement grid.
- **Wildlife** (src/wildlife.js) – fish schools, sharks, green turtles, humpback whales, harbour seals, a dolphin pod, seagulls and pelicans. Each species is one InstancedMesh built from lathed bodies and fin triangles; swimming undulation and wing/flipper flaps run in the vertex shader, paths are seeded Lissajous curves that read the live sea height on the CPU so dolphins leap, whales surface and breach, and pelicans skim the crests. Underwater shading uses red-first absorption, depth fog and caustics; spray particles fire where animals cross the surface. Glass walls and the surface are translucent so you can see in.
- **Rogue wave** – an asymmetric Gaussian crest (steep face, long back) with crest-ward compression, travelling at deep-water group speed along the wind.

## Animal models

The eight animals are textured 3D models generated with Higgsfield (GPT Image reference renders lifted to GLB with SAM 3D). Their source URLs live in `scripts/models.json`; `npm run fetch-models` (also run automatically before every build) downloads them into `public/models/`. If a model is missing, that species falls back to the built-in procedural shape. If a model swims tail-first, set `FLIP.<species> = -1` in `src/wildlife.js`.

## Libraries

- `three` (r187 locally; the single-file build pins r170 from jsDelivr)
- `vite` for dev/build
- `lil-gui` installed if you want a quick debug panel (`import GUI from 'lil-gui'`), not used by the shipped UI
- `puppeteer-core` + `tools/shot.mjs` for headless screenshots: `node tools/shot.mjs http://localhost:4173/ out.png`

## Ideas next

- Port the spectrum to an FFT on WebGPU compute (three's `WebGPURenderer` + TSL) for 256² × 3 cascades
- Persistent foam via a ping-pong render target accumulating the Jacobian
- Screen-space refraction of the wall grid through the surface
