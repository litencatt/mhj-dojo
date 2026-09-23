// Tile notation helpers shared across components and the mock fixture.
// Notation mirrors docs/api.md: "1m".."9m", "1p".."9p", "1s".."9s", "0m"/"0p"/"0s"
// (red five), "1z".."7z" (東南西北白發中).

export type Suit = 'm' | 'p' | 's' | 'z';

export interface ParsedTile {
  suit: Suit;
  rank: number; // 1-9 for m/p/s, 1-7 for z
  red: boolean;
}

const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function parseTile(tile: string): ParsedTile {
  const rankChar = tile[0];
  const suit = tile[1] as Suit;
  const rawRank = Number(rankChar);
  const red = rawRank === 0;
  const rank = red ? 5 : rawRank;
  return { suit, rank, red };
}

/** 0-33 index: m1-9=0-8, p1-9=9-17, s1-9=18-26, z1-7=27-33. Red fives collapse to their suit's 5. */
export function tileIndex(tile: string): number {
  const { suit, rank } = parseTile(tile);
  if (suit === 'z') return 27 + (rank - 1);
  const base = suit === 'm' ? 0 : suit === 'p' ? 9 : 18;
  return base + (rank - 1);
}

export function indexToTile(index: number): string {
  if (index >= 27) return `${index - 27 + 1}z`;
  const suit: Suit = index < 9 ? 'm' : index < 18 ? 'p' : 's';
  const rank = (index % 9) + 1;
  return `${rank}${suit}`;
}

export const ALL_TILE_TYPES: string[] = Array.from({ length: 34 }, (_, i) => indexToTile(i));

export function isTerminalOrHonor(tile: string): boolean {
  const { suit, rank } = parseTile(tile);
  if (suit === 'z') return true;
  return rank === 1 || rank === 9;
}

export function isHonor(tile: string): boolean {
  return parseTile(tile).suit === 'z';
}

/** Display face for a tile: numeral/kanji + suit marker, used by <Tile>. */
export function tileFace(tile: string): { main: string; sub: string } {
  const { suit, rank } = parseTile(tile);
  if (suit === 'z') return { main: HONOR_NAMES[rank - 1] ?? '?', sub: '' };
  if (suit === 'm') return { main: NUMERALS[rank - 1] ?? '?', sub: '萬' };
  if (suit === 'p') return { main: String(rank), sub: '筒' };
  return { main: String(rank), sub: '索' };
}

export function sortTiles(tiles: string[]): string[] {
  return [...tiles].sort((a, b) => {
    const ia = tileIndex(a);
    const ib = tileIndex(b);
    if (ia !== ib) return ia - ib;
    // red five sorts alongside normal five, but keep stable-ish order (red first)
    const ra = parseTile(a).red ? 0 : 1;
    const rb = parseTile(b).red ? 0 : 1;
    return ra - rb;
  });
}

export function countsFromTiles(tiles: string[]): number[] {
  const counts = new Array(34).fill(0);
  for (const t of tiles) counts[tileIndex(t)]++;
  return counts;
}
