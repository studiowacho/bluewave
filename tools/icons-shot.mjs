// Screenshots the Wildlife sheet at phone and desktop sizes and checks the icons loaded.
import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
  await p.goto(url, { waitUntil: 'networkidle0' });
  if (mobile) await p.tap('[data-panel=life]'); else await p.click('[data-panel=life]');
  await new Promise((r) => setTimeout(r, 1200));
  const info = await p.evaluate(() => [...document.querySelectorAll('.chip img')].map((i) => `${i.src.split('/').pop()}:${i.naturalWidth > 0 ? 'ok' : 'MISSING'}`));
  console.log(w, info.join(' '));
  
  await new Promise((r) => setTimeout(r, 300));
  const clip = await p.$eval('#pop', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await p.screenshot({ path: `${out}/icons-${w}.png`, clip });
  await p.close();
}
await b.close();
