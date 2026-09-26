// Tile notation helpers. Notation mirrors docs/api.md: "1m".."9m", "1p".."9p",
// "1s".."9s", "0m"/"0p"/"0s" (red five), "1z".."7z" (東南西北白發中).

export type Suit = 'm' | 'p' | 's' | 'z';

export interface ParsedTile {
  suit: Suit;
  rank: number; // 1-9 for m/p/s, 1-7 for z
  red: boolean;
}

export function parseTile(tile: string): ParsedTile {
  const suit = tile[1] as Suit;
  const rawRank = Number(tile[0]);
  const red = rawRank === 0;
  return { suit, rank: red ? 5 : rawRank, red };
}

const SUIT_NAMES: Record<Exclude<Suit, 'z'>, string> = { m: '萬', p: '筒', s: '索' };
const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];

/** A tile's name as the UI shows it: "5p" → 5筒, "0m" → 赤5萬, "7z" → 中. The
 * codes stay internal (API, URLs, keys). */
export function tileName(tile: string): string {
  const { suit, rank, red } = parseTile(tile);
  if (suit === 'z') return HONOR_NAMES[rank - 1] ?? tile;
  return `${red ? '赤' : ''}${rank}${SUIT_NAMES[suit] ?? suit}`;
}
