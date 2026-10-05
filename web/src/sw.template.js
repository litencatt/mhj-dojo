// The site's Service Worker (issue #192), for offline use and instant repeat
// loads. Not bundled: the mhj-dojo-sw plugin (vite.config.ts) fills in
// BUILD (the build's id, as in version.json) and PRECACHE (paths relative to
// this file) and writes it as sw.js; src/sw.ts registers it.
//
// - install: caches this build's files under mhj-dojo-<BUILD>
// - the pages (navigations): network first, the cached copy when offline
// - the other precached files (content-hashed or ?v=<hash>): cache first
// - anything else, version.json included: not handled, so the network
// - activate: deletes the other builds' caches
//
// A new build's worker waits until a page of that build, or the update
// banner's 再読み込み, sends it SKIP_WAITING (src/sw.ts).
/* global BUILD, PRECACHE */
const CACHE = `mhj-dojo-${BUILD}`;
const PAGES = ['./', 'info/'];
const href = (path) => new URL(path, self.registration.scope).href;
const precached = new Set(PRECACHE.map(href));
const pages = new Set(PAGES.map(href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map(async (path) => {
          // A page past the CDN's cached copy (as 再読み込み does), so it
          // matches this build's assets; hashed files from any cache.
          const page = PAGES.includes(path);
          const res = await fetch(page ? `${path}?_v=${BUILD}` : path, { cache: page ? 'no-cache' : 'default' });
          if (!res.ok) throw new Error(`${path}: ${res.status}`);
          await cache.put(href(path), page ? new Response(res.body, res) : res);
        }),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mhj-dojo-') && k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    if (!pages.has(url.origin + url.pathname)) return;
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(url.origin + url.pathname, { cacheName: CACHE })) ?? Response.error()),
    );
    return;
  }
  if (!precached.has(url.href)) return;
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreVary: true }).then((res) => res ?? fetch(req)));
});
