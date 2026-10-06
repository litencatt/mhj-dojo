// The dojo's growth: XP, level, coins and the shop's purchases. The first half
// is pure functions on a DojoProgress; the second is a thin layer over
// localStorage. Plain Node runs the tests, so imports carry the .ts extension.
import {
  COINS_PER_HAN,
  DEFAULT_BACK,
  DEFAULT_THEME,
  FIRST_GAME_BONUS,
  INITIAL_YAKU,
  RANK_COINS,
  RANK_XP,
  REDRAW_COST,
  SUMMON_COST,
  WIN_BONUS_COINS,
  XP_PER_HAN,
  findItem,
} from './catalog.ts';

export interface DojoProgress {
  version: 1;
  xp: number; // the total, never lowered
  coins: number;
  ownedYaku: string[];
  ownedItems: string[]; // 'theme:*' | 'back:*' | 'assist:*' | 'cheat:*' | 'yakuman-pack' and every bought yaku
  activeTheme: string;
  activeBack: string; // a 'back:*' item or 'default' (data before the backs had none: 'default')
  settled: string[]; // the seeds (decimal strings) of the games whose reward was paid
  firstGameBonus: boolean; // the first-game bonus was paid
  // The rounds of an unfinished game (by its public id, the URL's game) whose won han were paid
  // as they ended; dropped when the game is settled. Data from before had none: {}.
  paidRounds: Record<string, number>;
}

export function initialProgress(): DojoProgress {
  return {
    version: 1,
    xp: 0,
    coins: 0,
    ownedYaku: [...INITIAL_YAKU],
    ownedItems: [],
    activeTheme: DEFAULT_THEME,
    activeBack: DEFAULT_BACK,
    settled: [],
    firstGameBonus: false,
    paidRounds: {},
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

/** What the dojo reads of a RoundSummary (the engine adds han, redraws and summons). */
export interface RoundLite {
  han?: number;
  redraws?: number;
  summons?: number;
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
  xp: number; // the game's whole XP, the rounds' won han paid before included
  coins: number; // the game's whole coins, before the floor at 0: may be negative
  rankCoins: number;
  hanCoins: number; // the won han's, all rounds
  wins: number; // the rounds won with a counted yaku (han > 0)
  winBonusCoins: number; // 和了祝儀: WIN_BONUS_COINS per win
  paidCoins: number; // of hanCoins and winBonusCoins, paid as the rounds ended (paidXp likewise)
  paidXp: number;
  han: number;
  redraws: number;
  redrawCost: number;
  summons: number;
  summonCost: number;
  firstGameBonus: number; // 0 if it was paid before
  coinsAfter: number;
  levelBefore: number;
  levelAfter: number;
}

export function sumHan(rounds: RoundLite[]): number {
  return rounds.reduce((n, r) => n + (r.han ?? 0), 0);
}

/** The rounds won with a counted yaku (han above 0). */
export function sumWins(rounds: RoundLite[]): number {
  return rounds.filter((r) => (r.han ?? 0) > 0).length;
}

/** The coins won rounds pay: their han's and the 和了祝儀. */
function winCoins(rounds: RoundLite[]): number {
  return sumHan(rounds) * COINS_PER_HAN + sumWins(rounds) * WIN_BONUS_COINS;
}

export function sumRedraws(rounds: RoundLite[]): number {
  return rounds.reduce((n, r) => n + (r.redraws ?? 0), 0);
}

export function sumSummons(rounds: RoundLite[]): number {
  return rounds.reduce((n, r) => n + (r.summons ?? 0), 0);
}

/** The coins the finished rounds' redraws and summons cost, unpaid until the game ends. */
function unpaid(rounds: RoundLite[]): number {
  return sumRedraws(rounds) * REDRAW_COST + sumSummons(rounds) * SUMMON_COST;
}

/**
 * Pays the won han (and the 和了祝儀) of the rounds of an unfinished game that have ended since
 * last paid (paidRounds keeps the count by the game's public id, which a
 * reload keeps). Null when there is nothing new to pay.
 */
export function payRounds(
  p: DojoProgress,
  gameId: string,
  rounds: RoundLite[],
): { progress: DojoProgress; xp: number; coins: number } | null {
  const paid = p.paidRounds[gameId] ?? 0;
  if (rounds.length <= paid) return null;
  const xp = sumHan(rounds.slice(paid)) * XP_PER_HAN;
  const coins = winCoins(rounds.slice(paid));
  return {
    progress: { ...p, xp: p.xp + xp, coins: p.coins + coins, paidRounds: { ...p.paidRounds, [gameId]: rounds.length } },
    xp,
    coins,
  };
}

/**
 * Pays a finished game once: nothing happens for a game that is not over, has
 * no known seed or whose seed was settled. The rounds payRounds has paid (by
 * gameId) are not paid again; the rank, the first-game bonus and the cheats'
 * costs are paid here. The floor at 0 applies to the whole balance after the
 * game, not to the game's own difference, or a redraw would cost nothing for
 * a player with no coins left to lose.
 */
export function settle(p: DojoProgress, g: FinishedGame, gameId?: string): { progress: DojoProgress; reward: Reward | null } {
  if (!g.game_over || g.seed === null) return { progress: p, reward: null };
  const key = String(g.seed);
  if (p.settled.includes(key)) return { progress: p, reward: null };
  const rank = g.standings.find((s) => s.seat === g.you)?.rank;
  if (rank === undefined || rank < 1 || rank > 4) return { progress: p, reward: null };

  const han = sumHan(g.rounds);
  const alreadyPaid = gameId === undefined ? [] : g.rounds.slice(0, p.paidRounds[gameId] ?? 0);
  const redraws = sumRedraws(g.rounds);
  const redrawCost = redraws * REDRAW_COST;
  const summons = sumSummons(g.rounds);
  const summonCost = summons * SUMMON_COST;
  const bonus = p.firstGameBonus ? 0 : FIRST_GAME_BONUS;
  const xp = RANK_XP[rank - 1] + han * XP_PER_HAN;
  const rankCoins = RANK_COINS[rank - 1];
  const hanCoins = han * COINS_PER_HAN;
  const wins = sumWins(g.rounds);
  const winBonusCoins = wins * WIN_BONUS_COINS;
  const coins = rankCoins + hanCoins + winBonusCoins - redrawCost - summonCost + bonus;
  const paidXp = sumHan(alreadyPaid) * XP_PER_HAN;
  const paidCoins = winCoins(alreadyPaid);
  const coinsAfter = Math.max(0, p.coins + coins - paidCoins);
  const paidRounds = { ...p.paidRounds };
  if (gameId !== undefined) delete paidRounds[gameId];
  const progress: DojoProgress = {
    ...p,
    xp: p.xp + xp - paidXp,
    coins: coinsAfter,
    settled: [...p.settled, key],
    firstGameBonus: true,
    paidRounds,
  };
  return {
    progress,
    reward: {
      rank, xp, coins, rankCoins, hanCoins, wins, winBonusCoins, paidCoins, paidXp, han, redraws, redrawCost, summons, summonCost,
      firstGameBonus: bonus, coinsAfter,
      levelBefore: level(p.xp - paidXp), levelAfter: level(progress.xp),
    },
  };
}

/**
 * Whether a redraw may be asked for now: the balance less the redraws and
 * summons of the finished rounds (still unpaid until the game ends) covers one more.
 */
export function canAffordRedraw(p: DojoProgress, rounds: RoundLite[]): boolean {
  return p.coins - unpaid(rounds) >= REDRAW_COST;
}

/** canAffordRedraw for a summon (牌寄せ). */
export function canAffordSummon(p: DojoProgress, rounds: RoundLite[]): boolean {
  return p.coins - unpaid(rounds) >= SUMMON_COST;
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

export function setBack(p: DojoProgress, back: string): DojoProgress {
  return back === DEFAULT_BACK || p.ownedItems.includes(back) ? { ...p, activeBack: back } : p;
}

/** The dojo options of CreateGame (the engine's DojoOptions) for what is owned. */
export function dojoOptions(p: DojoProgress): {
  yaku: string[];
  peek: boolean;
  redraws_per_round: number;
  ura_peek: boolean;
  riichi_waits: boolean;
  wall_peek: number;
  summons_per_round: number;
} {
  const has = (id: string) => p.ownedItems.includes(id);
  return {
    yaku: [...p.ownedYaku],
    peek: has('cheat:peek'),
    redraws_per_round: has('cheat:redraw') ? 1 : 0,
    ura_peek: has('cheat:ura'),
    riichi_waits: has('cheat:riichiwaits'),
    wall_peek: has('cheat:wallpeek') ? 3 : 0,
    summons_per_round: has('cheat:summon') ? 1 : 0,
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
  // activeBack and paidRounds came later: a progress without them has the default back and none paid.
  if (o.activeBack !== undefined && typeof o.activeBack !== 'string') return null;
  const paidRounds = o.paidRounds ?? {};
  if (typeof paidRounds !== 'object' || paidRounds === null || Array.isArray(paidRounds)) return null;
  if (!Object.values(paidRounds).every(isCount)) return null;
  return {
    version: 1,
    xp: o.xp,
    coins: o.coins,
    // The yaku a new dojo owns are always owned (門前清自摸和 joined them later).
    ownedYaku: [...o.ownedYaku, ...INITIAL_YAKU.filter((k) => !(o.ownedYaku as string[]).includes(k))],
    ownedItems: o.ownedItems,
    activeTheme: o.activeTheme,
    activeBack: o.activeBack ?? DEFAULT_BACK,
    settled: o.settled,
    firstGameBonus: o.firstGameBonus,
    paidRounds: paidRounds as Record<string, number>,
  };
}

/**
 * A loaded progress (a backup) to replace the current one, keeping what the
 * current one paid: the settled games (both), the rounds paid (the larger count
 * by game) and the first-game bonus, so an older backup cannot pay them again.
 */
export function importProgress(current: DojoProgress, loaded: DojoProgress): DojoProgress {
  const paidRounds = { ...loaded.paidRounds };
  for (const [id, n] of Object.entries(current.paidRounds)) paidRounds[id] = Math.max(n, paidRounds[id] ?? 0);
  return {
    ...loaded,
    settled: [...loaded.settled, ...current.settled.filter((s) => !loaded.settled.includes(s))],
    firstGameBonus: loaded.firstGameBonus || current.firstGameBonus,
    paidRounds,
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
