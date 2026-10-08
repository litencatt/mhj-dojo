// Tile themes and backs, and the dojo's other looks: the colours live in
// tokens.css under [data-tile-theme] and [data-table-cloth], the patterns and
// the win effects in styles/*.css under [data-tile-back], [data-riichi-stick] and
// [data-win-effect]. The dojo applies one for the duration of a dojo game only
// (dojo/useDojoGame.ts applies it and removes it on leaving); the hub only offers the
// purchase and the choice.

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

/** A look of the dojo's table: a shop item (null for the free default) and the label 設定 shows. */
export type Look = { id: string; label: string; item: string | null };

export const TABLE_CLOTHS: readonly Look[] = [
  { id: 'default', label: '標準', item: null },
  { id: 'midori', label: '緑', item: 'cloth:midori' },
  { id: 'kon', label: '紺', item: 'cloth:kon' },
  { id: 'enji', label: 'えんじ', item: 'cloth:enji' },
];

export const RIICHI_STICKS: readonly Look[] = [
  { id: 'default', label: '標準', item: null },
  { id: 'tenbou', label: '千点棒', item: 'stick:tenbou' },
  { id: 'take', label: '竹', item: 'stick:take' },
  { id: 'kogane', label: '金', item: 'stick:kogane' },
];

/** Played over a win of yours at 跳満 or above (ResultPanel), unless motion is reduced. */
export const WIN_EFFECTS: readonly Look[] = [
  { id: 'default', label: 'なし', item: null },
  { id: 'kamifubuki', label: '紙吹雪', item: 'effect:kamifubuki' },
  { id: 'sakura', label: '桜吹雪', item: 'effect:sakura' },
  { id: 'kinkou', label: '金の光', item: 'effect:kinkou' },
];

/** Sets on <html> the look an active item (a progress's activeCloth, ...) names, or clears it for the default. */
function applyLook(looks: readonly Look[], attr: 'tableCloth' | 'riichiStick' | 'winEffect', item: string): void {
  const root = document.documentElement;
  const look = looks.find((l) => l.item !== null && l.item === item);
  if (look) {
    root.dataset[attr] = look.id;
  } else {
    delete root.dataset[attr];
  }
}

export const applyTableCloth = (item: string) => applyLook(TABLE_CLOTHS, 'tableCloth', item);
export const applyRiichiStick = (item: string) => applyLook(RIICHI_STICKS, 'riichiStick', item);
export const applyWinEffect = (item: string) => applyLook(WIN_EFFECTS, 'winEffect', item);
