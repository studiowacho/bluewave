// Downloads the Higgsfield-generated animal models into public/models (skips files already present).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const urls = JSON.parse(readFileSync(new URL('./models.json', import.meta.url)));
mkdirSync('public/models', { recursive: true });
for (const [name, url] of Object.entries(urls)) {
  const out = `public/models/${name}.glb`;
  if (existsSync(out)) continue;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log(`fetched ${name}`);
  } catch (e) {
    console.warn(`could not fetch ${name}: ${e.message} (falls back to the built-in model)`);
  }
}
