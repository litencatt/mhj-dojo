import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { GameEvent, GameState, YakuRow } from './api';
import { errorMessage } from './panels';
import { claim, isStopped, onChange } from './singleTab';
import {
  buildPlayback,
  PLAYBACK_STEP_MS,
  playbackHighlight,
  playbackState,
  type PlaybackBuild,
  type PlaybackHighlight,
} from './playback';

/**
 * Runs one engine request at a time. Every action acts on the engine's
 * current state, so requests must never overlap: a second one could be
 * redirected by the first, and responses could land out of order.
 * Overlapping calls are dropped.
 */
export function useSerialRequest<T>(onSuccess: (next: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);

  // Resolves to whether fn's own state was shown (not dropped, and not failed).
  async function request(fn: () => Promise<T>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      onSuccess(await fn());
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { busy, error, request };
}

/**
 * Holds key (a singleTab key: api.sessionKey or api.gameKey) for this tab
 * while the page shows it (a new key lets go of the one before), and
 * returns whether another tab has taken over the one this tab holds: also
 * the one it was loading, before there is a state to show. Claiming it
 * again (as useUrlResume's resume does) ends that.
 */
export function useSingleTab(key: string | null): boolean {
  const [stopped, setStopped] = useState(isStopped);
  useEffect(() => {
    if (key) claim(key);
  }, [key]);
  useEffect(() => onChange(() => setStopped(isStopped())), []);
  return stopped;
}

export interface UrlResumeOptions<T> {
  idKey: string; // the query key holding the session's or game's id
  request: (fn: () => Promise<T>) => Promise<unknown>;
  get: (id: string) => Promise<T>;
  create: (params: URLSearchParams) => Promise<T>; // a new one from the URL's other params
  sync: Record<string, string | null> | null; // params to write back; null deletes the key
}

/**
 * Keeps the id in the URL so a reload resumes the same session or game. When
 * the engine has no save for it (404), the same wall is dealt again from the
 * params instead. Returns resume, which does it again (for a tab taking the
 * session or game back from another tab).
 */
export function useUrlResume<T>({ idKey, request, get, create, sync }: UrlResumeOptions<T>) {
  function resume() {
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
  }

  useEffect(() => {
    resume();
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

  return resume;
}

/**
 * fn behind a function that keeps its identity across renders, for a
 * memoized child's props: a call always runs the latest render's fn.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}

/** Yaku key → display name, for the chart legend. */
/**
 * The last non-empty analysis: after a call the engine stops sending one,
 * but the chart still draws the history from before the call.
 */
export function useLastAnalysis(analysis: YakuRow[] | undefined): YakuRow[] {
  const last = useRef<YakuRow[]>([]);
  if (analysis && analysis.length > 0) last.current = analysis;
  return analysis && analysis.length > 0 ? analysis : last.current;
}

// The yaku panel's least height on a phone (style.css).
const YAKU_MIN_HEIGHT = 200;

/**
 * On a phone the yaku panel fills the height left under the header and the
 * hand (style.css): this keeps --yaku-top, where the panel starts on the
 * page, on the returned app element, and data-hand-fits: whether the hand
 * (in a CPU game, with the table) and the shortest panel fit the screen
 * together, so the hand can stick to the top without covering the panel.
 */
export function useYakuTop(hasState: boolean) {
  const appRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const update = () => {
      const yaku = app.querySelector('.area-yaku');
      if (!yaku) return;
      const top = `${yaku.getBoundingClientRect().top + window.scrollY}px`;
      // A write, even of the same value, may restyle the whole app.
      if (app.style.getPropertyValue('--yaku-top') !== top) app.style.setProperty('--yaku-top', top);
      const hand = app.querySelector<HTMLElement>('.area-hand');
      if (!hand) return;
      // The pinned hand starts under the top inset, and the panel ends
      // above the bottom padding (or dock bar) and the bottom inset.
      const style = getComputedStyle(app);
      const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
      const room = window.innerHeight - px('--safe-top') - px('--safe-bottom') - px('--yaku-bottom');
      const fits = String(hand.offsetHeight + YAKU_MIN_HEIGHT <= room);
      if (app.dataset.handFits !== fits) app.dataset.handFits = fits;
    };
    // The panels above the yaku table change the app's height when they
    // change, and so does a new window width. The hand's own height (a CPU
    // game's table grows as the rivers fill) may not change the app's, nor
    // does a new window height (a phone's URL bar coming and going). Any of
    // them updates once, on the next frame: writing from a ResizeObserver
    // callback would resize what it observes within the same frame.
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
      }
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(app);
    const hand = app.querySelector('.area-hand');
    if (hand) ro.observe(hand);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [hasState]);
  return appRef;
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
  // The state to show: state as the table stood at the current step (its
  // seats, events revealed so far, points, wall, dora ...; see
  // playbackState), state itself once the playback ends.
  view: GameState | null;
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
 * any) is left to the caller to reveal once `playing` goes false. A `seen`
 * state (one reopened from a save or a reload) is shown as it stands: the
 * player already watched those moves.
 */
export function usePlayback(state: GameState | null, seen: GameState | null = null): Playback {
  const build = useMemo(() => (state ? buildPlayback(state.seats, state.events) : null), [state]);
  // build is memoized on state, so [build] also covers the state read here.
  // seen is set before its state arrives, so [build] covers it too.
  const lead = useMemo(
    () => (build && state ? (state === seen ? build.opsPerEvent.length : leadStep(build, state)) : 0),
    [build],
  );
  // The step, with the build it was set for. Until the first tick (or skip)
  // sets it for a new build, the step is that build's lead step: derived
  // here, so a new build needs no extra render to start (and never shows the
  // previous build's step for a frame).
  const [at, setAt] = useState<{ build: PlaybackBuild | null; step: number }>({ build: null, step: 0 });
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    clear();
    if (!build) return;
    const total = build.opsPerEvent.length;
    let cur = lead;
    const tick = () => {
      cur += 1;
      setAt({ build, step: cur });
      if (cur < total) timer.current = window.setTimeout(tick, PLAYBACK_STEP_MS);
    };
    if (cur < total) timer.current = window.setTimeout(tick, PLAYBACK_STEP_MS);
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build]);

  const skip = useCallback(() => {
    clear();
    if (build) setAt({ build, step: build.opsPerEvent.length });
  }, [build]);

  const step = at.build === build ? at.step : lead;
  const total = build ? build.opsPerEvent.length : 0;
  const playing = step < total;
  const view = useMemo(() => (build && state ? playbackState(state, build, step) : state), [build, step]);
  const highlight = build && view ? playbackHighlight(build, view.seats, step) : null;

  // A hidden tab would only queue up the steps' renders for nobody: jump to
  // the end instead, at once if it is hidden already.
  useEffect(() => {
    if (!playing) return;
    if (document.visibilityState === 'hidden') {
      skip();
      return;
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') skip();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [playing, skip]);

  return { view, playing, highlight, skip };
}

/**
 * The round's events before state's own (docs/api.md "events_from"): each
 * response carries only the moves since your previous one, so the earlier
 * ones are kept here as they arrive, for the table's log of the round. A
 * reload, or a new round, starts again from the state's own events.
 */
export function useRoundLog(state: GameState | null): GameEvent[] {
  // Worked out once per state, during the render that first sees it: the
  // ref is only written when `state` changes, so re-renders read it back.
  const log = useRef<{ state: GameState | null; round: string; events: GameEvent[]; before: GameEvent[] }>({
    state: null,
    round: '',
    events: [],
    before: [],
  });
  if (log.current.state !== state) {
    const prev = log.current;
    if (!state) {
      log.current = { state, round: '', events: [], before: [] };
    } else {
      const round = `${state.game_id} ${state.round_wind}${state.round_number}-${state.honba}`;
      const before =
        prev.round === round && prev.events.length >= state.events_from ? prev.events.slice(0, state.events_from) : [];
      log.current = { state, round, events: [...before, ...state.events], before };
    }
  }
  return log.current.before;
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
  return useStoredFlag('mhj-dojo.handGroups');
}

/** Whether a CSS media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mql = matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}
