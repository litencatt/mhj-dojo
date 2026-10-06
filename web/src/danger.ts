import type { DangerLevel, SeatDanger } from './api';

// The badge's letter, also used in its text.
export const DANGER_NAMES: Record<DangerLevel, string> = { 0: '安', 1: '低', 2: '中', 3: '危' };

/** A tile's highest danger level over the riichi seats, or null with none. */
export function dangerLevel(danger: SeatDanger[] | undefined, tile: string): DangerLevel | null {
  if (!danger?.length) return null;
  return Math.max(...danger.map((d) => d.tiles[tile] ?? 3)) as DangerLevel;
}
