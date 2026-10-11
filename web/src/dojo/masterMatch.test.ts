// The 師範戦's conditions (masterMatch.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LESSONS } from './lessons.ts';
import { curriculumDone, masterMatchOpen, uraOpen } from './masterMatch.ts';
import { initialProgress, xpForLevel, type DojoProgress } from './progress.ts';

/** A progress with every lesson of stages 0 to 5 (初伝〜奥伝) passed, at the level given (which plays no part). */
function graduated(lv: number): DojoProgress {
  const lessons = Object.fromEntries(LESSONS.map((l) => [l.id, { assisted: true, count: 0, done: true, seen: [] }]));
  return { ...initialProgress(), xp: xpForLevel(lv), lessons };
}

test('the 師範戦 needs the curriculum passed, whatever the level', () => {
  assert.equal(masterMatchOpen(initialProgress()), false);
  assert.equal(curriculumDone(graduated(1)), true);
  assert.equal(masterMatchOpen(graduated(1)), true); // 10級: the level is 出稽古's
  // One lesson short, even at a high level.
  const p = graduated(20);
  const { [LESSONS[LESSONS.length - 1].id]: _, ...rest } = p.lessons;
  assert.equal(masterMatchOpen({ ...p, lessons: rest }), false);
});

test('the 裏道場 opens with a 師範戦 won, not with the level', () => {
  assert.equal(uraOpen(graduated(30)), false);
  const p = graduated(1);
  assert.equal(uraOpen({ ...p, masterMatch: { tries: 3, wins: 1, uraOpen: true } }), true);
});
