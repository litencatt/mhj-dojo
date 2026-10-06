import type { DangerLevel, SeatDanger, Tile } from './api';
import { seatLabel } from './seats.ts';

// The badge's letter, also used in its text.
export const DANGER_NAMES: Record<DangerLevel, string> = { 0: '安', 1: '低', 2: '中', 3: '危' };

/** A tile's highest danger level over the riichi seats, or null with none. */
export function dangerLevel(danger: SeatDanger[] | undefined, tile: string): DangerLevel | null {
  if (!danger?.length) return null;
  return Math.max(...danger.map((d) => d.tiles[tile] ?? 3)) as DangerLevel;
}

/** Each held tile's danger mark: its highest level over the riichi seats,
 * and a text naming the seats (each with its own level when there are two
 * or more). */
export function dangerMarks(danger: SeatDanger[], you: number): Record<Tile, { className: string; text: string }> {
  const out: Record<Tile, { className: string; text: string }> = {};
  for (const t of Object.keys(danger[0]?.tiles ?? {})) {
    const level = dangerLevel(danger, t) as DangerLevel;
    const each = danger
      .map((d) => (danger.length > 1 ? `${seatLabel(d.seat, you)} ${DANGER_NAMES[d.tiles[t] ?? 3]}` : seatLabel(d.seat, you)))
      .join('・');
    out[t] = { className: `tile-danger tile-danger-${level}`, text: `危険度 ${DANGER_NAMES[level]}（${each}）` };
  }
  return out;
}
