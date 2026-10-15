// Bundles the game into a single self-contained HTML file (code, models,
// animations, styles), so it runs from file://, inside an Android WebView, or
// as a hosted page without any other files.
//
//   dist/index.html     full document
//   dist/artifact.html  same page without the <html>/<head>/<body> wrapper
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const r = (p) => path.join(root, p);

const result = await esbuild.build({
  entryPoints: [r('src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  loader: { '.vrm': 'binary' },
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(r('src/style.css'), 'utf8');
const body = fs.readFileSync(r('src/body.html'), 'utf8');

const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bungee&family=ZCOOL+QingKe+HuangYou&display=swap">';
const head = `<title>地铁疾跑</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>${css}</style>`;
const content = `${head}\n${body}\n<script>${js}</script>\n`;

fs.mkdirSync(r('dist'), { recursive: true });
fs.writeFileSync(r('dist/artifact.html'), content);
fs.writeFileSync(r('dist/index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#ff7a1a">
${head}
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`);
const kb = (f) => `${(fs.statSync(r(f)).size / 1024 / 1024).toFixed(2)} MB`;
console.log(`dist/index.html ${kb('dist/index.html')}, dist/artifact.html ${kb('dist/artifact.html')}`);
