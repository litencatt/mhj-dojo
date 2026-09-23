import { useState } from 'preact/hooks';

// Panels that can be minimized into the right-edge dock.
export type PanelKey = 'chart' | 'tree' | 'yaku' | 'gloss';
export const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: 'chart', label: '時系列チャート' },
  { key: 'tree', label: '履歴ツリー' },
  { key: 'yaku', label: '役別向聴' },
  { key: 'gloss', label: '用語表' },
];
const MINIMIZED_KEY = 'mhj2.minimized';

function loadMinimized(): PanelKey[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(MINIMIZED_KEY) ?? '[]');
    return Array.isArray(v) ? PANELS.map((p) => p.key).filter((k) => v.includes(k)) : [];
  } catch {
    return [];
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
