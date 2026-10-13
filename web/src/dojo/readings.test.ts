// The furigana of the curriculum's terms (readings.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { segments } from './readings.ts';
import { LESSONS } from './lessons.ts';

const read = (text: string, seen?: Set<string>) => segments(text, seen).map((s) => (s.reading ? `${s.text}(${s.reading})` : s.text)).join('');

test('a term is read on its first use only, the longest term first', () => {
  assert.equal(read('両面で聴牌する。聴牌を取る'), '両面(リャンメン)で聴牌(テンパイ)する。聴牌を取る');
  assert.equal(read('嶺上牌で和了すれば嶺上開花'), '嶺上牌(リンシャンパイ)で和了(ホーラ)すれば嶺上開花(リンシャンカイホー)');
  assert.equal(read('門前清自摸和という役。門前で'), '門前清自摸和(メンゼンチンツモホー)という役。門前(メンゼン)で');
});

test('和了 as a verb reads あが, apart from the noun', () => {
  assert.equal(read('ツモなら和了れる。和了の形'), 'ツモなら和了(あが)れる。和了(ホーラ)の形');
  assert.equal(read('チーして早く和了れる'), 'チーして早く和了(あが)れる');
});

test('texts shown together read a term once', () => {
  const seen = new Set<string>();
  assert.equal(read('両面待ちで聴牌する', seen), '両面(リャンメン)待ちで聴牌(テンパイ)する');
  assert.equal(read('両面（34 で 2・5 を待つ）', seen), '両面（34 で 2・5 を待つ）');
});

test('the text is kept whole', () => {
  for (const l of LESSONS) {
    for (const t of [l.goal, l.text]) assert.equal(segments(t).map((s) => s.text).join(''), t, l.id);
  }
});
