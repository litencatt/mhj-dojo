import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { GameEvent, GameState, Seat, YakuRow } from './api';
import { errorMessage } from './panels';
import { buildPlayback, PLAYBACK_STEP_MS, playbackFrame, playbackHighlight, type PlaybackHighlight } from './playback';

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
/**
 * The last non-empty analysis: after a call the server stops sending one,
 * but the chart still draws the history from before the call.
 */
export function useLastAnalysis(analysis: YakuRow[] | undefined): YakuRow[] {
  const last = useRef<YakuRow[]>([]);
  if (analysis && analysis.length > 0) last.current = analysis;
  return analysis && analysis.length > 0 ? analysis : last.current;
}

export function useRowNames(analysis: YakuRow[] | undefined) {
  return useMemo(() => {
    const map: Record<string, string> = {};
    if (analysis) for (const r of analysis) map[r.key] = r.name;
    return map;
  }, [analysis]);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface Playback {
  seats: Seat[]; // the seats to render: state.seats with events not yet played hidden
  events: GameEvent[]; // state.events, revealed up to the current step
  playing: boolean;
  highlight: PlaybackHighlight | null; // the tile or meld that just landed
  skip: () => void; // jump straight to the final state
}

/**
 * Replays a game response's events (docs/api.md "events") one at a time
 * instead of snapping straight to the final state (issue #29): each CPU
 * discard, riichi, call and kan lands in turn, then the round result (if
 * any) is left to the caller to reveal once `playing` goes false.
 *
 * The event that produced the response (state.events[0]) is the human's own
 * move when it generates one (a discard, a call, a self kan, tsumo...): it
 * is revealed immediately, since the player already saw it happen. Only the
 * CPU events that follow are paced out.
 */
export function usePlayback(state: GameState | null): Playback {
  const build = useMemo(() => (state ? buildPlayback(state.seats, state.events) : null), [state]);
  const [step, setStep] = useState(0);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    clear();
    if (!state || !build) {
      setStep(0);
      return;
    }
    const total = build.opsPerEvent.length;
    if (total === 0 || prefersReducedMotion()) {
      setStep(total);
      return;
    }
    // The human's own move, if it produced the first event, was already
    // seen happening: reveal it at once and only pace out the rest.
    const lead = state.events[0].seat === state.you ? 1 : 0;
    setStep(lead);
    let cur = lead;
    const tick = () => {
      cur += 1;
      setStep(cur);
      if (cur < total) timer.current = window.setTimeout(tick, PLAYBACK_STEP_MS);
    };
    if (cur < total) timer.current = window.setTimeout(tick, PLAYBACK_STEP_MS);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build]);

  const skip = useCallback(() => {
    clear();
    if (build) setStep(build.opsPerEvent.length);
  }, [build]);

  const seats = build ? playbackFrame(build, step) : (state?.seats ?? []);
  const total = build ? build.opsPerEvent.length : 0;
  const playing = step < total;
  const highlight = build && playing ? playbackHighlight(build, seats, step) : null;
  const events = state ? state.events.slice(0, step) : [];

  return { seats, events, playing, highlight, skip };
}
