import { useState } from 'preact/hooks';

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
// The advice panel starts minimized (docked) so the answer isn't shown
// before the player has thought about the hand.
const MINIMIZED_KEY = 'mhj-dojo.minimized.v2';

function parseKeys(raw: string | null): PanelKey[] | null {
  if (raw === null) return null;
  const v: unknown = JSON.parse(raw);
  return Array.isArray(v) ? PANELS.map((p) => p.key).filter((k) => v.includes(k)) : [];
}

function loadMinimized(): PanelKey[] {
  try {
    return parseKeys(localStorage.getItem(MINIMIZED_KEY)) ?? ['advice'];
  } catch {
    return ['advice'];
  }
}

function saveMinimized(keys: PanelKey[]) {
  try {
    localStorage.setItem(MINIMIZED_KEY, JSON.stringify(keys));
  } catch {
    // Storage unavailable: the layout just won't persist.
  }
}

/** Minimized panels, shared by practice and game mode and kept in localStorage. */
export function useMinimized() {
  const [minimized, setMinimized] = useState<PanelKey[]>(loadMinimized);
  const update = (next: PanelKey[]) => {
    setMinimized(next);
    saveMinimized(next);
  };
  return {
    minimized,
    isMin: (k: PanelKey) => minimized.includes(k),
    minimize: (k: PanelKey) => update([...minimized.filter((x) => x !== k), k]),
    restore: (k: PanelKey) => {
      update(minimized.filter((x) => x !== k));
      revealPanel(k);
    },
  };
}

/**
 * In the one-column layout (up to 1100px wide, e.g. a phone) a restored panel
 * lands somewhere down the page: scroll it into view once it has rendered.
 * The wider layouts show it in place, in a column of its own.
 */
function revealPanel(k: PanelKey) {
  if (typeof matchMedia !== 'function' || !matchMedia('(width <= 1100px)').matches) return;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`.area-${k}`);
    if (!el || el.hidden) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  });
}

/** Moves focus (and so the view) to the 用語表's search box once it has rendered, after restoring it. */
export function focusGlossary() {
  requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.glossary-search')?.focus());
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function optionalInt(s: string | null): number | undefined {
  if (s === null || !/^-?\d+$/.test(s)) return undefined;
  return Number(s);
}
