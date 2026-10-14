// The quiz page's URL and names (quiz.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_PICKS, PICKER_ROWS, doraOf, nextSeed, parseQuizParams, quizUrl, shantenLabel, togglePick } from './quiz.ts';

test('the URL asks for a kind, a level and maybe a seed', () => {
  assert.deepEqual(parseQuizParams('?mode=quiz&kind=nanikiru&level=2&seed=42'), { kind: 'nanikiru', level: 2, seed: 42 });
  assert.deepEqual(parseQuizParams('?mode=quiz'), { kind: 'nanikiru', level: 1, seed: undefined });
  assert.deepEqual(parseQuizParams('?mode=quiz&level=3&seed=0'), { kind: 'nanikiru', level: 3, seed: 0 });
  assert.deepEqual(parseQuizParams('?mode=quiz&kind=machi&level=3&seed=7'), { kind: 'machi', level: 3, seed: 7 });
});

test('an unknown kind or level falls back to the first, and a seed the engine refuses is dropped', () => {
  assert.deepEqual(parseQuizParams('?kind=oshihiki&level=2'), { kind: 'nanikiru', level: 2, seed: undefined });
  assert.deepEqual(parseQuizParams('?kind=machi&level=4'), { kind: 'machi', level: 1, seed: undefined });
  assert.deepEqual(parseQuizParams('?kind=toString&level=constructor'), { kind: 'nanikiru', level: 1, seed: undefined });
  for (const seed of ['-1', '+3', '01', '1.5', '1e3', 'x', '', '9007199254740992']) {
    assert.equal(parseQuizParams(`?seed=${seed}`).seed, undefined, seed);
  }
  assert.equal(parseQuizParams('?seed=9007199254740991').seed, Number.MAX_SAFE_INTEGER);
});

test('a problem\'s URL keeps the page\'s other params', () => {
  const url = quizUrl('http://x/?mode=quiz&seed=1&foo=bar', { kind: 'nanikiru', level: 2, seed: 5 });
  const q = new URL(url).searchParams;
  assert.equal(q.get('mode'), 'quiz');
  assert.equal(q.get('kind'), 'nanikiru');
  assert.equal(q.get('level'), '2');
  assert.equal(q.get('seed'), '5');
  assert.equal(q.get('foo'), 'bar');
  assert.deepEqual(parseQuizParams(new URL(url).search), { kind: 'nanikiru', level: 2, seed: 5 });
});

test('次の問題 is the next seed, wrapping past the largest', () => {
  assert.equal(nextSeed(41), 42);
  assert.equal(nextSeed(Number.MAX_SAFE_INTEGER), 0);
});

test('an indicator points to the next tile of its suit', () => {
  assert.equal(doraOf('1m'), '2m');
  assert.equal(doraOf('9p'), '1p');
  assert.equal(doraOf('0s'), '6s');
  assert.equal(doraOf('4s'), '5s');
  assert.equal(doraOf('1z'), '2z');
  assert.equal(doraOf('4z'), '1z');
  assert.equal(doraOf('5z'), '6z');
  assert.equal(doraOf('7z'), '5z');
});

test('向聴 reads 聴牌 at 0', () => {
  assert.equal(shantenLabel(0), '聴牌');
  assert.equal(shantenLabel(2), '2向聴');
});

test('the picker offers every tile kind once, a row per suit', () => {
  assert.deepEqual(PICKER_ROWS.map((r) => r.length), [9, 9, 9, 7]);
  assert.equal(new Set(PICKER_ROWS.flat()).size, 34);
  assert.equal(PICKER_ROWS[3][6], '7z');
});

test('a pick toggles, kept in the picker\'s order, and stops at the most an answer holds', () => {
  let picked = togglePick([], '7z');
  picked = togglePick(picked, '3p');
  picked = togglePick(picked, '9m');
  assert.deepEqual(picked, ['9m', '3p', '7z']);
  assert.deepEqual(togglePick(picked, '3p'), ['9m', '7z']);
  const full = PICKER_ROWS[0].slice(0, MAX_PICKS);
  assert.deepEqual(togglePick(full, '1p'), full);
  assert.deepEqual(togglePick(full, '1m'), full.slice(1));
});
