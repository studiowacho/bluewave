import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 800 });
p.on('console', m => console.log('console:', m.text().slice(0, 300)));
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto(url); await p.waitForFunction(() => document.title === 'ready', { timeout: 60000 });
await p.screenshot({ path: out }); await b.close();
