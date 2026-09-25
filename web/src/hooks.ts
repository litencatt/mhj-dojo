import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { YakuRow } from './api';
import { errorMessage } from './panels';

/**
 * Runs one API request at a time. Every action acts on the server's current
 * state, so requests must never overlap: a second one could be redirected by
 * the first, and responses could land out of order. Overlapping calls are dropped.
 */
export function useSerialRequest<T>(onSuccess: (next: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function request(fn: () => Promise<T>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      onSuccess(await fn());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, error, request };
}

export interface UrlResumeOptions<T> {
  idKey: string; // the query key holding the server-side id
  request: (fn: () => Promise<T>) => Promise<void>;
  get: (id: string) => Promise<T>;
  create: (params: URLSearchParams) => Promise<T>; // a new one from the URL's other params
  sync: Record<string, string | null> | null; // params to write back; null deletes the key
}

/**
 * Keeps the id in the URL so a reload resumes the same session or game. They
 * live only in server memory, so after a server restart (404) the same wall is
 * dealt again from the params instead.
 */
export function useUrlResume<T>({ idKey, request, get, create, sync }: UrlResumeOptions<T>) {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get(idKey);
    if (!id) {
      void request(() => create(params));
      return;
    }
    void request(async () => {
      try {
        return await get(id);
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 404) return create(params);
        throw err;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncKey = sync && JSON.stringify(sync);
  useEffect(() => {
    if (!sync) return;
    const url = new URL(location.href);
    for (const [k, v] of Object.entries(sync)) {
      if (v !== null) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    history.replaceState(null, '', url);
  }, [syncKey]);
}

/** Yaku key → display name, for the chart legend. */
export function useRowNames(analysis: YakuRow[] | undefined) {
  return useMemo(() => {
    const map: Record<string, string> = {};
    if (analysis) for (const r of analysis) map[r.key] = r.name;
    return map;
  }, [analysis]);
}
