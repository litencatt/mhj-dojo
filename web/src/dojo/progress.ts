// The dojo's growth: XP, level, coins and the shop's purchases. The first half
// is pure functions on a DojoProgress; the second is a thin layer over
// localStorage. Plain Node runs the tests, so imports carry the .ts extension.
import {
  COINS_PER_HAN,
  DEFAULT_THEME,
  FIRST_GAME_BONUS,
  INITIAL_YAKU,
  RANK_COINS,
  RANK_XP,
  REDRAW_COST,
  XP_PER_HAN,
  findItem,
} from './catalog.ts';

export interface DojoProgress {
  version: 1;
  xp: number; // the total, never lowered
  coins: number;
  ownedYaku: string[];
  ownedItems: string[]; // 'theme:*' | 'assist:*' | 'cheat:*' | 'yakuman-pack' and every bought yaku
  activeTheme: string;
  settled: string[]; // the seeds (decimal strings) of the games whose reward was paid
  firstGameBonus: boolean; // the first-game bonus was paid
}

export function initialProgress(): DojoProgress {
  return {
    version: 1,
    xp: 0,
    coins: 0,
    ownedYaku: [...INITIAL_YAKU],
    ownedItems: [],
    activeTheme: DEFAULT_THEME,
    settled: [],
    firstGameBonus: false,
  };
}

/** The XP a level needs in total: 50 n (n - 1). */
export function xpForLevel(n: number): number {
  return 50 * n * (n - 1);
}

export function level(xp: number): number {
  let n = 1;
  while (xp >= xpForLevel(n + 1)) n++;
  return n;
}

/** The share of the way from this level's XP to the next level's, 0 to 1. */
export function levelProgress(xp: number): number {
  const n = level(xp);
  const from = xpForLevel(n);
  return (xp - from) / (xpForLevel(n + 1) - from);
}

// ---- Rewards ----

/** What the dojo reads of a RoundSummary (the engine adds han and redraws). */
export interface RoundLite {
  han?: number;
  redraws?: number;
}

/** What the dojo reads of a finished game's state. */
export interface FinishedGame {
  seed: number | null;
  you: number;
  game_over: boolean;
  standings: { seat: number; rank: number }[];
  rounds: RoundLite[];
}

export interface Reward {
  rank: number;
  xp: number;
  coins: number; // before the floor at 0: may be negative
  han: number;
  redraws: number;
  redrawCost: number;
  firstGameBonus: number; // 0 if it was paid before
  coinsAfter: number;
  levelBefore: number;
  levelAfter: number;
}

export function sumHan(rounds: RoundLite[]): number {
  return rounds.reduce((n, r) => n + (r.han ?? 0), 0);
}

export function sumRedraws(rounds: RoundLite[]): number {
  return rounds.reduce((n, r) => n + (r.redraws ?? 0), 0);
}

/**
 * Pays a finished game once: nothing happens for a game that is not over, has
 * no known seed or whose seed was settled. The floor at 0 applies to the whole
 * balance after the game, not to the game's own difference, or a redraw would
 * cost nothing for a player with no coins left to lose.
 */
export function settle(p: DojoProgress, g: FinishedGame): { progress: DojoProgress; reward: Reward | null } {
  if (!g.game_over || g.seed === null) return { progress: p, reward: null };
  const key = String(g.seed);
  if (p.settled.includes(key)) return { progress: p, reward: null };
  const rank = g.standings.find((s) => s.seat === g.you)?.rank;
  if (rank === undefined || rank < 1 || rank > 4) return { progress: p, reward: null };

  const han = sumHan(g.rounds);
  const redraws = sumRedraws(g.rounds);
  const redrawCost = redraws * REDRAW_COST;
  const bonus = p.firstGameBonus ? 0 : FIRST_GAME_BONUS;
  const xp = RANK_XP[rank - 1] + han * XP_PER_HAN;
  const coins = RANK_COINS[rank - 1] + han * COINS_PER_HAN - redrawCost + bonus;
  const coinsAfter = Math.max(0, p.coins + coins);
  const progress: DojoProgress = {
    ...p,
    xp: p.xp + xp,
    coins: coinsAfter,
    settled: [...p.settled, key],
    firstGameBonus: true,
  };
  return {
    progress,
    reward: {
      rank, xp, coins, han, redraws, redrawCost, firstGameBonus: bonus, coinsAfter,
      levelBefore: level(p.xp), levelAfter: level(progress.xp),
    },
  };
}

/**
 * Whether a redraw may be asked for now: the balance less the redraws of the
 * finished rounds (still unpaid until the game ends) covers one more.
 */
export function canAffordRedraw(p: DojoProgress, rounds: RoundLite[]): boolean {
  return p.coins - sumRedraws(rounds) * REDRAW_COST >= REDRAW_COST;
}

// ---- Shop ----

export function owns(p: DojoProgress, id: string): boolean {
  return p.ownedItems.includes(id) || p.ownedYaku.includes(id);
}

export type PurchaseDenied = 'unknown' | 'owned' | 'level' | 'requires' | 'coins';

export type Purchase =
  | { ok: true; progress: DojoProgress }
  | { ok: false; reason: PurchaseDenied };

export function purchase(p: DojoProgress, id: string): Purchase {
  const item = findItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (owns(p, id)) return { ok: false, reason: 'owned' };
  if (level(p.xp) < item.level) return { ok: false, reason: 'level' };
  if (!(item.requires ?? []).every((r) => owns(p, r))) return { ok: false, reason: 'requires' };
  if (p.coins < item.price) return { ok: false, reason: 'coins' };
  const grants = (item.grants ?? []).filter((k) => !p.ownedYaku.includes(k));
  return {
    ok: true,
    progress: {
      ...p,
      coins: p.coins - item.price,
      ownedItems: [...p.ownedItems, id],
      ownedYaku: [...p.ownedYaku, ...grants],
    },
  };
}

export function setTheme(p: DojoProgress, theme: string): DojoProgress {
  return theme === DEFAULT_THEME || p.ownedItems.includes(theme) ? { ...p, activeTheme: theme } : p;
}

/** The dojo options of CreateGame (the engine's DojoOptions) for what is owned. */
export function dojoOptions(p: DojoProgress): { yaku: string[]; peek: boolean; redraws_per_round: number } {
  return {
    yaku: [...p.ownedYaku],
    peek: p.ownedItems.includes('cheat:peek'),
    redraws_per_round: p.ownedItems.includes('cheat:redraw') ? 1 : 0,
  };
}

// ---- Parsing and storage ----

export const STORAGE_KEY = 'mhj-dojo.dojo.v1';
export const CORRUPT_KEY = 'mhj-dojo.dojo.v1.corrupt';

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** The progress in a JSON text, or null for anything that is not a version 1 progress. */
export function parseProgress(text: string): DojoProgress | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 || !isCount(o.xp) || !isCount(o.coins)) return null;
  if (!isStrings(o.ownedYaku) || !isStrings(o.ownedItems) || !isStrings(o.settled)) return null;
  if (typeof o.activeTheme !== 'string' || typeof o.firstGameBonus !== 'boolean') return null;
  return {
    version: 1,
    xp: o.xp,
    coins: o.coins,
    ownedYaku: o.ownedYaku,
    ownedItems: o.ownedItems,
    activeTheme: o.activeTheme,
    settled: o.settled,
    firstGameBonus: o.firstGameBonus,
  };
}

export function exportProgress(p: DojoProgress): string {
  return JSON.stringify(p, null, 2);
}

/** The part of localStorage the dojo uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The saved progress. A text that does not parse is kept under CORRUPT_KEY and
 * the dojo starts over, with `corrupted` set so the page can say so.
 */
export function loadProgress(store: KeyValueStore | null = defaultStore()): { progress: DojoProgress; corrupted: boolean } {
  let raw: string | null = null;
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return { progress: initialProgress(), corrupted: false };
  }
  if (raw === null) return { progress: initialProgress(), corrupted: false };
  const progress = parseProgress(raw);
  if (progress) return { progress, corrupted: false };
  try {
    store?.setItem(CORRUPT_KEY, raw);
  } catch {
    // Nothing more to do: the start over goes on.
  }
  return { progress: initialProgress(), corrupted: true };
}

/** Whether the progress was stored (storage may be full or blocked). */
export function saveProgress(p: DojoProgress, store: KeyValueStore | null = defaultStore()): boolean {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify(p));
    return store !== null;
  } catch {
    return false;
  }
}
