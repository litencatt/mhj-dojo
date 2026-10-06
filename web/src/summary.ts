import type { GameState } from './api';
import { tileName } from './tiles.ts';

const CALL_NAMES = { pon: 'ポン', chii: 'チー', kan: 'カン' } as const;

/**
 * One sentence on what the CPUs did (riichi, calls, kans) and whether you may
 * ron, shown once the replay is over; '' when nothing of note. At most 3 items
 * unless there are more riichi: riichi and the ron chance always stay, the
 * latest calls fill what is left. `label` names a seat relative to you.
 */
export function summarizeMoves(state: GameState, label: (seat: number) => string): string {
  const riichi: string[] = [];
  const calls: string[] = [];
  for (const e of state.events) {
    if (e.seat === state.you) continue;
    if (e.type === 'riichi') riichi.push(`${label(e.seat)}がリーチ`);
    else if (e.type === 'pon' || e.type === 'chii' || e.type === 'kan') calls.push(`${label(e.seat)}が${CALL_NAMES[e.type]}`);
  }
  const last = state.events[state.events.length - 1];
  const ron: string[] = [];
  if (state.legal.ron) {
    ron.push(last && last.seat !== state.you && state.last_discard ? `${label(last.seat)}の${tileName(state.last_discard)}でロンできます` : 'ロンできます');
  }
  const room = Math.max(0, 3 - riichi.length - ron.length);
  const parts = [...riichi, ...(room > 0 ? calls.slice(-room) : []), ...ron];
  return parts.length > 0 ? `${parts.join('、')}。` : '';
}
