// The yaku table's filter and sort (src/components/yakuFilter.ts), run by
// `npm test` in plain Node, which strips the TypeScript types.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  DEFAULT_FILTER,
  applyYakuFilter,
  isDefaultFilter,
  loadFilter,
  loadFilterOpen,
  saveFilter,
  saveFilterOpen,
} from '../src/components/yakuFilter.ts';

const row = (key, name, han, shanten, ukeire_total = 0, yakuman = false) => ({
  key, name, han, shanten, yakuman, approx: false, ukeire: [], ukeire_total,
});
const rows = [
  row('normal', '一般形', 0, 1, 20),
  row('tanyao', 'タンヤオ', 1, 1, 12),
  row('pinfu', 'ピンフ', 1, 2, 30),
  row('sanshoku', '三色同順', 2, 3, 8),
  row('chinitsu', '清一色', 6, null, 0),
  row('kokushi', '国士無双', 13, 4, 4, true),
];
const keys = (f) => applyYakuFilter(rows, { ...DEFAULT_FILTER, ...f }).keys;

function stubStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
  };
  return data;
}
afterEach(() => {
  delete globalThis.localStorage;
});

test('default filter keeps every yaku in order and never lists the normal row', () => {
  const r = applyYakuFilter(rows, DEFAULT_FILTER);
  assert.deepEqual(r.keys, ['tanyao', 'pinfu', 'sanshoku', 'chinitsu', 'kokushi']);
  assert.equal(r.total, 5);
});

test('categories: 1 han, 2 han, 3 han and over, yakuman', () => {
  assert.deepEqual(keys({ categories: ['1'] }), ['tanyao', 'pinfu']);
  assert.deepEqual(keys({ categories: ['2'] }), ['sanshoku']);
  assert.deepEqual(keys({ categories: ['3'] }), ['chinitsu']);
  assert.deepEqual(keys({ categories: ['yakuman'] }), ['kokushi']);
  assert.deepEqual(keys({ categories: [] }), []);
});

test('maxShanten drops impossible (null) rows and anything above it', () => {
  assert.deepEqual(keys({ maxShanten: 2 }), ['tanyao', 'pinfu']);
  assert.deepEqual(keys({ maxShanten: 0 }), []);
});

test('query matches name, key and reading; hiragana matches katakana', () => {
  assert.deepEqual(keys({ query: 'たんやお' }), ['tanyao']);
  assert.deepEqual(keys({ query: 'PINFU' }), ['pinfu']);
  assert.deepEqual(keys({ query: '三色' }), ['sanshoku']);
  assert.deepEqual(keys({ query: 'ちーといつ' }), []);
  assert.deepEqual(keys({ query: '  ' }), keys({}));
});

test('sort by shanten puts impossible last and breaks ties by ukeire', () => {
  assert.deepEqual(keys({ sort: 'shanten' }), ['tanyao', 'pinfu', 'sanshoku', 'kokushi', 'chinitsu']);
});

test('sort by ukeire breaks ties by shanten', () => {
  assert.deepEqual(keys({ sort: 'ukeire' }), ['pinfu', 'tanyao', 'sanshoku', 'kokushi', 'chinitsu']);
});

test('isDefaultFilter ignores blank queries and category order', () => {
  assert.equal(isDefaultFilter(DEFAULT_FILTER), true);
  assert.equal(isDefaultFilter({ ...DEFAULT_FILTER, query: ' ', categories: ['yakuman', '3', '2', '1'] }), true);
  assert.equal(isDefaultFilter({ ...DEFAULT_FILTER, query: 'x' }), false);
  assert.equal(isDefaultFilter({ ...DEFAULT_FILTER, maxShanten: 1 }), false);
  assert.equal(isDefaultFilter({ ...DEFAULT_FILTER, sort: 'ukeire' }), false);
  assert.equal(isDefaultFilter({ ...DEFAULT_FILTER, categories: ['1'] }), false);
});

test('loadFilter round-trips a saved filter and sanitises bad values', () => {
  const data = stubStorage();
  assert.deepEqual(loadFilter(), DEFAULT_FILTER);
  const f = { query: 'ピ', maxShanten: 2, categories: ['1', 'yakuman'], sort: 'ukeire' };
  saveFilter(f);
  assert.deepEqual(loadFilter(), f);
  data.set('mhj-dojo.yakuFilter', JSON.stringify({ query: 5, maxShanten: 'x', categories: ['1', 'bogus'], sort: 'zzz' }));
  assert.deepEqual(loadFilter(), { query: '', maxShanten: null, categories: ['1'], sort: 'default' });
  data.set('mhj-dojo.yakuFilter', '{broken');
  assert.deepEqual(loadFilter(), DEFAULT_FILTER);
});

test('loadFilter and the open flag survive unavailable storage', () => {
  // No localStorage at all: reads fall back, writes are swallowed.
  assert.deepEqual(loadFilter(), DEFAULT_FILTER);
  assert.equal(loadFilterOpen(), null);
  saveFilter(DEFAULT_FILTER);
  saveFilterOpen(true);
});

test('the open flag is null until first toggled', () => {
  stubStorage();
  assert.equal(loadFilterOpen(), null);
  saveFilterOpen(true);
  assert.equal(loadFilterOpen(), true);
  saveFilterOpen(false);
  assert.equal(loadFilterOpen(), false);
});
