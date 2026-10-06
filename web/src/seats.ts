const RELATIVE = ['自分', '下家', '対面', '上家'];

/** 自分 / 下家 / 対面 / 上家 for a seat, relative to you. */
export function seatLabel(seat: number, you: number): string {
  return RELATIVE[(seat - you + 4) % 4];
}
