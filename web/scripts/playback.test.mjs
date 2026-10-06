// The CPU-move playback (src/playback.ts), run by `npm test` in plain Node,
// which strips the TypeScript types.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  PLAYBACK_SPEEDS,
  buildPlayback,
  loadPlaybackSpeed,
  playbackFrame,
  playbackHighlight,
  playbackState,
  playbackStepMs,
  savePlaybackSpeed,
} from '../src/playback.ts';

const rt = (tile, extra = {}) => ({ tile, riichi: false, called: false, ...extra });
const mkSeat = (seat, extra = {}) => ({
  seat, wind: `${seat + 1}z`, points: 25000, riichi: false, river: [], melds: [], hand_count: 13, ...extra,
});
const ev = (seat, type, extra = {}) => ({ seat, type, wall_remaining: 50, ...extra });
const standings = () => [0, 1, 2, 3].map((seat) => ({ seat, rank: 0, points: 0, score: 0 }));

// Seat 1 discards 5p, seat 2 pons it, then seat 2 discards 9m.
function ponScenario() {
  const finalSeats = [
    mkSeat(0, { hand: ['1m'] }),
    mkSeat(1, { river: [rt('5p', { called: true })] }),
    mkSeat(2, {
      river: [rt('9m')],
      melds: [{ type: 'pon', tiles: ['5p', '5p', '5p'], from: 1, added: false }],
    }),
    mkSeat(3),
  ];
  const events = [
    ev(1, 'discard', { tile: '5p', wall_remaining: 40 }),
    ev(2, 'pon', { tile: '5p', tiles: ['5p', '5p'], wall_remaining: 40 }),
    ev(2, 'discard', { tile: '9m', wall_remaining: 39 }),
  ];
  return { finalSeats, events, build: buildPlayback(finalSeats, events) };
}

test('buildPlayback undoes the events down to an empty base without touching the input', () => {
  const { finalSeats, build } = ponScenario();
  assert.deepEqual(build.base[1].river, []);
  assert.deepEqual(build.base[2].river, []);
  assert.deepEqual(build.base[2].melds, []);
  assert.equal(finalSeats[2].melds.length, 1);
  assert.equal(finalSeats[1].river[0].called, true);
  assert.equal(build.opsPerEvent.length, 3);
});

test('playbackFrame replays frame by frame and ends exactly on the final seats', () => {
  const { finalSeats, build } = ponScenario();
  assert.deepEqual(playbackFrame(build, 0), build.base);
  const f1 = playbackFrame(build, 1);
  assert.deepEqual(f1[1].river, [rt('5p')]);
  assert.equal(f1[2].melds.length, 0);
  const f2 = playbackFrame(build, 2);
  assert.equal(f2[1].river[0].called, true);
  assert.equal(f2[2].melds.length, 1);
  assert.equal(f2[2].river.length, 0);
  assert.deepEqual(playbackFrame(build, 3), finalSeats);
  // A step from a longer previous build is clamped, and frames don't poison each other.
  assert.deepEqual(playbackFrame(build, 99), finalSeats);
  assert.equal(playbackFrame(build, 1)[1].river[0].called, false);
});

test('riichi gives the discard back and restores the final riichi flag on replay', () => {
  const finalSeats = [mkSeat(0), mkSeat(1, { riichi: true, river: [rt('3s', { riichi: true })] }), mkSeat(2), mkSeat(3)];
  const build = buildPlayback(finalSeats, [ev(1, 'riichi', { tile: '3s' })]);
  assert.equal(build.base[1].riichi, false);
  assert.deepEqual(build.base[1].river, []);
  assert.deepEqual(playbackFrame(build, 1), finalSeats);
  // A riichi still awaiting the human's call stays false in the final seats.
  const pending = [mkSeat(0), mkSeat(1, { riichi: false, river: [rt('3s', { riichi: true })] }), mkSeat(2), mkSeat(3)];
  const b2 = buildPlayback(pending, [ev(1, 'riichi', { tile: '3s' })]);
  assert.equal(playbackFrame(b2, 1)[1].riichi, false);
});

test('an added kan is revealed by growing the pon in place', () => {
  const kan = { type: 'kan', tiles: ['7s', '7s', '7s', '7s'], from: 3, added: true };
  const finalSeats = [mkSeat(0, { melds: [kan] }), mkSeat(1), mkSeat(2), mkSeat(3)];
  const build = buildPlayback(finalSeats, [ev(0, 'kan', { tile: '7s' })]);
  assert.equal(build.base[0].melds[0].type, 'pon');
  assert.equal(build.base[0].melds[0].tiles.length, 3);
  assert.deepEqual(playbackFrame(build, 1), finalSeats);
  assert.deepEqual(playbackHighlight(build, finalSeats, 1), { seat: 0, kind: 'meld', index: 0 });
});

test('a robbed added kan changes nothing; an ankan is a brand-new meld', () => {
  const pon = { type: 'pon', tiles: ['7s', '7s', '7s'], from: 3, added: false };
  const robbed = buildPlayback([mkSeat(0, { melds: [pon] }), mkSeat(1), mkSeat(2), mkSeat(3)], [ev(0, 'kan', { tile: '7s' })]);
  assert.deepEqual(robbed.opsPerEvent[0], []);
  assert.equal(robbed.base[0].melds.length, 1);
  const ankan = { type: 'ankan', tiles: ['2m', '2m', '2m', '2m'], from: -1, added: false };
  const b = buildPlayback([mkSeat(0, { melds: [ankan] }), mkSeat(1), mkSeat(2), mkSeat(3)], [ev(0, 'kan', { tile: '2m' })]);
  assert.equal(b.base[0].melds.length, 0);
});

test('playbackHighlight points at what just landed', () => {
  const { build } = ponScenario();
  const frame = (n) => playbackFrame(build, n);
  assert.equal(playbackHighlight(build, frame(0), 0), null);
  assert.equal(playbackHighlight(build, frame(3), 4), null);
  assert.deepEqual(playbackHighlight(build, frame(1), 1), { seat: 1, kind: 'river', index: 0 });
  assert.deepEqual(playbackHighlight(build, frame(2), 2), { seat: 2, kind: 'meld', index: 0 });
  assert.deepEqual(playbackHighlight(build, frame(3), 3), { seat: 2, kind: 'river', index: 0 });
});

test('playbackState: at the end it is the state itself; before, the table is rewound', () => {
  const { finalSeats, events } = ponScenario();
  finalSeats[0].points = 26000;
  finalSeats[1].points = 24000;
  finalSeats[1].riichi = true;
  finalSeats[1].river[0].riichi = true;
  const riichiEvents = [ev(1, 'riichi', { tile: '5p', wall_remaining: 41 }), ...events.slice(1)];
  const b = buildPlayback(finalSeats, riichiEvents);
  const state = {
    you: 0,
    first_dealer: 0,
    seats: finalSeats,
    events: riichiEvents,
    events_wall_remaining: 42,
    wall_remaining: 39,
    deposit: 1000,
    dora_indicators: ['1m', '2m'],
    dora: ['2m', '3m'],
    ura_dora_indicators: ['4m'],
    ura_dora: ['5m'],
    standings: standings(),
    result: null,
  };
  assert.equal(playbackState(state, b, 3), state);
  const s0 = playbackState(state, b, 0);
  assert.equal(s0.wall_remaining, 42);
  assert.equal(s0.deposit, 0); // the accepted riichi's stick comes back
  assert.equal(s0.seats[1].points, 25000);
  assert.equal(s0.events.length, 0);
  assert.deepEqual(s0.ura_dora_indicators, []);
  assert.equal(s0.seats[1].hand_count, 13);
  assert.equal(s0.seats[2].hand_count, 13);
  assert.deepEqual(s0.seats[0].hand, ['1m']); // yours stays
  assert.equal('hand' in s0.seats[3], false);
  const s2 = playbackState(state, b, 2);
  assert.equal(s2.wall_remaining, 40); // the second event's
  assert.equal(s2.seats[2].hand_count, 10 + 1); // 13 - 3 for the pon, +1 just called
  assert.equal(s2.deposit, 1000);
  assert.deepEqual(s2.standings.map((x) => x.rank), [1, 4, 2, 3]);
  assert.equal(finalSeats[1].points, 24000); // input untouched
});

test('playbackState hides kan dora not yet turned and holds back a round result', () => {
  const ankan = { type: 'ankan', tiles: ['2m', '2m', '2m', '2m'], from: -1, added: false };
  const finalSeats = [mkSeat(0, { points: 28000, river: [rt('1m')] }), mkSeat(1, { melds: [ankan], points: 22000 }), mkSeat(2), mkSeat(3)];
  const events = [ev(0, 'discard', { tile: '1m' }), ev(1, 'kan', { tile: '2m', new_dora_indicators: ['9p'] })];
  const build = buildPlayback(finalSeats, events);
  const state = {
    you: 0, first_dealer: 0, seats: finalSeats, events, events_wall_remaining: 60, wall_remaining: 50, deposit: 0,
    dora_indicators: ['1m', '9p'], dora: ['2m', '1p'], ura_dora_indicators: [], ura_dora: [],
    standings: standings(),
    result: { winner: 0, deltas: [3000, -3000, 0, 0], stick_deltas: [0, 0, 0, 0] },
  };
  const s1 = playbackState(state, build, 1);
  assert.deepEqual(s1.dora_indicators, ['1m']);
  assert.deepEqual(s1.dora, ['2m']);
  assert.equal(s1.seats[0].points, 25000);
  assert.equal(s1.seats[1].points, 25000);
});

afterEach(() => {
  delete globalThis.localStorage;
});

test('playback speed: default, saved, invalid and unavailable storage', () => {
  assert.equal(loadPlaybackSpeed(), 'normal'); // no storage
  savePlaybackSpeed('fast'); // no storage: swallowed
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  assert.equal(loadPlaybackSpeed(), 'normal');
  savePlaybackSpeed('fast');
  assert.equal(loadPlaybackSpeed(), 'fast');
  assert.equal(playbackStepMs(), PLAYBACK_SPEEDS.fast.ms);
  savePlaybackSpeed('none');
  assert.equal(playbackStepMs(), 0);
  data.set('mhj-dojo.playback-speed.v1', 'toString');
  assert.equal(loadPlaybackSpeed(), 'normal');
});
