import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { GameEvent, GameState, SessionState, Seat, YakuRow } from './api';
import { errorMessage } from './panels';
import {
  buildPlayback,
  PLAYBACK_STEP_MS,
  playbackFrame,
  playbackHighlight,
  type PlaybackBuild,
  type PlaybackHighlight,
} from './playback';

/**
 * Runs one API request at a time. Every action acts on the server's current
 * state, so requests must never overlap: a second one could be redirected by
 * the first, and responses could land out of order. Overlapping calls are dropped.
 *
 * A 409 can mean the same session or game moved on elsewhere (another tab, or
 * a CPU turn that finished mid-request) - but the server also returns 409 for
 * plain "not allowed right now" errors (e.g. tsumo with an incomplete hand),
 * which have nothing to do with another tab. When `refetch` and `movedOn` are
 * both given, a 409 re-fetches the current state and, only if `movedOn` says
 * it actually differs from what's on screen, shows it with a notice instead
 * of the error; otherwise the server's own error message is shown as usual.
 */
export function useSerialRequest<T>(
  onSuccess: (next: T) => void,
  refetch?: () => Promise<T>,
  movedOn?: (prev: T, next: T) => boolean,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const last = useRef<T | null>(null);

  const inFlight = useRef(false);

  async function request(fn: () => Promise<T>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await fn();
      last.current = next;
      onSuccess(next);
    } catch (err) {
      if (refetch && movedOn && last.current !== null && err instanceof api.ApiError && err.status === 409) {
        try {
          const fresh = await refetch();
          if (movedOn(last.current, fresh)) {
            last.current = fresh;
            onSuccess(fresh);
            setNotice('別の画面で進んだため最新の状態に更新しました');
          } else {
            setError(errorMessage(err));
          }
        } catch (refetchErr) {
          setError(errorMessage(refetchErr));
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, error, notice, request };
}

/**
 * `useSerialRequest`'s `movedOn` for practice sessions: true only if the
 * re-fetched state is actually a different node than what was on screen, so
 * a plain "not allowed right now" 409 (e.g. tsumo with an incomplete hand)
 * still shows the server's own error instead of a spurious notice.
 */
export function sessionMovedOn(prev: SessionState, next: SessionState): boolean {
  return prev.node_id !== next.node_id || prev.turn !== next.turn || prev.status !== next.status;
}

/** `useSerialRequest`'s `movedOn` for games; see sessionMovedOn. */
export function gameMovedOn(prev: GameState, next: GameState): boolean {
  return (
    prev.phase !== next.phase ||
    prev.actor !== next.actor ||
    prev.events.length !== next.events.length ||
    prev.round_number !== next.round_number ||
    prev.honba !== next.honba ||
    prev.wall_remaining !== next.wall_remaining
  );
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
  highlight: PlaybackHighlight | null; // the tile or meld that last landed
  skip: () => void; // jump straight to the final state
}

// The step a fresh build starts at: the human's own move, if it produced
// the first event, was already seen happening, so it is revealed at once
// and only the CPU events that follow are paced out. Reduced motion (or a
// response with no events at all) reveals everything at once.
function leadStep(build: PlaybackBuild, state: GameState): number {
  const total = build.opsPerEvent.length;
  if (total === 0 || prefersReducedMotion()) return total;
  return state.events[0].seat === state.you ? 1 : 0;
}

/**
 * Replays a game response's events (docs/api.md "events") one at a time
 * instead of snapping straight to the final state (issue #29): each CPU
 * discard, riichi, call and kan lands in turn, then the round result (if
 * any) is left to the caller to reveal once `playing` goes false.
 */
export function usePlayback(state: GameState | null): Playback {
  const build = useMemo(() => (state ? buildPlayback(state.seats, state.events) : null), [state]);
  const [step, setStep] = useState(0);
  const timer = useRef<number | null>(null);
  // Which build `step` was set for. Effects run after paint, so on the
  // render right after `state` (and so `build`) changes, `step` is still
  // whatever the *previous* build left it at - reading it as-is would flash
  // the previous batch fully revealed for a frame, or fully un-revealed if
  // playback had reached the end. Compared against `build` below, this lets
  // that one render derive the correct starting step instead.
  const stepFor = useRef<PlaybackBuild | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    clear();
    if (!state || !build) {
      stepFor.current = build;
      setStep(0);
      return;
    }
    const total = build.opsPerEvent.length;
    let cur = leadStep(build, state);
    stepFor.current = build;
    setStep(cur);
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
    if (build) {
      stepFor.current = build;
      setStep(build.opsPerEvent.length);
    }
  }, [build]);

  // The render right after `build` changes but before the effect above has
  // run: derive this render's step instead of using the stale one.
  const step0 = stepFor.current === build ? step : build && state ? leadStep(build, state) : 0;

  const total = build ? build.opsPerEvent.length : 0;
  const playing = step0 < total;
  const seats = useMemo(() => {
    if (!build || !state) return state?.seats ?? [];
    return step0 >= total ? state.seats : playbackFrame(build, step0); // nothing hidden: the server's own array
  }, [build, step0]);
  const highlight = build ? playbackHighlight(build, seats, step0) : null;
  const events = state ? state.events.slice(0, step0) : [];

  return { seats, events, playing, highlight, skip };
}

/** An on/off setting kept in localStorage under key. Off by default and whenever storage fails. */
function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const update = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // Storage unavailable: the setting just won't persist.
    }
  };
  return [on, update];
}

/** The hand panel's 「面子表示」 toggle, shared by practice and game mode. */
export function useHandGroupsToggle(): [boolean, (on: boolean) => void] {
  return useStoredFlag('mhj2.handGroups');
}
