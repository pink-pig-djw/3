// Write uncompressed copies of the Draco GLBs (Blender's bundled importer in
// the pip `bpy` build cannot decode Draco). Usage: node tools/decompress-models.mjs <outDir>
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('../public/assets/models/', import.meta.url).pathname;
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
for (const f of readdirSync(src).filter((n) => n.endsWith('.glb'))) {
  const doc = await io.read(join(src, f));
  for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
  await io.write(join(out, f), doc);
  console.log('decompressed', f);
}
