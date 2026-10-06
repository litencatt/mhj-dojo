// summarizeMoves (src/summary.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeMoves } from '../src/summary.ts';

const label = (seat) => ['自分', '下家', '対面', '上家'][seat];
const ev = (seat, type) => ({ seat, type, wall_remaining: 50 });
const state = (events, extra = {}) => ({ you: 0, events, legal: { ron: false }, last_discard: null, ...extra });

test('nothing of note is empty', () => {
  assert.equal(summarizeMoves(state([ev(1, 'discard'), ev(0, 'riichi')]), label), '');
});

test('a riichi and a call', () => {
  assert.equal(summarizeMoves(state([ev(1, 'riichi'), ev(2, 'pon')]), label), '下家がリーチ、対面がポン。');
});

test('the ron chance names the discarder and the tile, a red five by its name', () => {
  const s = state([ev(3, 'discard')], { legal: { ron: true }, last_discard: '0m' });
  assert.equal(summarizeMoves(s, label), '上家の赤5萬でロンできます。');
});

test('calls are trimmed to the latest when riichi and ron take room', () => {
  const s = state([ev(1, 'pon'), ev(2, 'chii'), ev(3, 'kan'), ev(1, 'riichi')], { legal: { ron: true } });
  assert.equal(summarizeMoves(s, label), '下家がリーチ、上家がカン、ロンできます。');
});

test('no room left for calls drops them all, not keeps them all', () => {
  const s = state([ev(1, 'pon'), ev(1, 'riichi'), ev(2, 'riichi'), ev(3, 'riichi')], { legal: { ron: true } });
  assert.equal(summarizeMoves(s, label), '下家がリーチ、対面がリーチ、上家がリーチ、ロンできます。');
});

test('every riichi stays', () => {
  const s = state([ev(1, 'riichi'), ev(2, 'riichi'), ev(3, 'riichi'), ev(1, 'pon')]);
  assert.equal(summarizeMoves(s, label), '下家がリーチ、対面がリーチ、上家がリーチ。');
});
