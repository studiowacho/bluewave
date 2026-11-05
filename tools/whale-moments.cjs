// Renders key whale moments (cruise bank, blow, fluke-up dive, breach rise/air/landing).
// Usage: npx vite build && npx vite preview --port 4173, then
//   NODE_PATH=$(npm root -g) node tools/whale-moments.cjs http://localhost:4173/ <outDir>
const { chromium } = require('playwright');
const [url, outDir] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 640, height: 400 } });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); p.setDefaultTimeout(150000);
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(4000);
  await p.evaluate(() => { const s = window.__sea; for (const k in s.wild.on) s.wild.on[k] = k === 'whale'; s.wild.n.whale = 1; s.params.paused = true;
    document.querySelector('.title')?.remove(); document.querySelector('.dock')?.remove(); document.querySelector('.credit')?.remove();
    const fake = { domElement: { height: 400 } };
    window.__until = (pred, max) => { const s = window.__sea; for (let k = 0; k < max / 0.05; k++) { s.wildlife.update(0.05, s.time, s.camera, fake); const w = s.wildlife.whales[0]; if (w && pred(w)) return k * 0.05; } return -1; };
    window.__cam = (dist, h, back = 0) => { const s = window.__sea, w = s.wildlife.whales[0], P = w.pos, fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
      s.controls.target.set(P.x, Math.max(P.y, -3), P.z); s.camera.position.set(P.x + fz * dist - fx * back, h, P.z - fx * dist - fz * back); s.controls.update();
      return `${w.mode} y=${P.y.toFixed(1)} pitch=${w.pitch.toFixed(2)} roll=${w.roll.toFixed(2)}`; };
  });
  await p.waitForTimeout(400);
  const shots = [
    ['a_cruise', 'w => w.mode === "cruise" && Math.abs(w.roll) > 0.18', 60, [26, -6, 6]],
    ['b_blow', 'w => w.mode === "surface" && w.modeT > 1.4', 120, [30, 3, 8]],
    ['c_flukeup', 'w => w.mode === "dive" && w.tailUp === 1 && w.pitch < -0.6', 120, [30, 2, 4]],
    ['d_rise', '(w => { if (!window.__b) { window.__b = 1; window.__sea.wildlife.breach(); } return w.mode === "rise" && w.modeT > 0.8; })', 60, [30, -1, 0]],
    ['e_air', 'w => w.mode === "air" && w.vel.y < 1.5', 20, [34, 3, 0]],
    ['f_land', 'w => w.mode === "recover" && w.modeT > 0.25', 20, [34, 3, 0]],
  ];
  for (const [name, pred, max, [d, hgt, back]] of shots) {
    const t = await p.evaluate(([pred, max]) => window.__until(eval(pred), max), [pred, max]);
    const info = await p.evaluate(([d, hgt, back]) => window.__cam(d, hgt, back), [d, hgt, back]);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${outDir}/${name}.png` });
    console.log(name, 'after', t.toFixed(1), 's:', info);
  }
  await b.close();
})();
