// The version shown in the header, and the check for a newer deploy.

import { useEffect, useState } from 'preact/hooks';

// The site's build (vite.config.ts, which also writes it to version.json):
// the commit, the release (if the Release site workflow built it), an id
// that changes with anything the build reads, and the build time.
export const SITE_BUILD = {
  version: __MHJDOJO_SITE_VERSION__,
  release: __MHJDOJO_SITE_RELEASE__,
  id: __MHJDOJO_SITE_ID__,
  built: __MHJDOJO_SITE_BUILT__,
};

// The bundle's file name (its content hash), e.g. "index-DkR2xq3v": which
// build of the page is running, even where two builds report "dev".
export const BUNDLE = /\/assets\/([^/]+)\.js$/.exec(new URL(import.meta.url).pathname)?.[1] ?? null;

const CHECK_INTERVAL = 10 * 60 * 1000;
const MIN_GAP = 60 * 1000; // at most one check a minute
// The URL parameter that makes a reload miss the CDN's cached index.html.
export const RELOAD_PARAM = '_v';
// The deployed id the last 再読み込み went for (sessionStorage, this tab only).
const TRIED_KEY = 'mhj-dojo.update-tried';

/**
 * - 'current': the running build is the deployed one (or unknown yet)
 * - 'newer': a newer build is deployed; reload() loads it
 * - 'pending': a reload for that build already came back with this one
 *   (the CDN still serves the old page), so no reload is offered again
 */
export type UpdateState = 'current' | 'newer' | 'pending';

function readTried(): string | null {
  try {
    return sessionStorage.getItem(TRIED_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether a newer build has been deployed: version.json, fetched past
 * every cache at startup, every 10 minutes and whenever the tab becomes
 * visible again (not while it is hidden, and at most once a minute), names
 * another commit or id than the running build. Checking stops once it does.
 * Network errors are ignored.
 */
export function useNewVersion(): { state: UpdateState; reload: () => void } {
  const [deployed, setDeployed] = useState<string | null>(null); // the newer build's id
  const state: UpdateState = deployed === null ? 'current' : readTried() === deployed ? 'pending' : 'newer';

  useEffect(() => {
    // Drop the reload's cache-busting parameter from the address bar.
    const url = new URL(location.href);
    if (url.searchParams.has(RELOAD_PARAM)) {
      url.searchParams.delete(RELOAD_PARAM);
      history.replaceState(history.state, '', url);
    }
  }, []);

  useEffect(() => {
    if (deployed !== null) return;
    const running = SITE_BUILD;
    let done = false;
    let last = -Infinity;
    const check = async () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < MIN_GAP) return;
      last = Date.now();
      try {
        const res = await fetch(new URL(`version.json?t=${Date.now()}`, document.baseURI), { cache: 'no-store' });
        if (!res.ok) return;
        const v = (await res.json()) as { version?: unknown; id?: unknown };
        if (typeof v.version !== 'string' || typeof v.id !== 'string') return;
        if (!done && (v.version !== running.version || v.id !== running.id)) setDeployed(v.id);
      } catch {
        // offline or a bad response: try again at the next check
      }
    };
    const onVisible = () => void check();
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [deployed]);

  const reload = () => {
    if (deployed === null) return;
    try {
      sessionStorage.setItem(TRIED_KEY, deployed);
    } catch {
      // Storage unavailable: a stale page would offer the reload again.
    }
    // Deploy Now's CDN caches index.html for a day: a URL it has not seen
    // (the same page, with the new id added) fetches the new one.
    const url = new URL(location.href);
    url.searchParams.set(RELOAD_PARAM, deployed);
    location.replace(url);
  };

  return { state, reload };
}
