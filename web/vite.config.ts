import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The checkout's commit (7 hex digits), or '' outside git.
function gitShortSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export default defineConfig(({ command, mode }) => {
  // `--mode site` (npm run build:site): the static site that runs the
  // practice engine as WebAssembly (issue #67). Relative asset paths let it
  // be served from any subpath; site-public/ holds the worker, and `make
  // wasm` puts mhj-dojo.wasm and Go's wasm_exec.js next to it.
  if (mode === 'site') {
    const engine = ['worker.js', 'wasm_exec.js', 'mhj-dojo.wasm'].map((f) => new URL(`site-public/${f}`, import.meta.url));
    const missing = engine.filter((f) => !existsSync(f));
    if (command === 'build' && missing.length > 0) {
      throw new Error(`${missing.map((f) => f.pathname).join(', ')} missing: run \`make wasm\` first (or \`make site\`)`);
    }
    // One version for the three engine files, which keep fixed names: the
    // page loads them with ?v=<it> so a deploy never mixes cached and new
    // copies (src/wasm.ts, site-public/worker.js).
    const hash = createHash('sha256');
    for (const f of engine) if (existsSync(f)) hash.update(readFileSync(f));
    // The site's build: the commit it was built from and when. The page
    // compares them with version.json, written next to it, to tell that a
    // newer deploy is out (src/version.ts). Only the site gets them: the
    // default build is committed and must come out the same on every build
    // (CI checks it), so the local version shows the server's GET /api/version.
    // MHJDOJO_VERSION overrides the commit, e.g. for a build outside git.
    const version = process.env.MHJDOJO_VERSION || gitShortSha() || 'dev';
    const built = new Date().toISOString();
    return {
      plugins: [
        preact(),
        {
          name: 'mhj-dojo-version-json',
          apply: 'build',
          generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version, built })}\n` });
          },
        },
      ],
      define: {
        'import.meta.env.VITE_MHJDOJO_ENGINE': JSON.stringify(hash.digest('hex').slice(0, 12)),
        'import.meta.env.VITE_MHJDOJO_VERSION': JSON.stringify(version),
        'import.meta.env.VITE_MHJDOJO_BUILT': JSON.stringify(built),
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
