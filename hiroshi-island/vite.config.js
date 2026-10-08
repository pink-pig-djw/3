import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// `vite build --mode web` makes the bundle for the single-page web version
// (see tools/build-web.mjs): one JS file, no public/ copy, no Draco decoder.
export default defineConfig(({ mode }) =>
  mode === 'web'
    ? {
        base: './',
        publicDir: false,
        resolve: {
          alias: [{ find: /^three\/addons\/loaders\/DRACOLoader\.js$/, replacement: fileURLToPath(new URL('./src/core/no-draco.js', import.meta.url)) }],
        },
        build: {
          outDir: 'dist-web/bundle',
          emptyOutDir: true,
          target: 'es2022',
          modulePreload: false,
          cssCodeSplit: false,
          assetsInlineLimit: 0,
          chunkSizeWarningLimit: 4000,
        },
      }
    : {
        base: './',
        server: { host: true },
        build: {
          target: 'es2022',
          chunkSizeWarningLimit: 2000,
        },
      },
);
