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

export const DEFAULT_GAME_LENGTH: GameLength = 'tonpuu';
export const DEFAULT_GAME_CPU: CpuLevel = 'weak';

// The master (師範) is not offered in the dojo yet: it pays as a plain game here, and #323 gives the 師範戦 its own rules.
export function rankMultiplier(length: GameLength, cpu: CpuLevel): number {
  return (length === 'hanchan' ? HANCHAN_RANK_MULTIPLIER : 1) * (cpu === 'normal' ? NORMAL_CPU_RANK_MULTIPLIER : 1);
}

/** 「半荘 ×2」「CPU 普通 ×2」「半荘・CPU 普通 ×4」, or '' for the plain game. */
export function rankMultiplierLabel(length: GameLength, cpu: CpuLevel): string {
  const names = [length === 'hanchan' && '半荘', cpu === 'normal' && 'CPU 普通'].filter(Boolean);
  return names.length === 0 ? '' : `${names.join('・')} ×${rankMultiplier(length, cpu)}`;
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
