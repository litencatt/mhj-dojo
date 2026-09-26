// The version shown in the header, and (static site only) the check for a
// newer deploy.

import { useEffect, useState } from 'preact/hooks';
import * as api from './api';

// The static site's build: the commit it was built from and when
// (vite.config.ts, which also writes them to version.json). The default
// build is committed and has neither, so it shows the server's version.
export const SITE_BUILD =
  import.meta.env.VITE_MHJDOJO_VERSION && import.meta.env.VITE_MHJDOJO_BUILT
    ? { version: import.meta.env.VITE_MHJDOJO_VERSION as string, built: import.meta.env.VITE_MHJDOJO_BUILT as string }
    : null;

// The bundle's file name (its content hash), e.g. "index-DkR2xq3v": which
// build of the page is running, even where both builds report "dev".
export const BUNDLE = /\/assets\/([^/]+)\.js$/.exec(new URL(import.meta.url).pathname)?.[1] ?? null;

/** The server's (or the site's engine's) GET /api/version; null until it answers or if it fails. */
export function useVersion(): api.VersionInfo | null {
  const [v, setV] = useState<api.VersionInfo | null>(null);
  useEffect(() => {
    api.getVersion().then(setV, () => {
      // An older server without the endpoint: show nothing.
    });
  }, []);
  return v;
}

const CHECK_INTERVAL = 10 * 60 * 1000;

/**
 * Whether a newer static site has been deployed: version.json, fetched past
 * every cache at startup, every 10 minutes and whenever the tab becomes
 * visible again, names another build than the running one. Always false in
 * the default build; network errors are ignored.
 */
export function useNewVersion(): boolean {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (!SITE_BUILD || newer) return;
    let done = false;
    const check = async () => {
      try {
        const res = await fetch(new URL(`version.json?t=${Date.now()}`, document.baseURI), { cache: 'no-store' });
        if (!res.ok) return;
        const v = (await res.json()) as { version?: unknown; built?: unknown };
        if (typeof v.version !== 'string' || typeof v.built !== 'string') return;
        if (!done && (v.version !== SITE_BUILD.version || v.built !== SITE_BUILD.built)) setNewer(true);
      } catch {
        // offline or a bad response: try again at the next check
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [newer]);
  return newer;
}
