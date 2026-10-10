// The dojo's growth: XP, level, coins and the shop's purchases. The first half
// is pure functions on a DojoProgress; the second is a thin layer over
// localStorage. Plain Node runs the tests, so imports carry the .ts extension.
import {
  COINS_PER_HAN,
  DEFAULT_BACK,
  DEFAULT_CLOTH,
  DEFAULT_EFFECT,
  DEFAULT_STICK,
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
import type { CpuLevel, GameLength } from '../api.ts';
import { DEFAULT_GAME_CPU, DEFAULT_GAME_LENGTH, HANCHAN_LEVEL, NORMAL_CPU_LEVEL, rankMultiplier } from './rules.ts';

export interface DojoProgress {
  version: 1;
  xp: number; // the total, never lowered
  coins: number;
  ownedYaku: string[];
  ownedItems: string[]; // 'theme:*' | 'back:*' | 'cloth:*' | 'stick:*' | 'effect:*' | 'assist:*' | 'cheat:*' | 'yakuman-pack' and every bought yaku
  activeTheme: string;
  activeBack: string; // a 'back:*' item or 'default' (data before the backs had none: 'default')
  // A 'cloth:*', 'stick:*' or 'effect:*' item or 'default' (data before them had none: 'default').
  activeCloth: string;
  activeStick: string;
  activeEffect: string;
  settled: string[]; // the seeds (decimal strings) of the games whose reward was paid
  firstGameBonus: boolean; // the first-game bonus was paid
  // The rounds of an unfinished game (by its public id, the URL's game) whose won han were paid
  // as they ended; dropped when the game is settled. Data from before had none: {}.
  paidRounds: Record<string, number>;
  // The game the hub starts, once unlocked (rules.ts). Data from before had neither: tonpuu, weak.
  gameLength: GameLength;
  gameCpu: CpuLevel;
  // The curriculum's lessons (lessons.ts) by id: those not begun are absent. Data from before had none: {}.
  lessons: Record<string, LessonProgress>;
  // The 師範戦 (masterMatch.ts). Data from before had none: not tried, the ウラ面 closed.
  masterMatch: MasterMatchRecord;
  // The cheats (ids) owned when they moved to the ウラ面 (#323): those stay usable in the 表's games but
  // the 師範戦 (cheatUsable); a cheat bought later works in the ウラ面 only. Data from before had none:
  // the cheats it owned then (an early save's boolean: the cheats owned when read, if true).
  legacyCheats: string[];
}

/**
 * The 師範戦's record: games tried (dealt) and won; the ウラ面 opens with the first win and stays open.
 * A won 師範戦 may be played again, its rank paying the master's multiplier all the same: #320
 * decides whether a won one should pay less.
 */
export interface MasterMatchRecord {
  tries: number;
  wins: number;
  uraOpen: boolean;
}

/** A lesson's progress: the successes so far in its current stage, and how far it got. */
export interface LessonProgress {
  assisted: boolean; // passed with the assists (a lesson without assists starts past them)
  count: number; // successes in the current stage
  done: boolean; // passed without the assists; its reward was paid
  seen: string[]; // the keys of the successes counted (lessons.ts), none counted twice; [] once done
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
    activeCloth: DEFAULT_CLOTH,
    activeStick: DEFAULT_STICK,
    activeEffect: DEFAULT_EFFECT,
    settled: [],
    firstGameBonus: false,
    paidRounds: {},
    gameLength: DEFAULT_GAME_LENGTH,
    gameCpu: DEFAULT_GAME_CPU,
    lessons: {},
    masterMatch: { tries: 0, wins: 0, uraOpen: false },
    legacyCheats: [],
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
  length?: GameLength; // a game without them is a 東風戦 against weak CPUs
  cpu?: CpuLevel; // 'master' is the 師範戦: settling it records the win (1st place)
}

export interface Reward {
  rank: number;
  rankMultiplier: number; // of the rank's XP and coins: 半荘戦 x2, CPU 普通 x2 (rules.ts)
  rankXp: number;
  xp: number; // the game's whole XP, the rounds' won han paid before included
  coins: number; // the game's whole coins, before the floor at 0: may be negative
  rankCoins: number;
  hanCoins: number; // the won han's, all rounds
  wins: number; // the rounds won with a counted yaku (han > 0)
  winBonusCoins: number; // 和了祝儀: WIN_BONUS_COINS per win, but for the cheated wins
  cheatedWins: number; // the wins of rounds with a redraw or a summon: no 和了祝儀
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
  // A 師範戦's outcome: won (1st place), and whether this win opened the ウラ面.
  masterMatch?: { won: boolean; uraOpened: boolean };
}

export function sumHan(rounds: RoundLite[]): number {
  return rounds.reduce((n, r) => n + (r.han ?? 0), 0);
}

/** The rounds won with a counted yaku (han above 0). */
export function sumWins(rounds: RoundLite[]): number {
  return rounds.filter((r) => (r.han ?? 0) > 0).length;
}

/** Whether the round had a redraw or a summon: its win pays no 和了祝儀. */
export function cheated(r: RoundLite): boolean {
  return (r.redraws ?? 0) > 0 || (r.summons ?? 0) > 0;
}

/** The wins that pay the 和了祝儀: those of rounds without a redraw or a summon. */
function bonusWins(rounds: RoundLite[]): number {
  return sumWins(rounds.filter((r) => !cheated(r)));
}

/** The coins won rounds pay: their han's and the 和了祝儀. */
function winCoins(rounds: RoundLite[]): number {
  return sumHan(rounds) * COINS_PER_HAN + bonusWins(rounds) * WIN_BONUS_COINS;
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
  const multiplier = rankMultiplier(g.length ?? DEFAULT_GAME_LENGTH, g.cpu ?? DEFAULT_GAME_CPU);
  const rankXp = Math.round(RANK_XP[rank - 1] * multiplier);
  const xp = rankXp + han * XP_PER_HAN;
  const rankCoins = Math.round(RANK_COINS[rank - 1] * multiplier);
  const hanCoins = han * COINS_PER_HAN;
  const wins = sumWins(g.rounds);
  const winBonusCoins = bonusWins(g.rounds) * WIN_BONUS_COINS;
  const cheatedWins = wins - bonusWins(g.rounds);
  const coins = rankCoins + hanCoins + winBonusCoins - redrawCost - summonCost + bonus;
  const paidXp = sumHan(alreadyPaid) * XP_PER_HAN;
  const paidCoins = winCoins(alreadyPaid);
  const coinsAfter = Math.max(0, p.coins + coins - paidCoins);
  const paidRounds = { ...p.paidRounds };
  if (gameId !== undefined) delete paidRounds[gameId];
  // The 師範戦's try was counted as it was dealt (recordMasterTry); its win counts here.
  const master = g.cpu === 'master' ? { won: rank === 1, uraOpened: rank === 1 && !p.masterMatch.uraOpen } : undefined;
  const progress: DojoProgress = {
    ...p,
    xp: p.xp + xp - paidXp,
    coins: coinsAfter,
    settled: [...p.settled, key],
    firstGameBonus: true,
    paidRounds,
    masterMatch: master
      ? { ...p.masterMatch, wins: p.masterMatch.wins + (master.won ? 1 : 0), uraOpen: p.masterMatch.uraOpen || master.won }
      : p.masterMatch,
  };
  return {
    progress,
    reward: {
      rank, rankMultiplier: multiplier, rankXp, xp, coins, rankCoins, hanCoins, wins, winBonusCoins, cheatedWins, paidCoins, paidXp, han, redraws, redrawCost, summons, summonCost,
      firstGameBonus: bonus, coinsAfter,
      levelBefore: level(p.xp - paidXp), levelAfter: level(progress.xp),
      masterMatch: master,
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

// 'ura': a cheat, sold only once the ウラ面 is open (the 師範戦 won), whatever the level.
export type PurchaseDenied = 'unknown' | 'owned' | 'level' | 'ura' | 'requires' | 'coins';

export type Purchase =
  | { ok: true; progress: DojoProgress }
  | { ok: false; reason: PurchaseDenied };

export function purchase(p: DojoProgress, id: string): Purchase {
  const item = findItem(id);
  if (!item) return { ok: false, reason: 'unknown' };
  if (owns(p, id)) return { ok: false, reason: 'owned' };
  if (item.kind === 'cheat') {
    if (!p.masterMatch.uraOpen) return { ok: false, reason: 'ura' };
  } else if (level(p.xp) < item.level) {
    return { ok: false, reason: 'level' };
  }
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

export function setCloth(p: DojoProgress, cloth: string): DojoProgress {
  return cloth === DEFAULT_CLOTH || p.ownedItems.includes(cloth) ? { ...p, activeCloth: cloth } : p;
}

export function setStick(p: DojoProgress, stick: string): DojoProgress {
  return stick === DEFAULT_STICK || p.ownedItems.includes(stick) ? { ...p, activeStick: stick } : p;
}

export function setEffect(p: DojoProgress, effect: string): DojoProgress {
  return effect === DEFAULT_EFFECT || p.ownedItems.includes(effect) ? { ...p, activeEffect: effect } : p;
}

/** Whether the game length is unlocked at the progress's level. */
export function lengthUnlocked(p: DojoProgress, length: GameLength): boolean {
  return length === DEFAULT_GAME_LENGTH || level(p.xp) >= HANCHAN_LEVEL;
}

/**
 * Whether the hub's game may be against the CPU level at the progress's level. The master and the
 * urashihan never: they play only the 師範戦 and the ウラ面's games (masterMatch.ts), not the hub's game.
 */
export function cpuUnlocked(p: DojoProgress, cpu: CpuLevel): boolean {
  if (cpu === 'master' || cpu === 'ura') return false;
  return cpu === DEFAULT_GAME_CPU || level(p.xp) >= NORMAL_CPU_LEVEL;
}

/** Counts a try of the 師範戦, as its game is dealt (an abandoned one counts too). */
export function recordMasterTry(p: DojoProgress): DojoProgress {
  return { ...p, masterMatch: { ...p.masterMatch, tries: p.masterMatch.tries + 1 } };
}

/** The kind of a dojo game: the 表's games, the 師範戦, or the ウラ面's games. */
export type DojoGameKind = 'omote' | 'master' | 'ura';

/** The kind of a dojo game against the CPU level: the master plays only the 師範戦, the urashihan only the ウラ面. */
export function gameKind(cpu: CpuLevel | undefined): DojoGameKind {
  return cpu === 'master' ? 'master' : cpu === 'ura' ? 'ura' : 'omote';
}

/**
 * Whether the owned cheat `id` may be used in a game of the kind: never in the 師範戦 (the 表's last
 * trial is played straight); in the ウラ面's games once it is open; and in the 表's other games only
 * if it was owned when the cheats moved to the ウラ面 (legacyCheats: never taken away).
 */
export function cheatUsable(p: DojoProgress, id: string, kind: DojoGameKind): boolean {
  if (!p.ownedItems.includes(id)) return false;
  const legacy = p.legacyCheats.includes(id);
  switch (kind) {
    case 'master':
      return false;
    case 'ura':
      return legacy || p.masterMatch.uraOpen;
  }
  return legacy;
}

export function setGameLength(p: DojoProgress, length: GameLength): DojoProgress {
  return lengthUnlocked(p, length) ? { ...p, gameLength: length } : p;
}

export function setGameCpu(p: DojoProgress, cpu: CpuLevel): DojoProgress {
  return cpuUnlocked(p, cpu) ? { ...p, gameCpu: cpu } : p;
}

/** The length and CPU of the game the hub starts: the ones chosen, as defaults when not unlocked. */
export function dojoGame(p: DojoProgress): { length: GameLength; cpu: CpuLevel } {
  return {
    length: lengthUnlocked(p, p.gameLength) ? p.gameLength : DEFAULT_GAME_LENGTH,
    cpu: cpuUnlocked(p, p.gameCpu) ? p.gameCpu : DEFAULT_GAME_CPU,
  };
}

/** The dojo options of CreateGame (the engine's DojoOptions) for what is owned, the cheats as cheatUsable says for the kind of game. */
export function dojoOptions(p: DojoProgress, kind: DojoGameKind = 'omote'): {
  yaku: string[];
  peek: boolean;
  redraws_per_round: number;
  ura_peek: boolean;
  riichi_waits: boolean;
  wall_peek: number;
  summons_per_round: number;
} {
  const has = (id: string) => cheatUsable(p, id, kind);
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

/** The price 立直 was sold at, refunded to those who bought it. */
const RIICHI_REFUND = 40;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');
/** A stored lesson's progress, or null if out of shape (seen came later: none counted). */
function lessonProgress(v: unknown): LessonProgress | null {
  if (typeof v !== 'object' || v === null) return null;
  const l = v as Record<string, unknown>;
  if (typeof l.assisted !== 'boolean' || !isCount(l.count) || typeof l.done !== 'boolean') return null;
  if (l.seen !== undefined && !isStrings(l.seen)) return null;
  return { assisted: l.assisted, count: l.count, done: l.done, seen: l.seen ?? [] };
}

/** The progress in a JSON text, or null for anything that is not a version 1 progress. */
export function parseProgress(text: string): DojoProgress | null {
  return parse(text)?.progress ?? null;
}

/** parseProgress, with the coins the reading refunded (a bought 立直's; 0 for none). */
function parse(text: string): { progress: DojoProgress; refunded: number } | null {
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
  // The cloth, the riichi stick and the win effect came later still: a progress without them has the defaults.
  for (const k of ['activeCloth', 'activeStick', 'activeEffect']) {
    if (o[k] !== undefined && typeof o[k] !== 'string') return null;
  }
  const paidRounds = o.paidRounds ?? {};
  if (typeof paidRounds !== 'object' || paidRounds === null || Array.isArray(paidRounds)) return null;
  if (!Object.values(paidRounds).every(isCount)) return null;
  // gameLength and gameCpu came later still: a progress without them plays the first game.
  const gameLength = o.gameLength ?? DEFAULT_GAME_LENGTH;
  const gameCpu = o.gameCpu ?? DEFAULT_GAME_CPU;
  if (gameLength !== 'tonpuu' && gameLength !== 'hanchan') return null;
  if (gameCpu !== 'weak' && gameCpu !== 'normal') return null;
  // lessons came later still: a progress without them has begun none. A lessons
  // part out of shape loses only its entries out of shape, not the whole progress.
  const lessons: Record<string, LessonProgress> = {};
  if (typeof o.lessons === 'object' && o.lessons !== null && !Array.isArray(o.lessons)) {
    for (const [id, l] of Object.entries(o.lessons)) {
      const lp = lessonProgress(l);
      if (lp) lessons[id] = lp;
    }
  }
  // masterMatch and legacyCheats came later still: a progress without them has not tried the
  // 師範戦, and the cheats it owns are its legacy (usable everywhere, as they were).
  const mm = o.masterMatch ?? { tries: 0, wins: 0, uraOpen: false };
  if (typeof mm !== 'object' || mm === null) return null;
  const m = mm as Record<string, unknown>;
  if (!isCount(m.tries) || !isCount(m.wins) || typeof m.uraOpen !== 'boolean') return null;
  const owned = o.ownedItems.filter((id) => id.startsWith('cheat:'));
  let legacyCheats: string[];
  if (o.legacyCheats === undefined || o.legacyCheats === true) legacyCheats = owned;
  else if (o.legacyCheats === false) legacyCheats = [];
  else if (isStrings(o.legacyCheats)) legacyCheats = o.legacyCheats;
  else return null;
  // 立直 was sold before it joined the initial yaku: a bought one leaves the items and its price
  // comes back, once (the next load finds it gone). A 平和 owned from before stays owned.
  const refunded = o.ownedItems.includes('riichi') ? RIICHI_REFUND : 0;
  const progress: DojoProgress = {
    version: 1,
    xp: o.xp,
    coins: o.coins + refunded,
    // The yaku a new dojo owns are always owned (門前清自摸和 and 立直 joined them later).
    ownedYaku: [...o.ownedYaku, ...INITIAL_YAKU.filter((k) => !(o.ownedYaku as string[]).includes(k))],
    ownedItems: refunded ? o.ownedItems.filter((id) => id !== 'riichi') : o.ownedItems,
    activeTheme: o.activeTheme,
    activeBack: o.activeBack ?? DEFAULT_BACK,
    activeCloth: (o.activeCloth as string | undefined) ?? DEFAULT_CLOTH,
    activeStick: (o.activeStick as string | undefined) ?? DEFAULT_STICK,
    activeEffect: (o.activeEffect as string | undefined) ?? DEFAULT_EFFECT,
    settled: o.settled,
    firstGameBonus: o.firstGameBonus,
    paidRounds: paidRounds as Record<string, number>,
    gameLength,
    gameCpu,
    lessons,
    masterMatch: { tries: m.tries, wins: m.wins, uraOpen: m.uraOpen },
    legacyCheats,
  };
  return { progress, refunded };
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

/** Whether the dojo has a saved progress (it has been opened): practice mode offers its lessons only then. */
export function progressSaved(store: KeyValueStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

/**
 * The saved progress. A text that does not parse is kept under CORRUPT_KEY and
 * the dojo starts over, with `corrupted` set so the page can say so. `refunded`
 * is the coins the reading gave back (a bought 立直's), until the progress is saved.
 */
export function loadProgress(store: KeyValueStore | null = defaultStore()): { progress: DojoProgress; corrupted: boolean; refunded: number } {
  let raw: string | null = null;
  try {
    raw = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return { progress: initialProgress(), corrupted: false, refunded: 0 };
  }
  if (raw === null) return { progress: initialProgress(), corrupted: false, refunded: 0 };
  const parsed = parse(raw);
  if (parsed) return { ...parsed, corrupted: false };
  try {
    store?.setItem(CORRUPT_KEY, raw);
  } catch {
    // Nothing more to do: the start over goes on.
  }
  return { progress: initialProgress(), corrupted: true, refunded: 0 };
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
