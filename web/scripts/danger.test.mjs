// The danger marks on held tiles (src/danger.ts), run by `npm test` in plain
// Node, which strips the TypeScript types.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DANGER_NAMES, dangerLevel, dangerMarks } from '../src/danger.ts';
import { seatLabel } from '../src/seats.ts';

const one = [{ seat: 1, tiles: { '1m': 0, '2m': 2, '3m': 3 } }];
const two = [...one, { seat: 2, tiles: { '1m': 1, '2m': 0 } }];

test('seatLabel is relative to you', () => {
  assert.deepEqual([0, 1, 2, 3].map((s) => seatLabel(s, 0)), ['自分', '下家', '対面', '上家']);
  assert.deepEqual([0, 1, 2, 3].map((s) => seatLabel(s, 2)), ['対面', '上家', '自分', '下家']);
});

test('dangerLevel: none without riichi seats, the highest level otherwise', () => {
  assert.equal(dangerLevel(undefined, '1m'), null);
  assert.equal(dangerLevel([], '1m'), null);
  assert.equal(dangerLevel(one, '2m'), 2);
  assert.equal(dangerLevel(two, '1m'), 1);
  assert.equal(dangerLevel(two, '2m'), 2);
});

test('dangerLevel treats a tile a seat has no level for as high danger', () => {
  assert.equal(dangerLevel(two, '3m'), 3);
  assert.equal(dangerLevel(one, '9p'), 3);
});

test('dangerMarks with one riichi seat names just the seat', () => {
  const marks = dangerMarks(one, 0);
  assert.deepEqual(Object.keys(marks), ['1m', '2m', '3m']);
  assert.deepEqual(marks['1m'], { className: 'tile-danger tile-danger-0', text: `危険度 ${DANGER_NAMES[0]}（下家）` });
  assert.equal(marks['3m'].text, '危険度 危（下家）');
});

test('dangerMarks with several seats shows the highest level and each seat\'s own', () => {
  const marks = dangerMarks(two, 0);
  assert.equal(marks['1m'].className, 'tile-danger tile-danger-1');
  assert.equal(marks['1m'].text, '危険度 低（下家 安・対面 低）');
  assert.equal(marks['2m'].text, '危険度 中（下家 中・対面 安）');
  // Keys follow the first seat's tiles; labels follow you.
  assert.equal(dangerMarks(two, 1)['1m'].text, '危険度 低（自分 安・下家 低）');
});

test('dangerMarks is empty without seats', () => {
  assert.deepEqual(dangerMarks([], 0), {});
});
