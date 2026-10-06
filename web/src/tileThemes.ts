// Tile themes: the colours live in tokens.css under [data-tile-theme]. The
// dojo applies one for the duration of a dojo game only (GameApp applies it and
// removes it on leaving); the hub only offers the purchase and the choice.

export type TileThemeId = 'default' | 'wafuu' | 'mono' | 'yonshoku';

export type TileTheme = {
  id: TileThemeId;
  label: string;
  /** Shop key in the dojo's ownedItems; null for the free default. */
  item: string | null;
};

export const TILE_THEMES: readonly TileTheme[] = [
  { id: 'default', label: '標準', item: null },
  { id: 'wafuu', label: '和風', item: 'theme:wafuu' },
  { id: 'mono', label: 'モノクロ', item: 'theme:mono' },
  { id: 'yonshoku', label: '四色牌', item: 'theme:yonshoku' },
];

/** Sets (or, for 'default' and unknown ids, clears) the tile theme on <html>. */
export function applyTileTheme(id: string): void {
  const root = document.documentElement;
  if (TILE_THEMES.some((t) => t.id === id && t.id !== 'default')) {
    root.dataset.tileTheme = id;
  } else {
    delete root.dataset.tileTheme;
  }
}
