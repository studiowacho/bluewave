// Builds a single self-contained HTML page that loads three from jsDelivr via an import map.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const THREE_VERSION = '0.170.0';
const html = readFileSync('index.html', 'utf8');
const js = readFileSync('src/main.js', 'utf8');
const importmap = `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"}}</script>`;
const out = html.replace('<script type="module" src="./src/main.js"></script>', `${importmap}\n<script type="module">\n${js}\n</script>`);
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/bluewave.html', out);
console.log('wrote dist-single/bluewave.html', out.length, 'bytes');
