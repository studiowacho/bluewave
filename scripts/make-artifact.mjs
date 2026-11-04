// Builds a single self-contained HTML page that loads three from jsDelivr via an import map.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const THREE_VERSION = '0.170.0';
const html = readFileSync('index.html', 'utf8');
const wildlife = readFileSync('src/wildlife.js', 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');
const wrapped = `const { createWildlife, SPECIES, ICONS } = (() => {\n${wildlife}\nreturn { createWildlife, SPECIES, ICONS };\n})();`;
const js = readFileSync('src/main.js', 'utf8')
  .replace(/^import \{[^}]*\} from '\.\/wildlife\.js';$/m, () => wrapped);
const importmap = `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"}}</script>`;
const out = html.replace('<script type="module" src="./src/main.js"></script>', `${importmap}\n<script>window.BLUE_WAVE_PACKED = true;</script>\n<script type="module">\n${js}\n</script>`);
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/swell-study.html', out);
console.log('wrote dist-single/swell-study.html', out.length, 'bytes');
