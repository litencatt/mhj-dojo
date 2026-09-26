import { useState } from 'preact/hooks';

// Panels that can be minimized into the right-edge dock.
export type PanelKey = 'chart' | 'tree' | 'yaku' | 'advice' | 'gloss';
export const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: 'chart', label: '時系列チャート' },
  { key: 'tree', label: '履歴ツリー' },
  { key: 'yaku', label: '役別向聴' },
  { key: 'advice', label: 'アドバイス' },
  { key: 'gloss', label: '用語表' },
];
// v2 adds the advice panel, which starts minimized (docked) so the answer
// isn't shown before the player has thought about the hand.
const MINIMIZED_KEY = 'mhj2.minimized.v2';
const OLD_MINIMIZED_KEY = 'mhj2.minimized';
const OLD_ADVICE_OPEN_KEY = 'mhj2.adviceOpen';

function parseKeys(raw: string | null): PanelKey[] | null {
  if (raw === null) return null;
  const v: unknown = JSON.parse(raw);
  return Array.isArray(v) ? PANELS.map((p) => p.key).filter((k) => v.includes(k)) : [];
}

function loadMinimized(): PanelKey[] {
  try {
    const keys = parseKeys(localStorage.getItem(MINIMIZED_KEY));
    if (keys) return keys;
    // First load after v2: keep the old layout, and the advice docked unless
    // it had been opened with the old 開く/閉じる toggle.
    const old = parseKeys(localStorage.getItem(OLD_MINIMIZED_KEY)) ?? [];
    return localStorage.getItem(OLD_ADVICE_OPEN_KEY) === '1' ? old : [...old, 'advice'];
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
    restore: (k: PanelKey) => update(minimized.filter((x) => x !== k)),
  };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function optionalInt(s: string | null): number | undefined {
  if (s === null || !/^-?\d+$/.test(s)) return undefined;
  return Number(s);
}
