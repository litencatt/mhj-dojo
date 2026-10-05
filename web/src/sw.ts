// The page's side of the Service Worker (src/sw.template.js; issue #192).

// Whether w is this page's build's worker: each build registers
// sw.js?v=<its id>, a URL the CDN has not cached yet.
const ownBuild = (w: ServiceWorker | null) => w !== null && new URL(w.scriptURL).searchParams.get('v') === __MHJDOJO_SITE_ID__;

/**
 * Registers sw.js in production builds on secure origins (https or
 * localhost), after the page has loaded. A waiting worker of this page's own
 * build takes over at once: the page already runs that build. With the kill
 * switch (MHJDOJO_SW=off at build time) it unregisters any worker instead.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !isSecureContext) return;
  const sw = navigator.serviceWorker;
  const run = async () => {
    try {
      if (import.meta.env.VITE_MHJDOJO_SW_OFF) {
        for (const reg of await sw.getRegistrations()) await reg.unregister();
        return;
      }
      const reg = await sw.register(`sw.js?v=${__MHJDOJO_SITE_ID__}`, { scope: './' });
      const activate = () => {
        if (ownBuild(reg.waiting)) reg.waiting?.postMessage('SKIP_WAITING');
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
  if (document.readyState === 'complete') void run();
  else addEventListener('load', () => void run(), { once: true });
}

/**
 * Lets a newer build's waiting worker (installed by another tab of that
 * build) take over before the update banner reloads, so that the old one
 * doesn't serve the reload. Resolves once it has, or after 3 seconds.
 */
export async function activateWaiting(): Promise<void> {
  try {
    const waiting = (await navigator.serviceWorker?.getRegistration())?.waiting;
    if (!waiting || ownBuild(waiting)) return;
    await new Promise<void>((resolve) => {
      waiting.addEventListener('statechange', () => {
        if (waiting.state === 'activated' || waiting.state === 'redundant') resolve();
      });
      setTimeout(resolve, 3000);
      waiting.postMessage('SKIP_WAITING');
    });
  } catch {
    // No worker to wait for.
  }
}
