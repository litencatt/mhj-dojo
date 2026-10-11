// The 師範戦 and the 裏道場 (#323): the 表道場's last trial is a 半荘戦 against
// three masters, won by finishing first; winning it opens the 裏道場, whose
// games are against the urashihan and where the cheats are sold and used.
// The record of the tries is the progress's masterMatch (settle counts them).
// Plain Node runs the tests, so imports carry the .ts extension.
import type { GameLength } from '../api.ts';
import { LESSONS, lessonStage } from './lessons.ts';
import type { DojoProgress } from './progress.ts';

/** The length of the 師範戦 and of the 裏道場's games (the urashihan was measured in 半荘戦). */
export const MASTER_MATCH_LENGTH: GameLength = 'hanchan';

/** Whether every lesson of the curriculum's stages 0 to 5 is passed (without its assists). */
export function curriculumDone(p: DojoProgress): boolean {
  return LESSONS.filter((l) => l.stage <= 5).every((l) => lessonStage(p, l.id) === 'done');
}

/**
 * Whether the 師範戦 may be tried: the curriculum passed, whatever the level (the curriculum comes
 * first; the 級位 is 出稽古's). Tries are unlimited.
 */
export function masterMatchOpen(p: DojoProgress): boolean {
  return curriculumDone(p);
}

/** Whether the 裏道場 is open: the 師範戦 has been won (it stays open). */
export function uraOpen(p: DojoProgress): boolean {
  return p.masterMatch.uraOpen;
}
