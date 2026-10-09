// The page's side of the Service Worker (src/sw.template.js; issue #192).

// The measure src/engine.ts records once the engine has started.
const ENGINE_READY = 'mhj-dojo:wasm-init';

/**
 * Registers sw.js?v=<this build's id> (a URL the CDN has not cached yet) in
 * production builds on secure origins (https or localhost), once the engine
 * has started and the browser is idle, so that its precaching doesn't
 * compete with the first load (it gets the engine from the HTTP cache). A
 * waiting worker of this page's own build takes over at once: the page
 * already runs that build. With the kill switch (MHJDOJO_SW=off at build
 * time) it unregisters any worker and deletes its caches instead; that is how
 * the kill switch reaches pages whose cached sw.js?v=<old id> still runs.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !isSecureContext) return;
  const sw = navigator.serviceWorker;
  const run = async () => {
    try {
      if (__MHJDOJO_SW_OFF__) {
        for (const reg of await sw.getRegistrations()) await reg.unregister();
        for (const key of await caches.keys()) if (key.startsWith('mhj-dojo-')) await caches.delete(key);
        return;
      }
      const reg = await sw.register(`sw.js?v=${__MHJDOJO_SITE_ID__}`, { scope: './' });
      const activate = () => {
        const w = reg.waiting;
        if (w && new URL(w.scriptURL).searchParams.get('v') === __MHJDOJO_SITE_ID__) w.postMessage('SKIP_WAITING');
      };
      // It may be installing already when register resolves.
      const watch = () => reg.installing?.addEventListener('statechange', activate);
      activate();
      watch();
      reg.addEventListener('updatefound', watch);
    } catch {
      // Unsupported or blocked: the page works without it.
    }
  };
  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(() => void run()) : setTimeout(() => void run()));
  if (performance.getEntriesByName(ENGINE_READY, 'measure').length > 0) {
    idle();
    return;
  }
  const observer = new PerformanceObserver((list) => {
    if (list.getEntriesByName(ENGINE_READY).length === 0) return;
    observer.disconnect();
    idle();
  });
  observer.observe({ type: 'measure', buffered: true });
}
