// Heuristic shanten engine used ONLY by the mock fixture (src/mock.ts) so the
// dev UI has plausible, reactive numbers to render. This is NOT the real
// yaku-shanten algorithm — the Go backend computes the certified values
// (color-DP + oracle-tested, see docs/api.md and .omc/plans/mhj2-plan.md).
// `normal`, `chiitoitsu`, `kokushi` and `toitoi` below are reasonably
// accurate; the rest are cheap deterministic approximations.

import { ALL_TILE_TYPES, countsFromTiles, indexToTile, isHonor, isTerminalOrHonor, parseTile } from './tiles';

export interface BlockOptions {
  /** Disallow sequences (used for toitoi). */
  noSequences?: boolean;
  /** Zero out any tile index outside this allow-list before searching. */
  restrictTo?: (index: number) => boolean;
}

/**
 * Approximate standard-form shanten (4 melds + 1 pair) via backtracking block
 * decomposition. Not exhaustively verified against edge cases; adequate for
 * mock/dev fixture purposes only.
 */
export function blockShanten(counts34: number[], opts: BlockOptions = {}): number {
  const counts = counts34.slice();
  if (opts.restrictTo) {
    for (let i = 0; i < 34; i++) {
      if (!opts.restrictTo(i)) counts[i] = 0;
    }
  }
  let best = 8;

  function finish(melds: number, partials: number, pairUsed: boolean): void {
    let m = melds;
    let p = partials;
    if (m + p > 4) p = Math.max(0, 4 - m);
    let shanten = 8 - 2 * m - p - (pairUsed ? 1 : 0);
    if (!pairUsed && m + p >= 5) shanten += 1;
    if (shanten < best) best = shanten;
  }

  function rec(idx: number, melds: number, partials: number, pairUsed: boolean): void {
    if (melds >= 4 && pairUsed) {
      finish(melds, partials, pairUsed);
      return;
    }
    if (idx === 34) {
      finish(melds, partials, pairUsed);
      return;
    }
    if (counts[idx] === 0) {
      rec(idx + 1, melds, partials, pairUsed);
      return;
    }
    // Option: leave this tile type alone (floating / not used).
    rec(idx + 1, melds, partials, pairUsed);

    // Option: triplet.
    if (counts[idx] >= 3) {
      counts[idx] -= 3;
      rec(idx, melds + 1, partials, pairUsed);
      counts[idx] += 3;
    }

    // Option: pair (either the head, or a partial toward a triplet).
    if (counts[idx] >= 2) {
      counts[idx] -= 2;
      if (!pairUsed) rec(idx + 1, melds, partials, true);
      rec(idx + 1, melds, partials + 1, pairUsed);
      counts[idx] += 2;
    }

    if (!opts.noSequences && idx < 27) {
      const rank = idx % 9; // 0-indexed
      if (rank <= 6 && counts[idx] >= 1 && counts[idx + 1] >= 1 && counts[idx + 2] >= 1) {
        counts[idx]--;
        counts[idx + 1]--;
        counts[idx + 2]--;
        rec(idx, melds + 1, partials, pairUsed);
        counts[idx]++;
        counts[idx + 1]++;
        counts[idx + 2]++;
      }
      if (rank <= 7 && counts[idx] >= 1 && counts[idx + 1] >= 1) {
        counts[idx]--;
        counts[idx + 1]--;
        rec(idx + 1, melds, partials + 1, pairUsed);
        counts[idx]++;
        counts[idx + 1]++;
      }
      if (rank <= 6 && counts[idx] >= 1 && counts[idx + 2] >= 1) {
        counts[idx]--;
        counts[idx + 2]--;
        rec(idx + 1, melds, partials + 1, pairUsed);
        counts[idx]++;
        counts[idx + 2]++;
      }
    }
  }

  rec(0, 0, 0, false);
  return Math.max(-1, best);
}

export function chiitoitsuShanten(counts34: number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (const c of counts34) {
    if (c > 0) kinds++;
    if (c >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function kokushiShanten(counts34: number[]): number {
  const yaochuuIdx = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  let kinds = 0;
  let hasPair = false;
  for (const i of yaochuuIdx) {
    if (counts34[i] > 0) kinds++;
    if (counts34[i] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

function dominantSuit(counts34: number[]): 'm' | 'p' | 's' {
  const totals: Record<'m' | 'p' | 's', number> = { m: 0, p: 0, s: 0 };
  for (let i = 0; i < 27; i++) {
    const suit = i < 9 ? 'm' : i < 18 ? 'p' : 's';
    totals[suit] += counts34[i];
  }
  return (Object.keys(totals) as Array<'m' | 'p' | 's'>).reduce((a, b) => (totals[a] >= totals[b] ? a : b));
}

/** key -> shanten for a 13-tile hand, using dedicated logic where available. */
export function shantenForKey(key: string, hand: string[]): number | null {
  const counts = countsFromTiles(hand);
  switch (key) {
    case 'chiitoitsu':
      return chiitoitsuShanten(counts);
    case 'kokushi':
      return kokushiShanten(counts);
    case 'toitoi':
      return blockShanten(counts, { noSequences: true });
    case 'tanyao':
      return blockShanten(counts, { restrictTo: (i) => !isTerminalOrHonorIdx(i) });
    case 'honitsu': {
      const dom = dominantSuit(counts);
      return blockShanten(counts, { restrictTo: (i) => isHonorIdx(i) || suitOfIdx(i) === dom });
    }
    case 'chinitsu': {
      const dom = dominantSuit(counts);
      return blockShanten(counts, { restrictTo: (i) => suitOfIdx(i) === dom });
    }
    case 'normal':
      return blockShanten(counts);
    default:
      return heuristicShanten(key, hand, counts);
  }
}

function isTerminalOrHonorIdx(i: number): boolean {
  return isTerminalOrHonor(ALL_TILE_TYPES[i] as string);
}
function isHonorIdx(i: number): boolean {
  return isHonor(ALL_TILE_TYPES[i] as string);
}
function suitOfIdx(i: number): 'm' | 'p' | 's' | 'z' {
  return parseTile(ALL_TILE_TYPES[i] as string).suit;
}

const YAKUHAI_TILE: Record<string, string> = { haku: '5z', hatsu: '6z', chun: '7z', ton: '1z' };

/**
 * Cheap deterministic stand-in for yaku that would otherwise need proper
 * constraint modeling (pinfu wait shape, sanshoku/ittsu specific runs,
 * chanta/junchan terminal-touching blocks, sanankou concealed triplets,
 * yakuhai pair-into-triplet progress, iipeikou duplicate run). Derives a
 * small penalty from simple hand features so the mock UI still shows
 * varied, reactive numbers.
 */
function heuristicShanten(key: string, hand: string[], counts: number[]): number | null {
  const normal = blockShanten(counts);
  if (key === 'pinfu') {
    // Pinfu forbids yakuhai pair/triplet dominance; nudge up when honors heavy.
    const honorCount = hand.filter((t) => isHonor(t)).length;
    return normal + (honorCount > 2 ? 2 : honorCount > 0 ? 1 : 0);
  }
  if (key === 'iipeikou' || key === 'sanshoku' || key === 'ittsu') {
    const suitSpread = new Set(hand.filter((t) => !isHonor(t)).map((t) => parseTile(t).suit)).size;
    const penalty = key === 'iipeikou' ? 1 : suitSpread >= 2 ? 1 : 2;
    return normal + penalty;
  }
  if (key === 'chanta' || key === 'junchan') {
    const simpleCount = hand.filter((t) => !isTerminalOrHonor(t)).length;
    const penalty = Math.min(4, Math.ceil(simpleCount / 3));
    return normal + penalty;
  }
  if (key === 'sanankou') {
    const toitoiS = blockShanten(counts, { noSequences: true });
    return Math.max(normal, toitoiS - 1);
  }
  if (key in YAKUHAI_TILE) {
    const tile = YAKUHAI_TILE[key] as string;
    const have = hand.filter((t) => t === tile || (parseTile(t).suit === 'z' && tile === '1z' && parseTile(t).rank === 1)).length;
    if (have >= 2) return 0;
    if (have === 1) return Math.max(normal, 1);
    return Math.max(normal + 1, 2);
  }
  return normal;
}

// --- Completion / win-yaku detection (mock heuristic, single decomposition) ---

export type Meld = { kind: 'triplet'; index: number } | { kind: 'sequence'; index: number };

interface Decomposition {
  melds: Meld[];
  pairIndex: number;
}

/** Finds one valid 4-melds+1-pair decomposition, or null if the 14 tiles don't form one. */
export function decomposeStandard(counts34: number[]): Decomposition | null {
  const counts = counts34.slice();
  const melds: Meld[] = [];
  let pairIndex = -1;

  function rec(idx: number): boolean {
    while (idx < 34 && counts[idx] === 0) idx++;
    if (idx === 34) return melds.length === 4 && pairIndex >= 0;
    if (counts[idx] >= 3) {
      counts[idx] -= 3;
      melds.push({ kind: 'triplet', index: idx });
      if (rec(idx)) return true;
      melds.pop();
      counts[idx] += 3;
    }
    if (pairIndex < 0 && counts[idx] >= 2) {
      counts[idx] -= 2;
      pairIndex = idx;
      if (rec(idx)) return true;
      pairIndex = -1;
      counts[idx] += 2;
    }
    if (idx < 27) {
      const rank = idx % 9;
      if (rank <= 6 && counts[idx] >= 1 && counts[idx + 1] >= 1 && counts[idx + 2] >= 1) {
        counts[idx]--;
        counts[idx + 1]--;
        counts[idx + 2]--;
        melds.push({ kind: 'sequence', index: idx });
        if (rec(idx)) return true;
        melds.pop();
        counts[idx]++;
        counts[idx + 1]++;
        counts[idx + 2]++;
      }
    }
    return false;
  }

  return rec(0) ? { melds: [...melds], pairIndex } : null;
}

export function isChiitoitsuComplete(counts34: number[]): boolean {
  let pairs = 0;
  for (const c of counts34) {
    if (c === 2) pairs++;
    else if (c !== 0) return false;
  }
  return pairs === 7;
}

export function isKokushiComplete(counts34: number[]): boolean {
  const yaochuuIdx = new Set([0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]);
  let kinds = 0;
  let hasPair = false;
  let total = 0;
  for (let i = 0; i < 34; i++) {
    if (counts34[i] === 0) continue;
    if (!yaochuuIdx.has(i)) return false;
    kinds++;
    total += counts34[i];
    if (counts34[i] >= 2) hasPair = true;
  }
  return kinds === 13 && hasPair && total === 14;
}

export function isCompleteHand(tiles14: string[]): boolean {
  const counts = countsFromTiles(tiles14);
  return decomposeStandard(counts) !== null || isChiitoitsuComplete(counts) || isKokushiComplete(counts);
}

const YAKUHAI_IDX: Record<string, number> = { haku: 31, hatsu: 32, chun: 33, ton: 27 };

export interface DetectedYaku {
  key: string;
  name: string;
  han: number;
}

/**
 * Best-effort named-yaku detection from one arbitrary decomposition. May
 * under-report yaku that require checking alternate decompositions — fine
 * for a mock win panel, not a scoring engine.
 */
export function detectWinYaku(tiles14: string[]): DetectedYaku[] {
  const counts = countsFromTiles(tiles14);
  const out: DetectedYaku[] = [];

  if (isChiitoitsuComplete(counts)) {
    out.push({ key: 'chiitoitsu', name: '七対子', han: 2 });
  }
  if (isKokushiComplete(counts)) {
    out.push({ key: 'kokushi', name: '国士無双', han: 13 });
    return out; // kokushi excludes everything else
  }

  const decomp = decomposeStandard(counts);
  if (!decomp) return out;
  const { melds, pairIndex } = decomp;
  const suitOf = (i: number): 'm' | 'p' | 's' | 'z' => parseTile(indexToTile(i)).suit;
  const rankOf = (i: number): number => parseTile(indexToTile(i)).rank;

  const noHonorTile = tiles14.every((t) => !isHonor(t));
  if (noHonorTile && tiles14.every((t) => !isTerminalOrHonor(t))) {
    out.push({ key: 'tanyao', name: '断么九', han: 1 });
  }

  const suits = new Set(tiles14.filter((t) => !isHonor(t)).map((t) => parseTile(t).suit));
  const hasHonor = tiles14.some((t) => isHonor(t));
  if (suits.size === 1 && hasHonor) out.push({ key: 'honitsu', name: '混一色', han: 2 });
  if (suits.size === 1 && !hasHonor) out.push({ key: 'chinitsu', name: '清一色', han: 5 });

  if (melds.every((m) => m.kind === 'triplet')) {
    out.push({ key: 'toitoi', name: '対々和', han: 2 });
  }
  const tripletCount = melds.filter((m) => m.kind === 'triplet').length;
  if (tripletCount >= 3) out.push({ key: 'sanankou', name: '三暗刻', han: 2 });

  for (const [key, idx] of Object.entries(YAKUHAI_IDX)) {
    if (melds.some((m) => m.kind === 'triplet' && m.index === idx)) {
      const names: Record<string, string> = { haku: '役牌 白', hatsu: '役牌 發', chun: '役牌 中', ton: '役牌 東' };
      // 東 is both round and seat wind in Phase 1, so it counts as a single
      // double-value entry rather than two separate yakuhai.
      out.push({ key, name: names[key] as string, han: key === 'ton' ? 2 : 1 });
    }
  }

  const sequences = melds.filter((m): m is { kind: 'sequence'; index: number } => m.kind === 'sequence');
  // Pinfu: all-sequence hand whose pair is not a yakuhai tile (dragons, or round/seat
  // wind — fixed to East for both in Phase 1).
  const disallowedPinfuPair = new Set(['5z', '6z', '7z', '1z']);
  if (sequences.length >= 4 && !disallowedPinfuPair.has(indexToTile(pairIndex))) {
    out.push({ key: 'pinfu', name: '平和', han: 1 });
  }
  const seqKeys = sequences.map((s) => `${suitOf(s.index)}${rankOf(s.index)}`);
  if (new Set(seqKeys).size < seqKeys.length) {
    out.push({ key: 'iipeikou', name: '一盃口', han: 1 });
  }
  for (const startRank of [1, 2, 3, 4, 5, 6, 7]) {
    const suitsWithRun = new Set(
      sequences.filter((s) => rankOf(s.index) === startRank).map((s) => suitOf(s.index)),
    );
    if (suitsWithRun.size === 3) {
      out.push({ key: 'sanshoku', name: '三色同順', han: 2 });
      break;
    }
  }
  for (const suit of ['m', 'p', 's'] as const) {
    const ranks = new Set(sequences.filter((s) => suitOf(s.index) === suit).map((s) => rankOf(s.index)));
    if (ranks.has(1) && ranks.has(4) && ranks.has(7)) {
      out.push({ key: 'ittsu', name: '一気通貫', han: 2 });
      break;
    }
  }
  const allBlocksTouchTerminal =
    melds.every((m) => (m.kind === 'triplet' ? isTerminalOrHonor(indexToTile(m.index)) : rankOf(m.index) === 1 || rankOf(m.index) === 7)) &&
    isTerminalOrHonor(indexToTile(pairIndex));
  if (allBlocksTouchTerminal) {
    const anyHonor = tiles14.some((t) => isHonor(t));
    out.push(anyHonor ? { key: 'chanta', name: '混全帯么九', han: 1 } : { key: 'junchan', name: '純全帯么九', han: 2 });
  }

  return out;
}

/** Tiles that, if drawn, would lower this yaku's shanten (mock heuristic). */
export function ukeireForKey(key: string, hand: string[]): string[] {
  const base = shantenForKey(key, hand);
  if (base === null) return [];
  const out: string[] = [];
  for (const t of ALL_TILE_TYPES) {
    const idx = ALL_TILE_TYPES.indexOf(t);
    if (countsFromTiles(hand)[idx] >= 4) continue;
    const withDraw = [...hand, t];
    const after = shantenForKey(key, withDraw);
    if (after !== null && after < base) out.push(t);
  }
  return out;
}
