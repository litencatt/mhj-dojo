// The dojo's curriculum (lessons.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent, GameResult, SessionState, WinYaku, YakuRow } from '../apiTypes.ts';
import { CATALOG, findItem } from './catalog.ts';
import {
  LESSONS,
  bestDiscards,
  completeLesson,
  discardsAgainstRiichi,
  findLesson,
  isSuji,
  lessonAids,
  lessonStage,
  recordSuccess,
  type Lesson,
  type PracticeStep,
  type RoundRecord,
} from './lessons.ts';
import { initialProgress, parseProgress, type DojoProgress } from './progress.ts';

// ---- Builders ----

function result(over: Partial<GameResult> = {}): GameResult {
  return {
    kind: 'draw', winner: -1, from: -1, win_tile: null, yaku: [], han: 0, fu: 0, dora: 0, ura_dora: 0,
    points: { limit: '', multiplier: 1, total: 0 }, deltas: [0, 0, 0, 0], hand_deltas: [0, 0, 0, 0],
    honba_deltas: [0, 0, 0, 0], stick_deltas: [0, 0, 0, 0], honba: 0, tenpai: [false, false, false, false],
    deposit: 0, pao: [], ...over,
  };
}

const yaku = (...keys: string[]): WinYaku[] => keys.map((key) => ({ key, name: key, han: 1 }));
const ev = (seat: number, type: GameEvent['type'], tile?: string): GameEvent => ({ seat, type, tile, wall_remaining: 50 });

/** Your (seat 0) win, by tsumo or by ron from seat 1. */
function win(keys: string[], events: GameEvent[] = [], kind: 'tsumo' | 'ron' = 'tsumo'): RoundRecord {
  return { you: 0, events, result: result({ kind, winner: 0, from: kind === 'ron' ? 1 : -1, yaku: yaku(...keys) }) };
}

function row(key: string, shanten: number | null): YakuRow {
  return { key, name: key, yakuman: false, han: 0, shanten, approx: false, ukeire: [], ukeire_total: 0 };
}

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    session_id: 's', seed: 1, max_turns: 18, round_wind: '1z', seat_wind: '1z', node_id: 0, turn: 0, status: 'playing',
    hand: [], hand_groups: [], drawn: null, discards: [], dora_indicators: [], dora: [], ura_dora_indicators: [], ura_dora: [],
    wall_remaining: 100, can_tsumo: false, analysis: [row('normal', 2)], by_discard: {}, combos: [], combos_by_discard: {},
    remaining: {}, history: [], node_count: 1, tree: [], win: null, advice: null, discard_review: null, ...over,
  };
}

const step = (after: SessionState, before: SessionState | null = null, discard: string | null = null): PracticeStep => ({ before, discard, after });

function practice(id: string): Extract<Lesson, { form: 'practice' }> {
  const l = findLesson(id);
  if (!l || l.form !== 'practice') throw new Error(`no practice lesson ${id}`);
  return l;
}

function game(id: string): Extract<Lesson, { form: 'game' }> {
  const l = findLesson(id);
  if (!l || l.form !== 'game') throw new Error(`no game lesson ${id}`);
  return l;
}

/** A progress with the lessons given done. */
function passed(ids: string[], over: Partial<DojoProgress> = {}): DojoProgress {
  const lessons = Object.fromEntries(ids.map((id) => [id, { assisted: true, count: 0, done: true }]));
  return { ...initialProgress(), ...over, lessons };
}

// ---- The catalog of lessons ----

test('the lessons have unique ids, stages 0 to 5, prerequisites that come earlier and rewards from the shop', () => {
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(LESSONS.map((l) => l.stage))], [0, 1, 2, 3, 4, 5]);
  LESSONS.forEach((l, i) => {
    for (const r of l.requires) assert.ok(ids.indexOf(r) >= 0 && ids.indexOf(r) < i, `${l.id} requires ${r}`);
    if (l.reward.item !== undefined) assert.ok(findItem(l.reward.item), `${l.id}: ${l.reward.item}`);
    for (const a of l.assists) assert.equal(findItem(a)?.kind, 'assist', `${l.id}: ${a}`);
    assert.ok(l.title && l.text, l.id);
  });
});

test('stage 5 teaches the hand yaku by how often they come, each granting its own', () => {
  const five = LESSONS.filter((l) => l.stage === 5);
  assert.deepEqual(five.map((l) => l.reward.item), ['pinfu', 'honitsu', 'iipeikou', 'sanshoku', 'chiitoitsu', 'toitoi', 'ittsu']);
  for (const l of five) assert.deepEqual(l.tempYaku, [l.reward.item]);
  assert.ok(findLesson('pinfu-win')!.requires.includes('ryanmen-tenpai')); // 平和 rests on the two-sided wait of stage 1
  assert.ok(CATALOG.some((it) => it.id === 'pinfu')); // and is sold in the shop too
});

// ---- Practice-mode lessons ----

test('shape-win: a tsumo win in practice mode', () => {
  const j = practice('shape-win').judge;
  assert.equal(j(step(session({ status: 'tsumo', win: { tiles: [], yaku: [], dora: 0, han_total: 0 } }))), true);
  assert.equal(j(step(session({ status: 'exhausted' }))), false);
  assert.equal(j(step(session({ can_tsumo: true }))), false); // a win offered is not a win made
});

test('ryanmen-tenpai: tenpai on a two-sided wait', () => {
  const j = practice('ryanmen-tenpai').judge;
  const groups = (type: 'ryanmen' | 'kanchan') => [{ type: 'seq' as const, tiles: [0, 1, 2] }, { type, tiles: [3, 4] }];
  assert.equal(j(step(session({ analysis: [row('normal', 0)], hand_groups: groups('ryanmen') }))), true);
  assert.equal(j(step(session({ analysis: [row('normal', 0)], hand_groups: groups('kanchan') }))), false);
  assert.equal(j(step(session({ analysis: [row('normal', 1)], hand_groups: groups('ryanmen') }))), false);
});

test('max-ukeire: the discard keeps the shanten and the most ukeire', () => {
  const j = practice('max-ukeire').judge;
  const by = (shanten: number, ukeire_total: number) => [{ key: 'normal', shanten, approx: false, ukeire: [], ukeire_total }];
  const before = session({ by_discard: { '1m': by(1, 20), '0p': by(1, 28), '5s': by(1, 28), '9s': by(2, 40) } });
  assert.deepEqual(bestDiscards(before).sort(), ['5p', '5s']);
  assert.equal(j(step(session(), before, '0p')), true); // the red five is a five
  assert.equal(j(step(session(), before, '5s')), true);
  assert.equal(j(step(session(), before, '1m')), false);
  assert.equal(j(step(session(), before, '9s')), false); // more ukeire, but a step back
  assert.equal(j(step(session())), false); // the start: no discard yet
});

// ---- Game lessons ----

test('furiten: a ron win (the engine offers no ron on a furiten wait)', () => {
  const j = game('furiten').judge;
  assert.equal(j(win(['riichi'], [], 'ron')), true);
  assert.equal(j(win(['riichi'], [], 'tsumo')), false);
  assert.equal(j({ you: 0, events: [], result: result({ kind: 'ron', winner: 2, from: 0 }) }), false);
});

test('stage 2: a win with 立直, 門前清自摸和 or 断么九', () => {
  for (const [id, key] of [['riichi-win', 'riichi'], ['tsumo-win', 'tsumo'], ['tanyao-win', 'tanyao']]) {
    const j = game(id).judge;
    assert.equal(j(win([key, 'dora'])), true, id);
    assert.equal(j(win(['haku'])), false, id);
    assert.equal(j({ you: 0, events: [], result: result({ kind: 'tsumo', winner: 1, yaku: yaku(key) }) }), false, `${id}: another seat's win`);
  }
});

test('yakuhai-pon: a pon of yours and a win with a 役牌', () => {
  const j = game('yakuhai-pon').judge;
  assert.equal(j(win(['chun'], [ev(0, 'pon', '7z')])), true);
  assert.equal(j(win(['ton'], [ev(0, 'pon', '1z')])), true);
  assert.equal(j(win(['chun'])), false); // no call: a concealed triplet
  assert.equal(j(win(['tanyao'], [ev(0, 'pon', '5m')])), false);
  assert.equal(j(win(['chun'], [ev(2, 'pon', '7z')])), false); // another seat's pon
});

test('kuitan: a chii and a win with 断么九', () => {
  const j = game('kuitan').judge;
  assert.equal(j(win(['tanyao'], [ev(0, 'chii', '4m')])), true);
  assert.equal(j(win(['tanyao'])), false);
  assert.equal(j(win(['haku'], [ev(0, 'chii', '4m')])), false);
});

test('kan-win: a kan of yours in a round you win', () => {
  const j = game('kan-win').judge;
  assert.equal(j(win(['rinshan'], [ev(0, 'kan', '2p')])), true);
  assert.equal(j(win(['riichi'], [ev(0, 'kan', '2p')])), true);
  assert.equal(j(win(['riichi'])), false);
  assert.equal(j({ you: 0, events: [ev(0, 'kan', '2p')], result: result() }), false);
});

// Seat 1 declares riichi on 3z having discarded 4m and 9p; you (seat 0) discard after it.
const riichiThen = (...yours: string[]) => [ev(1, 'discard', '4m'), ev(1, 'discard', '9p'), ev(0, 'discard', '1z'), ev(1, 'riichi', '3z'), ...yours.map((t) => ev(0, 'discard', t))];
const drawn = (events: GameEvent[]): RoundRecord => ({ you: 0, events, result: result() });

test('suji and the discards against a riichi', () => {
  assert.equal(isSuji('1m', ['4m']), true);
  assert.equal(isSuji('7m', ['4m']), true);
  assert.equal(isSuji('4m', ['1m']), false); // a middle tile needs both sides
  assert.equal(isSuji('4m', ['1m', '7m']), true);
  assert.equal(isSuji('1z', ['4z']), false);
  // Your discard before the riichi does not count; the riichi tile joins the river.
  assert.deepEqual(discardsAgainstRiichi(drawn(riichiThen('0m'))), [{ tile: '5m', rivers: [['4m', '9p', '3z']] }]);
});

test('genbutsu: only the riichi seat\'s own discards after its riichi, no deal-in', () => {
  const j = game('genbutsu').judge;
  assert.equal(j(drawn(riichiThen('4m', '3z'))), true);
  assert.equal(j(drawn(riichiThen('4m', '1m'))), false); // 1m is suji, not genbutsu
  assert.equal(j(drawn([ev(0, 'discard', '4m')])), false); // no riichi
  assert.equal(j({ you: 0, events: riichiThen('4m'), result: result({ kind: 'ron', winner: 1, from: 0 }) }), false);
});

test('suji: suji or genbutsu after the riichi, a suji among them, no deal-in', () => {
  const j = game('suji').judge;
  assert.equal(j(drawn(riichiThen('1m', '4m'))), true);
  assert.equal(j(drawn(riichiThen('4m', '9p'))), false); // genbutsu only
  assert.equal(j(drawn(riichiThen('1m', '5s'))), false); // 5s is neither
});

test('fold: a round with another seat\'s riichi ends without your deal-in', () => {
  const j = game('fold').judge;
  assert.equal(j(drawn(riichiThen('5s'))), true);
  assert.equal(j({ you: 0, events: riichiThen('5s'), result: result({ kind: 'ron', winner: 1, from: 0 }) }), false);
  assert.equal(j({ you: 0, events: riichiThen('5s'), result: result({ kind: 'ron', winner: 1, from: 2 }) }), true); // another seat dealt in
  assert.equal(j(drawn([ev(0, 'riichi', '5s')])), false); // your own riichi
});

test('stage 5: a win with the lesson\'s yaku', () => {
  for (const l of LESSONS.filter((x) => x.stage === 5)) {
    const j = game(l.id).judge;
    const key = l.reward.item!;
    assert.equal(j(win(['riichi', key])), true, l.id);
    assert.equal(j(win(['riichi'])), false, l.id);
  }
});

// ---- Progress ----

test('a lesson is locked until its prerequisites are passed, then assisted, unassisted and done', () => {
  const p = initialProgress();
  assert.equal(lessonStage(p, 'shape-win'), 'unassisted'); // no assists: one stage
  assert.equal(lessonStage(p, 'ryanmen-tenpai'), 'locked');
  assert.equal(lessonStage(p, 'nothing'), 'locked');
  const q = passed(['shape-win']);
  assert.equal(lessonStage(q, 'ryanmen-tenpai'), 'assisted');
  assert.deepEqual(lessonAids(q, 'ryanmen-tenpai'), { yaku: [], assists: ['assist:ukeire'] });
  const r = recordSuccess(q, 'ryanmen-tenpai');
  assert.deepEqual([r.passed, r.completed], [true, false]);
  assert.equal(lessonStage(r.progress, 'ryanmen-tenpai'), 'unassisted');
  assert.deepEqual(lessonAids(r.progress, 'ryanmen-tenpai'), { yaku: [], assists: [] });
  const s = recordSuccess(r.progress, 'ryanmen-tenpai');
  assert.deepEqual([s.passed, s.completed], [true, true]);
  assert.equal(lessonStage(s.progress, 'ryanmen-tenpai'), 'done');
  assert.equal(s.progress.coins, 20);
});

test('a lesson of N successes counts them in each stage', () => {
  let p = passed(['shape-win']);
  for (let i = 1; i < 5; i++) {
    const r = recordSuccess(p, 'max-ukeire');
    assert.equal(r.passed, false);
    p = r.progress;
  }
  assert.equal(p.lessons['max-ukeire'].count, 4);
  p = recordSuccess(p, 'max-ukeire').progress;
  assert.deepEqual(p.lessons['max-ukeire'], { assisted: true, count: 0, done: false });
});

test('a locked or done lesson records nothing; a failure is simply not recorded', () => {
  const p = initialProgress();
  assert.equal(recordSuccess(p, 'ryanmen-tenpai').progress, p);
  const done = passed(['shape-win']);
  assert.equal(recordSuccess(done, 'shape-win').progress, done);
});

test('the temporary yaku of a lesson are those it teaches', () => {
  assert.deepEqual(lessonAids(passed(['riichi-win', 'tanyao-win']), 'yakuhai-pon').yaku, ['haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei']);
  assert.deepEqual(lessonAids(initialProgress(), 'kan-win').yaku, ['rinshan']);
});

test('completeLesson grants the reward once', () => {
  const p = initialProgress();
  const a = completeLesson(p, 'pinfu-win');
  assert.ok(a.ownedYaku.includes('pinfu'));
  assert.ok(a.ownedItems.includes('pinfu'));
  assert.equal(a.coins, 0);
  assert.equal(completeLesson(a, 'pinfu-win'), a); // paid once
  const y = completeLesson(p, 'yakuhai-pon');
  for (const k of ['haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei']) assert.ok(y.ownedYaku.includes(k), k);
  assert.ok(y.ownedItems.includes('yakuhai'));
  const d = completeLesson(p, 'fold');
  assert.ok(d.ownedItems.includes('assist:danger'));
  assert.equal(completeLesson(p, 'shape-win').coins, 20);
  assert.equal(completeLesson(p, 'nothing'), p);
});

test('completeLesson pays a yaku owned already in coins instead', () => {
  // 平和 bought in the shop, or owned from before it left the initial yaku.
  const bought = completeLesson({ ...initialProgress(), ownedItems: ['pinfu'], ownedYaku: ['riichi', 'tsumo', 'tanyao', 'pinfu'] }, 'pinfu-win');
  assert.equal(bought.coins, findItem('pinfu')!.price);
  assert.deepEqual(bought.ownedItems, ['pinfu']);
  const old = completeLesson({ ...initialProgress(), ownedYaku: ['riichi', 'tsumo', 'tanyao', 'pinfu'] }, 'pinfu-win');
  assert.equal(old.coins, findItem('pinfu')!.price);
  assert.equal(old.lessons['pinfu-win'].done, true);
});

test('lessons are kept by a save and read as {} from data before them', () => {
  const p = completeLesson(initialProgress(), 'shape-win');
  assert.deepEqual(parseProgress(JSON.stringify(p)), p);
  const { lessons: _, ...old } = initialProgress();
  assert.deepEqual(parseProgress(JSON.stringify(old))?.lessons, {});
  assert.equal(parseProgress(JSON.stringify({ ...p, lessons: [] })), null);
  assert.equal(parseProgress(JSON.stringify({ ...p, lessons: { 'shape-win': { assisted: true, count: -1, done: true } } })), null);
  assert.equal(parseProgress(JSON.stringify({ ...p, lessons: { 'shape-win': { done: true } } })), null);
});
