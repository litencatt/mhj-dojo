import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig(({ command, mode }) => {
  // `--mode site` (npm run build:site): the static site that runs the
  // practice engine as WebAssembly (issue #67). Relative asset paths let it
  // be served from any subpath; site-public/ holds the worker, and `make
  // wasm` puts mhj2.wasm and Go's wasm_exec.js next to it.
  if (mode === 'site') {
    const engine = ['worker.js', 'wasm_exec.js', 'mhj2.wasm'].map((f) => new URL(`site-public/${f}`, import.meta.url));
    const missing = engine.filter((f) => !existsSync(f));
    if (command === 'build' && missing.length > 0) {
      throw new Error(`${missing.map((f) => f.pathname).join(', ')} missing: run \`make wasm\` first (or \`make site\`)`);
    }
    // One version for the three engine files, which keep fixed names: the
    // page loads them with ?v=<it> so a deploy never mixes cached and new
    // copies (src/wasm.ts, site-public/worker.js).
    const hash = createHash('sha256');
    for (const f of engine) if (existsSync(f)) hash.update(readFileSync(f));
    return {
      plugins: [preact()],
      define: {
        'import.meta.env.VITE_MHJ2_ENGINE': JSON.stringify(hash.digest('hex').slice(0, 12)),
      },
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
