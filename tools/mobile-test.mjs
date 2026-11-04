// Phone-sized touch test: opens each sheet by tapping, checks tap target sizes and that nothing overflows.
import puppeteer from 'puppeteer-core';
const [url, outDir, w = 390, h = 844] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('pageerror:', e.message));
await p.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2000));
const report = await p.evaluate(() => {
  const small = [];
  document.querySelectorAll('.toolbar button, .credit a').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) small.push(`${el.textContent.trim() || el.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  return { overflowX: document.documentElement.scrollWidth > innerWidth, small };
});
console.log('closed:', JSON.stringify(report));
await p.screenshot({ path: `${outDir}/m-closed.png` });
for (const id of ['sea', 'life', 'light']) {
  await p.tap(`[data-panel=${id}]`);
  await new Promise((r) => setTimeout(r, 900));
  const info = await p.evaluate(() => {
    const pop = document.getElementById('pop').getBoundingClientRect();
    const bar = document.querySelector('.toolbar').getBoundingClientRect();
    const title = document.querySelector('.title').getBoundingClientRect();
    const small = [];
    document.querySelectorAll('#pop button, #pop input').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 36 || r.width < 36) small.push(`${el.id || el.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    const pe = document.getElementById('pop');
    return { pop: [Math.round(pop.left), Math.round(pop.top), Math.round(pop.right), Math.round(pop.bottom)], barTop: Math.round(bar.top), titleBottom: Math.round(title.bottom), scrolls: pe.scrollHeight > pe.clientHeight, inView: pop.left >= 0 && pop.right <= innerWidth, small };
  });
  console.log(id, JSON.stringify(info));
  await p.screenshot({ path: `${outDir}/m-${id}.png` });
  await p.tap(`[data-panel=${id}]`);
  await new Promise((r) => setTimeout(r, 500));
}
// slider drag inside the sheet should change the value, not orbit the camera
await p.tap('[data-panel=sea]'); await new Promise((r) => setTimeout(r, 700));
const before = await p.$eval('#c-swellH', (e) => e.value);
const box = await (await p.$('#c-swellH')).boundingBox();
await p.touchscreen.touchStart(box.x + box.width * 0.3, box.y + box.height / 2);
await p.touchscreen.touchMove(box.x + box.width * 0.8, box.y + box.height / 2);
await p.touchscreen.touchEnd();
const after = await p.$eval('#c-swellH', (e) => e.value);
console.log('slider', before, '->', after);
// tap the ocean closes the sheet
await p.touchscreen.tap(w / 2, 300); await new Promise((r) => setTimeout(r, 500));
console.log('closed by ocean tap:', await p.$eval('#pop', (e) => !e.classList.contains('open')));
await b.close();
