// Draco-compress the GLBs written by the Blender scripts (in place).
// Draco decodes back to float attributes, so instanced geometry keeps its
// original coordinates (unlike position quantisation).
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../public/assets/models/', import.meta.url).pathname;
const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

for (const f of readdirSync(dir).filter((n) => n.endsWith('.glb'))) {
  const path = join(dir, f);
  const before = statSync(path).size;
  const doc = await io.read(path);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_draco_mesh_compression')) {
    console.log(`${f}: already compressed`);
    continue;
  }
  // No dedup/prune: the materials are untextured placeholders (textures are
  // bound in the game by material name), so pruning would drop the UVs.
  await doc.transform(draco({ method: 'edgebreaker', quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 14, quantizeColor: 10, quantizeGeneric: 12 }));
  await io.write(path, doc);
  console.log(`${f}: ${(before / 1024).toFixed(0)} KB -> ${(statSync(path).size / 1024).toFixed(0)} KB`);
}
