// The Service Worker's build (sw-build.ts), run by `npm test` in plain Node,
// which strips the TypeScript types. e2e/offline.spec.ts checks a real build.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { precacheList, siteServiceWorkerPlugin, swSource } from '../sw-build.ts';

const template = readFileSync(new URL('../src/sw.template.js', import.meta.url), 'utf8');
const files = [
  'index.html',
  'info/index.html',
  'assets/index-AbCd1234.js',
  'assets/index-AbCd1234.js.map',
  'version.json',
  'worker.js',
  'wasm_exec.js',
  'mhj-dojo.wasm',
  'icon.svg',
  'og-image.png',
];

test('precaches the pages, assets, icons and the engine at its ?v=', () => {
  assert.deepEqual(precacheList({ engine: 'e1', files }), [
    './',
    'assets/index-AbCd1234.js',
    'icon.svg',
    'info/',
    'mhj-dojo.wasm?v=e1',
    'wasm_exec.js?v=e1',
    'worker.js?v=e1',
  ]);
});

test('sw.js carries the build id and the list', () => {
  const src = swSource({ off: false, template, id: 'abc', engine: 'e1', files });
  assert.match(src, /^const BUILD = "abc";$/m);
  const list = JSON.parse(/^const PRECACHE = (\[[^\]]*\]);$/m.exec(src)[1]);
  assert.deepEqual(list, precacheList({ engine: 'e1', files }));
  assert.doesNotMatch(src, /global BUILD/);
});

test('the kill switch: sw.js deletes the caches and unregisters, the page is told', () => {
  const src = swSource({ off: true, template, id: 'abc', engine: 'e1', files });
  assert.match(src, /caches\.delete/);
  assert.match(src, /registration\.unregister\(\)/);
  assert.match(src, /skipWaiting/);
  assert.doesNotMatch(src, /PRECACHE|addEventListener\('fetch'/);

  const env = process.env.MHJDOJO_SW;
  try {
    for (const [value, off] of [['off', 'true'], [undefined, 'false']]) {
      if (value === undefined) delete process.env.MHJDOJO_SW;
      else process.env.MHJDOJO_SW = value;
      assert.equal(siteServiceWorkerPlugin().config().define.__MHJDOJO_SW_OFF__, off);
    }
  } finally {
    if (env === undefined) delete process.env.MHJDOJO_SW;
    else process.env.MHJDOJO_SW = env;
  }
});
