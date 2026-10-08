// Builds the web version of 浩的岛 (npm run build:web):
//
//   dist-web/site/index.html    the page to publish: game code and styles inlined,
//   dist-web/site/assets/...    with the assets next to it, fetched by relative URL
//   dist-web/hiroshi-island-offline.html
//                               everything in one file, opens straight from disk
//
// Nothing needs WebAssembly: the models are written back without Draco and,
// like the other binary data, gzipped here and unpacked in the browser with
// DecompressionStream (see src/core/assets.js). The artifact host serves no raw
// binary type, so next to the page those files travel as base64 text.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public/assets');
const out = join(root, 'dist-web');
const site = join(out, 'site');

// ------------------------------------------------------------ 1. the game code
execSync('npx vite build --mode web', { cwd: root, stdio: 'inherit' });
const bundleDir = join(out, 'bundle/assets');
const emitted = readdirSync(bundleDir);
const stray = emitted.filter((f) => !/\.(js|css)$/.test(f));
if (stray.length) throw new Error(`the web bundle must be self-contained, found: ${stray.join(', ')}`);
const js = readFileSync(join(bundleDir, emitted.find((f) => f.endsWith('.js'))), 'utf8').replaceAll('</script', '<\\/script');
const css = readFileSync(join(bundleDir, emitted.find((f) => f.endsWith('.css'))), 'utf8');

// --------------------------------------------------------------- 2. the assets
rmSync(site, { recursive: true, force: true });
const remote = {}; // asset path -> { url, gz, text } for files renamed on the way
const inline = {}; // asset path -> { b64, gz? } for the offline file
function put(path, bytes, binary) {
  const gz = binary ? gzipSync(bytes, { level: 9 }) : null;
  const name = binary ? `${path}.gz.b64.txt` : path;
  mkdirSync(dirname(join(site, 'assets', name)), { recursive: true });
  writeFileSync(join(site, 'assets', name), binary ? gz.toString('base64') : bytes);
  if (binary) remote[path] = { url: name, gz: true, text: true };
  inline[path] = binary ? { b64: gz.toString('base64'), gz: true } : { b64: bytes.toString('base64') };
}

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
for (const f of readdirSync(join(src, 'models')).filter((n) => n.endsWith('.glb'))) {
  const doc = await io.read(join(src, 'models', f));
  for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
  put(`models/${f}`, Buffer.from(await io.writeBinary(doc)), true);
}
for (const dir of ['data', 'textures']) {
  for (const f of readdirSync(join(src, dir))) put(`${dir}/${f}`, readFileSync(join(src, dir, f)), f.endsWith('.bin'));
}

// ---------------------------------------------------------------- 3. the pages
const loading = `<div class="loading" id="loading"><div class="loading-title">浩的岛</div><div class="bar"><i></i></div><div class="loading-note">正在把小岛搬进浏览器……</div></div>`;
// the serif face for the story text; the system serif stands in until it arrives
const fonts = `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600&display=swap';document.head.appendChild(l);})();`;
const page = (files) => `<title>浩的岛</title>
<meta name="description" content="带着一台旧相机沿溪水补拍浩留下的照片：一座用 Blender 程序化建模、Three.js 实时渲染的写实小岛。">
<style>${css}</style>
<canvas id="view" aria-label="浩的岛"></canvas>
<div id="ui">${loading}</div>
<script>window.__HIROSHI_PACK__=${JSON.stringify({ files })};</script>
<script>${fonts}</script>
<script type="module">${js}</script>
`;
// The published page is wrapped in a document skeleton by the host; local
// copies get an equivalent one here.
const skeleton = (body) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${body}</body>
</html>
`;

const sitePage = page(remote);
writeFileSync(join(site, 'index.html'), sitePage);
writeFileSync(join(site, 'local.html'), skeleton(sitePage)); // for testing, not published
writeFileSync(join(out, 'hiroshi-island-offline.html'), skeleton(page(inline)));

// ------------------------------------------------------------------- summary
const published = {};
const walk = (dir, rel = '') => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, `${rel}${f}/`);
    else if (rel) published[`${rel}${f}`] = p.slice(root.length + 1);
  }
};
walk(site);
writeFileSync(join(out, 'files.json'), JSON.stringify(published, null, 1));
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const total = Object.values(published).reduce((s, p) => s + statSync(join(root, p)).size, 0);
console.log(`page      ${mb(statSync(join(site, 'index.html')).size)}`);
console.log(`assets    ${mb(total)} in ${Object.keys(published).length} files`);
console.log(`offline   ${mb(statSync(join(out, 'hiroshi-island-offline.html')).size)}`);
