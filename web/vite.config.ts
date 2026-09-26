import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ command, mode }) => {
  // `--mode site` (npm run build:site): the static site that runs the
  // practice engine as WebAssembly (issue #67). Relative asset paths let it
  // be served from any subpath; site-public/ holds the worker, and `make
  // wasm` puts mhj2.wasm and Go's wasm_exec.js next to it.
  if (mode === 'site') {
    if (command === 'build' && !existsSync(new URL('site-public/mhj2.wasm', import.meta.url))) {
      throw new Error('site-public/mhj2.wasm is missing: run `make wasm` first (or `make site`)');
    }
    return {
      plugins: [preact()],
      base: './',
      publicDir: 'site-public',
      build: {
        outDir: 'dist-site',
        emptyOutDir: true,
      },
    };
  }
  return {
    plugins: [preact()],
    build: {
      outDir: '../internal/server/static',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8765',
          changeOrigin: true,
        },
      },
    },
  };
});
