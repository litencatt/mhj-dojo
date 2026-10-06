// Tile themes and backs: the colours live in tokens.css under [data-tile-theme],
// the backs' patterns in style.css under [data-tile-back]. The
// dojo applies one for the duration of a dojo game only (GameApp applies it and
// removes it on leaving); the hub only offers the purchase and the choice.

export type TileThemeId = 'default' | 'wafuu' | 'mono' | 'yonshoku' | 'sakura' | 'hisui' | 'kogane';

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
  { id: 'sakura', label: '桜', item: 'theme:sakura' },
  { id: 'hisui', label: '翡翠', item: 'theme:hisui' },
  { id: 'kogane', label: '黄金', item: 'theme:kogane' },
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

export type TileBackId = 'default' | 'shima' | 'ichimatsu' | 'asanoha';

export type TileBack = {
  id: TileBackId;
  label: string;
  /** Shop key in the dojo's ownedItems; null for the free default. */
  item: string | null;
};

export const TILE_BACKS: readonly TileBack[] = [
  { id: 'default', label: '無地', item: null },
  { id: 'shima', label: '縞', item: 'back:shima' },
  { id: 'ichimatsu', label: '市松', item: 'back:ichimatsu' },
  { id: 'asanoha', label: '麻の葉', item: 'back:asanoha' },
];

/** Sets (or, for 'default' and unknown ids, clears) the tile back's pattern on <html>. */
export function applyTileBack(id: string): void {
  const root = document.documentElement;
  if (TILE_BACKS.some((t) => t.id === id && t.id !== 'default')) {
    root.dataset.tileBack = id;
  } else {
    delete root.dataset.tileBack;
  }
}
