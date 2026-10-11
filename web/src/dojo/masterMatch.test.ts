// The 師範戦's conditions (masterMatch.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LESSONS } from './lessons.ts';
import { MASTER_MATCH_LEVEL, curriculumDone, masterMatchOpen, uraOpen } from './masterMatch.ts';
import { initialProgress, xpForLevel, type DojoProgress } from './progress.ts';

/** A progress with every lesson of stages 0 to 5 passed, at the level given. */
function graduated(lv: number): DojoProgress {
  const lessons = Object.fromEntries(LESSONS.map((l) => [l.id, { assisted: true, count: 0, done: true, seen: [] }]));
  return { ...initialProgress(), xp: xpForLevel(lv), lessons };
}

test('the 師範戦 needs the curriculum passed and the level', () => {
  assert.equal(masterMatchOpen(initialProgress()), false);
  assert.equal(curriculumDone(graduated(1)), true);
  assert.equal(masterMatchOpen(graduated(MASTER_MATCH_LEVEL - 1)), false);
  assert.equal(masterMatchOpen(graduated(MASTER_MATCH_LEVEL)), true);
  // One lesson short, even at a high level.
  const p = graduated(20);
  const { [LESSONS[LESSONS.length - 1].id]: _, ...rest } = p.lessons;
  assert.equal(masterMatchOpen({ ...p, lessons: rest }), false);
});

test('the ウラ面 opens with a 師範戦 won, not with the level', () => {
  assert.equal(uraOpen(graduated(30)), false);
  const p = graduated(MASTER_MATCH_LEVEL);
  assert.equal(uraOpen({ ...p, masterMatch: { tries: 3, wins: 1, uraOpen: true } }), true);
});
