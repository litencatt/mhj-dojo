import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { changelogHtml } from './src/changelog';

// The site's own public base URL (must end with '/'), for the absolute
// og:url/og:image link-preview tags below. Defaults to the deployed site
// so a plain `npm run build` still produces working previews; CI
// overrides it (vars.SITE_URL) for a preview/staging deploy.
const SITE_URL_DEFAULT = 'https://mhj-dojo.lolipop-now.app/';

function resolveSiteUrl(): string {
  const raw = process.env.MHJDOJO_SITE_URL || SITE_URL_DEFAULT;
  if (!/^https?:\/\/.*\/$/.test(raw)) {
    throw new Error(`MHJDOJO_SITE_URL must be an absolute http(s) URL ending with '/' (got ${JSON.stringify(raw)})`);
  }
  return raw;
}

// The pages: the app, and the 更新情報 page at info/ (src/changelog.ts).
const PAGES = {
  index: fileURLToPath(new URL('index.html', import.meta.url)),
  info: fileURLToPath(new URL('info/index.html', import.meta.url)),
};

// CHANGELOG.md, which tagpr updates on every release (.tagpr).
const CHANGELOG = new URL('../CHANGELOG.md', import.meta.url);

// Renders CHANGELOG.md into the 更新情報 page, which is static: the Release
// site workflow builds the tag, whose tree has the release's CHANGELOG.md
// (tagpr commits it before tagging).
function siteChangelogPlugin(): Plugin {
  return {
    name: 'mhj-dojo-site-changelog',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.path !== '/info/index.html') return html;
        return html.replace('<!--changelog-->', changelogHtml(readFileSync(CHANGELOG, 'utf8')));
      },
    },
  };
}

// Injects the absolute og:url/og:image(+size/alt)/twitter:image tags, for
// the published site's URL (a crawler fetches og:image directly, without
// page context, so it must be absolute). index.html carries the rest of the
// OG/Twitter tags itself, since those don't depend on any URL.
function siteOgTagsPlugin(siteUrl: string): Plugin {
  const image = `${siteUrl}og-image.png`;
  return {
    name: 'mhj-dojo-site-og-tags',
    transformIndexHtml(_html, ctx) {
      // Each page's own URL: the app's, or info/ for the 更新情報 page.
      const url = siteUrl + ctx.path.replace(/^\//, '').replace(/index\.html$/, '');
      return [
        { tag: 'meta', attrs: { property: 'og:url', content: url }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: 'mhj-dojo 麻雀道場のタイトルと麻雀牌' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' },
      ];
    },
  };
}

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
    hash.update(`${relative(base, f.pathname)}\0`);
    hash.update(readFileSync(f));
  }
  return hash.digest('hex').slice(0, length);
}

export default defineConfig(({ command }) => {
  // The site, which runs the engine as WebAssembly in the browser (issues
  // #67, #147): the public site serves it, and mhj-dojo embeds it (make
  // embed). Relative asset paths let it be served from any subpath;
  // site-public/ holds the worker, and `make wasm` puts mhj-dojo.wasm and
  // Go's wasm_exec.js next to it (the dev server needs them too).
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
  // reaches the page is. The build time is only shown.
  const version = process.env.MHJDOJO_VERSION || gitShortSha() || 'dev';
  // The release (v2026.0927.0: the date and the release's number that day,
  // from 0) when the Release site workflow builds it for a tag; the header shows it instead
  // of the commit. Empty for `make deploy` and local builds.
  const release = process.env.MHJDOJO_RELEASE || null;
  if (release !== null && !/^v\d{4}\.\d{4}\.\d+$/.test(release)) {
    throw new Error(`MHJDOJO_RELEASE must look like v2026.0927.0, not ${JSON.stringify(release)}`);
  }
  const src = readdirSync(new URL('src/', import.meta.url), { recursive: true, encoding: 'utf8' })
    .sort()
    .map((f) => new URL(`src/${f}`, import.meta.url))
    .filter((f) => statSync(f).isFile());
  const inputs = ['index.html', 'info/index.html', '../CHANGELOG.md', 'package-lock.json', 'vite.config.ts'].map((f) => new URL(f, import.meta.url));
  const id = digest([...engine, ...inputs, ...src], 16);
  const built = new Date().toISOString();
  return {
    plugins: [
      preact(),
      siteChangelogPlugin(),
      siteOgTagsPlugin(resolveSiteUrl()),
      {
        name: 'mhj-dojo-version-json',
        apply: 'build',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version, release, id, built })}\n` });
        },
      },
    ],
    define: {
      'import.meta.env.VITE_MHJDOJO_ENGINE': JSON.stringify(engineHash.digest('hex').slice(0, 12)),
      __MHJDOJO_SITE_VERSION__: JSON.stringify(version),
      __MHJDOJO_SITE_ID__: JSON.stringify(id),
      __MHJDOJO_SITE_BUILT__: JSON.stringify(built),
      __MHJDOJO_SITE_RELEASE__: JSON.stringify(release),
    },
    base: './',
    publicDir: 'site-public',
    build: {
      outDir: 'dist-site',
      emptyOutDir: true,
      rolldownOptions: { input: PAGES },
      modulePreload: { polyfill: false },
    },
  };
});
