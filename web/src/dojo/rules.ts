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
export const NORMAL_CPU_RANK_MULTIPLIER = 1.5;

export const DEFAULT_GAME_LENGTH: GameLength = 'tonpuu';
export const DEFAULT_GAME_CPU: CpuLevel = 'weak';

export function rankMultiplier(length: GameLength, cpu: CpuLevel): number {
  return (length === 'hanchan' ? HANCHAN_RANK_MULTIPLIER : 1) * (cpu === 'normal' ? NORMAL_CPU_RANK_MULTIPLIER : 1);
}

/** 「半荘 ×2」「CPU 普通 ×1.5」「半荘・CPU 普通 ×3」, or '' for the plain game. */
export function rankMultiplierLabel(length: GameLength, cpu: CpuLevel): string {
  const names = [length === 'hanchan' && '半荘', cpu === 'normal' && 'CPU 普通'].filter(Boolean);
  return names.length === 0 ? '' : `${names.join('・')} ×${rankMultiplier(length, cpu)}`;
}
