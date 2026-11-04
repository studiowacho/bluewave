// Repacks each GLB into <id>.json (base64 geometry) + <id>.png (texture) for hosts that cannot serve .glb.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
const [src = 'public/models', out = 'dist-single/models'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SIZE = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
for (const f of readdirSync(src).filter((n) => n.endsWith('.glb'))) {
  const id = f.replace('.glb', '');
  const b = readFileSync(`${src}/${f}`);
  const jsonLen = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  const bin = b.subarray(20 + jsonLen + 8);
  const read = (ai) => {
    const a = gltf.accessors[ai], v = gltf.bufferViews[a.bufferView];
    const n = a.count * COMPS[a.type] * SIZE[a.componentType];
    const start = (v.byteOffset || 0) + (a.byteOffset || 0);
    return { b64: Buffer.from(bin.subarray(start, start + n)).toString('base64'), type: a.componentType };
  };
  const prim = gltf.meshes[0].primitives[0];
  const pos = read(prim.attributes.POSITION), uv = read(prim.attributes.TEXCOORD_0);
  const idx = prim.indices != null ? read(prim.indices) : null;
  writeFileSync(`${out}/${id}.json`, JSON.stringify({ position: pos.b64, uv: uv.b64, index: idx?.b64 ?? null, indexType: idx?.type ?? null }));
  const mat = gltf.materials[prim.material];
  const img = gltf.images[gltf.textures[mat.pbrMetallicRoughness.baseColorTexture.index].source];
  const iv = gltf.bufferViews[img.bufferView];
  writeFileSync(`${out}/${id}.png`, bin.subarray(iv.byteOffset || 0, (iv.byteOffset || 0) + iv.byteLength));
  console.log(`packed ${id}`);
}
