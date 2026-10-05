// The Service Worker's build (issue #192): sw.js from src/sw.template.js,
// with this build's id and the files it precaches, all relative to it: the
// pages, the bundle, and site-public/ (the engine's three files with the
// ?v=<hash> the page loads them by), except og-image.png (for link
// previews) and version.json, which always comes from the network.
// src/sw.ts registers it. scripts/sw.test.mjs tests swSource.
//
// MHJDOJO_SW=off is the kill switch: the page then unregisters any worker
// and deletes its caches, and the sw.js written instead does the same for
// pages of older builds that still register it.
import { readFileSync, readdirSync } from 'node:fs';
import type { Plugin } from 'vite';

const ENGINE = ['worker.js', 'wasm_exec.js', 'mhj-dojo.wasm'];

// The worker that undoes the others: deletes the caches and unregisters.
const KILL_SWITCH = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mhj-dojo-')).map((k) => caches.delete(k)))).then(() => self.registration.unregister()));
});
`;

export interface SwBuild {
  off: boolean;
  template: string; // src/sw.template.js
  id: string; // the build's id (version.json)
  engine: string; // the engine files' ?v=
  files: string[]; // the bundle's files and site-public/'s, relative to the site's root
}

/** The paths sw.js precaches: the pages as ./ and info/, the engine with its ?v=. */
export function precacheList({ engine, files }: Pick<SwBuild, 'engine' | 'files'>): string[] {
  return files
    .filter((f) => f !== 'version.json' && f !== 'og-image.png' && !f.endsWith('.map'))
    .map((f) => (ENGINE.includes(f) ? `${f}?v=${engine}` : f.replace(/(^|\/)index\.html$/, '$1') || './'))
    .sort();
}

/** sw.js's source. */
export function swSource(b: SwBuild): string {
  if (b.off) return KILL_SWITCH;
  return b.template.replace('/* global BUILD, PRECACHE */', `const BUILD = ${JSON.stringify(b.id)};\nconst PRECACHE = ${JSON.stringify(precacheList(b), null, 2)};`);
}

export function siteServiceWorkerPlugin(): Plugin {
  const off = process.env.MHJDOJO_SW === 'off';
  let id = '';
  let engine = '';
  let publicDir = '';
  return {
    name: 'mhj-dojo-sw',
    apply: 'build',
    config: () => ({ define: { __MHJDOJO_SW_OFF__: JSON.stringify(off) } }),
    configResolved(config) {
      id = JSON.parse(config.define?.__MHJDOJO_SITE_ID__ as string);
      engine = JSON.parse(config.define?.['import.meta.env.VITE_MHJDOJO_ENGINE'] as string);
      publicDir = config.publicDir;
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const publicFiles = readdirSync(publicDir, { withFileTypes: true })
          .filter((d) => d.isFile() && !d.name.startsWith('.'))
          .map((d) => d.name);
        const template = readFileSync(new URL('src/sw.template.js', import.meta.url), 'utf8');
        const source = swSource({ off, template, id, engine, files: [...Object.keys(bundle), ...publicFiles] });
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
    },
  };
}
