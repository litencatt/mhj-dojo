// The dojo's game rules beyond the first 東風戦 against weak CPUs: the level
// that unlocks each, and how much more its rank pays. Plain Node runs the
// tests, so imports carry the .ts extension.
import type { CpuLevel, GameLength } from '../api.ts';

/** The level that unlocks 半荘戦, and the one that unlocks the normal CPU (no purchase needed). */
export const HANCHAN_LEVEL = 5;
export const NORMAL_CPU_LEVEL = 7;

/**
 * The rank's XP and coins (not the won han, the 和了祝儀 or the first-game
 * bonus: a longer game has more rounds to win) are multiplied by these; both
 * chosen, by their product.
 */
export const HANCHAN_RANK_MULTIPLIER = 2;
export const NORMAL_CPU_RANK_MULTIPLIER = 2;
/**
 * The 師範戦 (against the master) and the ウラ面's games (against the urashihan), by the CPU alone
 * (docs/dojo-economy.md, #320). The master is harder than the normal CPU (a human-like player is
 * 1st about 22% of the time) and the 師範戦 is the 表's last trial: x3 until it is won. Won, it
 * pays as the normal CPU does (x2), so that playing it again is no better a way to earn than the
 * 表's games. The urashihan is beaten with the cheats, whose redraws and summons the game pays: x2.
 */
export const MASTER_CPU_RANK_MULTIPLIER = 3;
export const URA_CPU_RANK_MULTIPLIER = 2;

const CPU_RANK_MULTIPLIERS: Record<CpuLevel, number> = {
  weak: 1,
  normal: NORMAL_CPU_RANK_MULTIPLIER,
  master: MASTER_CPU_RANK_MULTIPLIER,
  ura: URA_CPU_RANK_MULTIPLIER,
};

const CPU_LABELS: Record<CpuLevel, string> = { weak: '', normal: 'CPU 普通', master: 'CPU 師範', ura: 'CPU 裏師範' };

export const DEFAULT_GAME_LENGTH: GameLength = 'tonpuu';
export const DEFAULT_GAME_CPU: CpuLevel = 'weak';

/** The rank's multiplier of a game; masterWon: the 師範戦 was won before it (it then pays as the normal CPU). */
export function rankMultiplier(length: GameLength, cpu: CpuLevel, masterWon = false): number {
  const byCpu = cpu === 'master' && masterWon ? NORMAL_CPU_RANK_MULTIPLIER : CPU_RANK_MULTIPLIERS[cpu];
  return (length === 'hanchan' ? HANCHAN_RANK_MULTIPLIER : 1) * byCpu;
}

/** 「半荘 ×2」「CPU 普通 ×2」「半荘・CPU 普通 ×4」「半荘・CPU 師範 ×6」「半荘・CPU 師範（勝利後） ×4」, or '' for the plain game. */
export function rankMultiplierLabel(length: GameLength, cpu: CpuLevel, masterWon = false): string {
  const name = cpu === 'master' && masterWon ? `${CPU_LABELS.master}（勝利後）` : CPU_LABELS[cpu];
  const names = [length === 'hanchan' && '半荘', name].filter(Boolean);
  return names.length === 0 ? '' : `${names.join('・')} ×${rankMultiplier(length, cpu, masterWon)}`;
}

const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/**
 * The 級位 shown for a level: Lv1–10 are 10級–1級, then 初段, 二段 and on
 * (a level is never shown as a number in the UI).
 */
export function rankName(level: number): string {
  if (level <= 10) return `${11 - level}級`;
  const dan = level - 10;
  if (dan === 1) return '初段';
  return dan <= 10 ? `${KANJI[dan]}段` : `${dan}段`;
}
