// The dojo's automations (autoPlay.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameState, Legal } from '../api';
import { autoMove, type AutoKey } from './autoPlay.ts';

const NO_LEGAL: Legal = { discards: [], riichi: [], tsumo: false, ron: false, skip: false, kyuushu: false, pon: false, chii: [], kan: [] };

function at(phase: 'discard' | 'call', legal: Partial<Legal>, drawn?: string, actor = 0): GameState {
  return {
    phase,
    actor,
    you: 0,
    game_over: false,
    result: null,
    legal: { ...NO_LEGAL, ...legal },
    seats: [{ seat: 0, drawn }],
  } as unknown as GameState;
}
const on = (...keys: AutoKey[]) => new Set(keys);
const ALL = on('win', 'tsumogiri', 'nocall');

test('自動和了 takes a tsumo or a ron; off, a win is left to the player', () => {
  assert.deepEqual(autoMove(at('discard', { tsumo: true, discards: ['1m'] }, '1m'), on('win')), { type: 'tsumo' });
  assert.deepEqual(autoMove(at('call', { ron: true, skip: true, pon: true }), on('win')), { type: 'ron' });
  // Without it, ツモ切り and 鳴きなし do not throw a win away.
  assert.equal(autoMove(at('discard', { tsumo: true, discards: ['1m'] }, '1m'), on('tsumogiri')), null);
  assert.equal(autoMove(at('call', { ron: true, skip: true }), on('nocall')), null);
});

test('ツモ切り discards the drawn tile only, on your own turn', () => {
  assert.deepEqual(autoMove(at('discard', { discards: ['1m', '5p'], riichi: ['5p'] }, '5p'), on('tsumogiri')), { type: 'discard', tile: '5p' });
  assert.equal(autoMove(at('discard', { discards: ['1m'] }), on('tsumogiri')), null, 'no drawn tile (after a call)');
  assert.equal(autoMove(at('discard', { discards: ['1m'] }, '5p', 2), ALL), null, 'another seat to move');
  assert.equal(autoMove(at('discard', { discards: ['1m', '5p'] }, '5p'), on('win', 'nocall')), null);
});

test('鳴きなし passes on a pon, chii or kan', () => {
  assert.deepEqual(autoMove(at('call', { skip: true, pon: true, kan: ['5p'] }), on('nocall')), { type: 'skip' });
  assert.deepEqual(autoMove(at('call', { skip: true, chii: [['3m', '4m']] }), ALL), { type: 'skip' });
  assert.equal(autoMove(at('call', { skip: true, pon: true }), on('win', 'tsumogiri')), null);
});

test('nothing moves on a finished round or with nothing on', () => {
  const ended = { ...at('discard', { tsumo: true }, '1m'), result: {} } as unknown as GameState;
  assert.equal(autoMove(ended, ALL), null);
  assert.equal(autoMove(at('discard', { tsumo: true, discards: ['1m'] }, '1m'), on()), null);
});
