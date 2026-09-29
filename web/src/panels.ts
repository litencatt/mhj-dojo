import { useCallback, useEffect, useState } from 'preact/hooks';
import { tileName } from './tiles';

// Panels that can be minimized into the dock (the right edge; a bottom bar on a phone).
export type PanelKey = 'chart' | 'tree' | 'yaku' | 'advice' | 'gloss';
// `short` names the tab in the phone's bottom bar, where five share one row.
export const PANELS: Array<{ key: PanelKey; label: string; short: string }> = [
  { key: 'chart', label: '時系列チャート', short: 'チャート' },
  { key: 'tree', label: '履歴ツリー', short: '履歴' },
  { key: 'yaku', label: '役別向聴', short: '役別向聴' },
  { key: 'advice', label: 'アドバイス', short: 'アドバイス' },
  { key: 'gloss', label: '用語表', short: '用語表' },
];
// Without a saved layout only the 役別向聴 table is open next to the header
// and the hand: every other panel, and any added later, starts in the dock
// (the advice among them, so the answer isn't shown before the player has
// thought about the hand).
const OPEN_BY_DEFAULT: PanelKey[] = ['yaku'];
const DEFAULT_MINIMIZED: PanelKey[] = PANELS.map((p) => p.key).filter((k) => !OPEN_BY_DEFAULT.includes(k));
const MINIMIZED_KEY = 'mhj-dojo.minimized.v2';

function parseKeys(raw: string | null): PanelKey[] | null {
  if (raw === null) return null;
  const v: unknown = JSON.parse(raw);
  return Array.isArray(v) ? PANELS.map((p) => p.key).filter((k) => v.includes(k)) : [];
}

function loadMinimized(): PanelKey[] {
  try {
    return parseKeys(localStorage.getItem(MINIMIZED_KEY)) ?? DEFAULT_MINIMIZED;
  } catch {
    return DEFAULT_MINIMIZED;
  }
}

function saveMinimized(keys: PanelKey[]) {
  try {
    localStorage.setItem(MINIMIZED_KEY, JSON.stringify(keys));
  } catch {
    // Storage unavailable: the layout just won't persist.
  }
}

/**
 * Minimized panels, shared by practice and game mode and kept in localStorage.
 * minimize and restore keep their identity across renders (the memoized
 * panels take them as props) and work from the latest list, never the one
 * of the render that made them.
 */
export function useMinimized() {
  const [minimized, setMinimized] = useState<PanelKey[]>(loadMinimized);
  const update = useCallback((next: (prev: PanelKey[]) => PanelKey[]) => {
    setMinimized((prev) => {
      const keys = next(prev);
      saveMinimized(keys);
      return keys;
    });
  }, []);
  const minimize = useCallback((k: PanelKey) => update((prev) => [...prev.filter((x) => x !== k), k]), [update]);
  const restore = useCallback(
    (k: PanelKey) => {
      update((prev) => prev.filter((x) => x !== k));
      revealPanel(k);
    },
    [update],
  );
  const isMin = useCallback((k: PanelKey) => minimized.includes(k), [minimized]);
  return { minimized, isMin, minimize, restore };
}

const RIVERS_KEY = 'mhj-dojo.rivers.v1';

function loadRiversShown(): boolean {
  try {
    return localStorage.getItem(RIVERS_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

/**
 * Whether the CPU game shows the other seats' rivers (a phone can fold them
 * away, GameTable), kept in localStorage; shown by default.
 */
export function useRiversShown() {
  const [shown, setShown] = useState(loadRiversShown);
  useEffect(() => {
    try {
      localStorage.setItem(RIVERS_KEY, shown ? 'shown' : 'hidden');
    } catch {
      // Storage unavailable: the choice just won't persist.
    }
  }, [shown]);
  const toggle = useCallback(() => setShown((prev) => !prev), []);
  return { shown, toggle };
}

/**
 * In the one-column layout (up to 1100px wide, e.g. a phone) a restored panel
 * lands somewhere down the page: scroll it into view once it has rendered.
 * The wider layouts show it in place, in a column of its own.
 */
const ONE_COLUMN = '(width <= 1100px)'; // style.css's one-column layout

function revealPanel(k: PanelKey) {
  if (typeof matchMedia !== 'function' || !matchMedia(ONE_COLUMN).matches) return;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`.area-${k}`);
    if (!el || el.hidden) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  });
}

/** Moves focus (and so the view) to the 用語表's search box once it has rendered, after restoring it. */
export function focusGlossary() {
  // In the one-column layout revealPanel (restore) scrolls the panel into
  // view: focusing must not scroll again on top of that.
  const preventScroll = typeof matchMedia === 'function' && matchMedia(ONE_COLUMN).matches;
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.glossary-search')?.focus({ preventScroll }));
}

// Server error messages (English, meant for API clients) sometimes embed a raw
// tile code, e.g. `tile "5p" is not in hand or drawn`. Replace each whole code
// token with its name for display, quotes and all if quoted ("5p" -> 5筒, bare
// 5p -> 5筒). \b keeps it from matching inside a longer token (18p, abc5pdef).
const TILE_CODE = /"?\b([0-9][mps]|[1-7]z)\b"?/g;

export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(TILE_CODE, (_match, code: string) => tileName(code));
}

export function optionalInt(s: string | null): number | undefined {
  if (s === null || !/^-?\d+$/.test(s)) return undefined;
  return Number(s);
}
