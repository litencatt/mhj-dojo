// The site's Service Worker (issue #192), for offline use and instant repeat
// loads. Not bundled: sw-build.ts fills in BUILD (the build's id, as in
// version.json) and PRECACHE (paths relative to this file) and writes it as
// sw.js; src/sw.ts registers it.
//
// - install: caches this build's files under mhj-dojo-<BUILD>
// - the pages (navigations): the network, else (offline, a 5xx or no answer
//   in 4 seconds) the cached copy
// - the other precached files (content-hashed or ?v=<hash>): cache first
// - anything else, version.json included: not handled, so the network
// - activate: deletes the other builds' caches
//
// A new build's worker waits until a page of that build sends it
// SKIP_WAITING (src/sw.ts).
const BUILD = "09d4df2a781ba180";
const PRECACHE = [
  "./",
  "THIRD_PARTY_LICENSES.txt",
  "apple-touch-icon.png",
  "assets/index-2wAablIU.css",
  "assets/index-BE5NEz_j.js",
  "assets/info-BYxFSwl9.css",
  "assets/info-pRw5ja7W.js",
  "favicon.ico",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon.svg",
  "info/",
  "manifest.webmanifest",
  "mhj-dojo.wasm?v=36efac4b5f3d",
  "wasm_exec.js?v=36efac4b5f3d",
  "worker.js?v=36efac4b5f3d"
];
const CACHE = `mhj-dojo-${BUILD}`;
const NETWORK_TIMEOUT_MS = 4000;
const href = (path) => new URL(path, self.registration.scope).href;
const precached = new Set(PRECACHE.map(href));
// Each page's URLs (without the query), and the path it is cached by.
const pages = new Map([
  [href('./'), './'],
  [href('index.html'), './'],
  [href('info/'), 'info/'],
  [href('info'), 'info/'],
]);
const isPage = (path) => path === './' || path === 'info/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map(async (path) => {
          if (!isPage(path)) {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`${path}: ${res.status}`);
            return cache.put(href(path), res);
          }
          // A page past the CDN's cached copy (as 再読み込み does), which
          // must be this build's: every asset it loads is precached.
          // Otherwise the install fails, and the old worker stays.
          const res = await fetch(`${path}?_v=${BUILD}`, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`${path}: ${res.status}`);
          const html = await res.text();
          for (const m of html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)) {
            if (!precached.has(new URL(m[1], href(path)).href)) throw new Error(`${path}: ${m[1]} is not this build's`);
          }
          return cache.put(href(path), new Response(html, { headers: res.headers }));
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

async function page(req, path) {
  const network = fetch(req);
  network.catch(() => {}); // answered below, or not needed
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS));
    const res = await Promise.race([network, timeout]);
    if (res.status < 500) return res;
  } catch {
    // offline or slow: the cached copy
  }
  return (await caches.match(href(path), { cacheName: CACHE })) ?? network;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    const path = pages.get(url.origin + url.pathname);
    if (path) event.respondWith(page(req, path));
    return;
  }
  if (!precached.has(url.href)) return;
  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreVary: true }).then((res) => res ?? fetch(req)));
});
