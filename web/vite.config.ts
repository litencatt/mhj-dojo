import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// A hex digest of files (their paths relative to web/, and contents), in
// the order given.
function digest(files: URL[], length: number): string {
  const base = new URL('./', import.meta.url).pathname;
  const hash = createHash('sha256');
  for (const f of files) {
    if (!existsSync(f)) continue;
    hash.update(`${f.pathname.slice(base.length)}\0`);
    hash.update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, length);
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
    const engineHash = createHash('sha256');
    for (const f of engine) if (existsSync(f)) engineHash.update(readFileSync(f));
    // The site's build, which the page compares with version.json (written
    // next to it) to tell that a newer deploy is out (src/version.ts): the
    // commit it was built from (MHJDOJO_VERSION overrides it, e.g. for a
    // build outside git) and an id hashing everything the build reads, so a
    // redeploy of the same sources is not "newer" but any change that
    // reaches the page is. The build time is only shown. Only the site gets
    // them: the default build is committed and must come out the same on
    // every build (CI checks it), so the local version shows the server's
    // GET /api/version.
    const version = process.env.MHJDOJO_VERSION || gitShortSha() || 'dev';
    const src = readdirSync(new URL('src/', import.meta.url), { recursive: true, encoding: 'utf8' })
      .sort()
      .map((f) => new URL(`src/${f}`, import.meta.url))
      .filter((f) => statSync(f).isFile());
    const inputs = ['index.html', 'package-lock.json', 'vite.config.ts', '.env.site'].map((f) => new URL(f, import.meta.url));
    const id = digest([...engine, ...inputs, ...src], 16);
    const built = new Date().toISOString();
    return {
      plugins: [
        preact(),
        {
          name: 'mhj-dojo-version-json',
          apply: 'build',
          generateBundle() {
            this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version, id, built })}\n` });
          },
        },
      ],
      define: {
        'import.meta.env.VITE_MHJDOJO_ENGINE': JSON.stringify(engineHash.digest('hex').slice(0, 12)),
        __MHJDOJO_SITE_VERSION__: JSON.stringify(version),
        __MHJDOJO_SITE_ID__: JSON.stringify(id),
        __MHJDOJO_SITE_BUILT__: JSON.stringify(built),
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
    define: {
      __MHJDOJO_SITE_VERSION__: 'null',
      __MHJDOJO_SITE_ID__: 'null',
      __MHJDOJO_SITE_BUILT__: 'null',
    },
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
