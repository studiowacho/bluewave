import puppeteer from 'puppeteer-core';
const [url, out, w=1440, h=900, actions=''] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.setViewport({ width: +w, height: +h });
p.on('console', m => console.log('console:', m.type(), m.text().slice(0, 1500)));
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto(url, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
if (actions) { await p.evaluate(actions); await new Promise(r => setTimeout(r, 4000)); }
console.log('STATE', await p.evaluate(() => JSON.stringify({t: window.__sea?.time, rogue: window.__sea?.rogue, r: window.__sea?.U.uRogue.value, r2: window.__sea?.U.uRogue2.value})));
await p.screenshot({ path: out });
await b.close();
