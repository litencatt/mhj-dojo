// The dojo's curriculum (lessons.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent, GameResult, SessionState, WinYaku, YakuRow } from '../apiTypes.ts';
import { CATALOG, findItem } from './catalog.ts';
import {
  LESSONS,
  bestDiscards,
  discardsAgainstRiichi,
  findLesson,
  gameRoundKey,
  isSuji,
  lessonAids,
  lessonStage,
  practiceKey,
  recordSuccess,
  tenpaiDiscards,
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

const by = (shanten: number, ukeire_total: number, ukeire: string[] = []) => [{ key: 'normal', shanten, approx: false, ukeire, ukeire_total }];
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
  const lessons = Object.fromEntries(ids.map((id) => [id, { assisted: true, count: 0, done: true, seen: [] }]));
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

// The examples' tiles: compact notation, at most 4 of a kind.
function counts(notation: string): Map<string, number> {
  const m = new Map<string, number>();
  let digits = '';
  for (const ch of notation) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else {
      assert.ok('mpsz'.includes(ch), `${notation}: suit ${ch}`);
      for (const d of digits) {
        assert.ok(ch === 'z' ? d >= '1' && d <= '7' : d >= '1' && d <= '9', `${notation}: ${d}${ch}`);
        m.set(d + ch, (m.get(d + ch) ?? 0) + 1);
      }
      digits = '';
    }
  }
  assert.equal(digits, '', `${notation}: digits without a suit`);
  for (const [t, n] of m) assert.ok(n <= 4, `${notation}: ${n} of ${t}`);
  return m;
}

/** Whether 14 tiles are four groups and a pair, or seven distinct pairs. */
function complete(m: Map<string, number>): boolean {
  const c = new Map(m);
  if ([...c.values()].length === 7 && [...c.values()].every((n) => n === 2)) return true;
  const groups = (left: Map<string, number>): boolean => {
    const t = [...left.keys()].sort().find((k) => (left.get(k) ?? 0) > 0);
    if (t === undefined) return true;
    const take = (ks: string[]) => {
      const next = new Map(left);
      for (const k of ks) {
        if ((next.get(k) ?? 0) === 0) return false;
        next.set(k, next.get(k)! - 1);
      }
      return groups(next);
    };
    const [d, suit] = [Number(t[0]), t[1]];
    return take([t, t, t]) || (suit !== 'z' && d <= 7 && take([t, `${d + 1}${suit}`, `${d + 2}${suit}`]));
  };
  return [...c.keys()].some((pair) => {
    if ((c.get(pair) ?? 0) < 2) return false;
    const rest = new Map(c);
    rest.set(pair, rest.get(pair)! - 2);
    return groups(rest);
  });
}

test('every example is a winning hand of 14 tiles, or a tenpai of 13 waiting on two kinds', () => {
  const kinds = ['m', 'p', 's'].flatMap((s) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${n}${s}`)).concat([1, 2, 3, 4, 5, 6, 7].map((n) => `${n}z`));
  for (const l of LESSONS) {
    if (l.example === undefined) continue;
    const m = counts(l.example);
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    if (l.id === 'ryanmen-tenpai') {
      assert.equal(n, 13, l.id);
      const waits = kinds.filter((k) => (m.get(k) ?? 0) < 4 && complete(new Map(m).set(k, (m.get(k) ?? 0) + 1)));
      assert.deepEqual(waits, ['2m', '5m'], l.id);
    } else {
      assert.equal(n, 14, l.id);
      assert.ok(complete(m), `${l.id}: ${l.example}`);
    }
  }
  assert.equal(complete(counts('123m456p789s11z23m')), false);
});

// ---- Practice-mode lessons ----

test('shape-win: a tsumo win in practice mode', () => {
  const j = practice('shape-win').judge;
  assert.equal(j(step(session({ status: 'tsumo', win: { tiles: [], yaku: [], dora: 0, han_total: 0 } }))), true);
  assert.equal(j(step(session({ status: 'exhausted' }))), false);
  assert.equal(j(step(session({ can_tsumo: true }))), null); // a win offered is not a win made; a discard is not judged
});

test('ryanmen-tenpai: tenpai on a two-sided wait, reached by a discard', () => {
  const j = practice('ryanmen-tenpai').judge;
  const groups = (type: 'ryanmen' | 'kanchan') => [{ type: 'seq' as const, tiles: [0, 1, 2] }, { type, tiles: [3, 4] }];
  const at = (shanten: number, type: 'ryanmen' | 'kanchan') => session({ analysis: [row('normal', shanten)], hand_groups: groups(type) });
  assert.equal(j(step(at(0, 'ryanmen'), session(), '9s')), true);
  assert.equal(j(step(at(0, 'kanchan'), session(), '9s')), false);
  assert.equal(j(step(at(1, 'ryanmen'), session(), '9s')), null); // not tenpai: not judged
  assert.equal(j(step(at(0, 'ryanmen'))), null); // dealt at tenpai: not made
});

test('max-ukeire: the discard keeps the shanten and the most ukeire', () => {
  const j = practice('max-ukeire').judge;
  const before = session({ by_discard: { '1m': by(1, 20), '0p': by(1, 28), '5s': by(1, 28), '9s': by(2, 40) } });
  assert.deepEqual(bestDiscards(before).sort(), ['5p', '5s']);
  assert.equal(j(step(session(), before, '0p')), true); // the red five is a five
  assert.equal(j(step(session(), before, '5s')), true);
  assert.equal(j(step(session(), before, '1m')), false);
  assert.equal(j(step(session(), before, '9s')), false); // more ukeire, but a step back
  assert.equal(j(step(session())), null); // the start: no discard yet
});

test('furiten: of the discards taking tenpai, one whose waits are not in your river', () => {
  const j = practice('furiten').judge;
  // 1m already discarded. Cutting 4m waits on 1m-4m (furiten: 1m, and the 4m cut); cutting 9p waits on 2m-5m.
  const before = session({ discards: ['1m', '7z'], by_discard: { '4m': by(0, 8, ['1m', '4m']), '9p': by(0, 8, ['2m', '5m']), '1s': by(1, 30) } });
  assert.deepEqual(tenpaiDiscards(before), [{ tile: '4m', furiten: true }, { tile: '9p', furiten: false }]);
  assert.equal(j(step(session(), before, '9p')), true);
  assert.equal(j(step(session(), before, '4m')), false); // the furiten wait: failed
  assert.equal(j(step(session(), before, '1s')), false); // no tenpai taken
  // The discard made counts too: cutting 3s waits on 3s-6s, furiten on its own discard.
  assert.deepEqual(tenpaiDiscards(session({ by_discard: { '3s': by(0, 8, ['3s', '6s']) } })), [{ tile: '3s', furiten: true }]);
  // Not judged where no choice between the two was to be made.
  const noChoice = session({ discards: ['1m'], by_discard: { '9p': by(0, 8, ['2m', '5m']), '1s': by(1, 30) } });
  assert.equal(j(step(session(), noChoice, '9p')), null);
  assert.equal(j(step(session())), null);
});

// ---- Game lessons ----

test('stage 2: a win with 立直 (or ダブル立直), 門前清自摸和 or 断么九', () => {
  for (const [id, key] of [['riichi-win', 'riichi'], ['tsumo-win', 'tsumo'], ['tanyao-win', 'tanyao']]) {
    const j = game(id).judge;
    assert.equal(j(win([key, 'dora'])), true, id);
    assert.equal(j(win(['haku'])), false, id);
    assert.equal(j({ you: 0, events: [], result: result({ kind: 'tsumo', winner: 1, yaku: yaku(key) }) }), false, `${id}: another seat's win`);
  }
  assert.equal(game('riichi-win').judge(win(['double_riichi'])), true);
});

test('yakuhai-pon: a pon (or kan) of an honor of yours, and a win with its 役牌', () => {
  const j = game('yakuhai-pon').judge;
  assert.equal(j(win(['chun'], [ev(0, 'pon', '7z')])), true);
  assert.equal(j(win(['ton'], [ev(0, 'pon', '1z')])), true);
  assert.equal(j(win(['haku'], [ev(0, 'kan', '5z')])), true);
  assert.equal(j(win(['chun'])), false); // no call: a concealed triplet
  assert.equal(j(win(['chun'], [ev(0, 'pon', '5m')])), false); // the pon was not the 役牌
  assert.equal(j(win(['tanyao'], [ev(0, 'pon', '7z')])), false); // a 中 pon that scored nothing (a guest wind, say)
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

test('suji and the discards against a riichi, with the tiles passed after it', () => {
  assert.equal(isSuji('1m', ['4m']), true);
  assert.equal(isSuji('7m', ['4m']), true);
  assert.equal(isSuji('4m', ['1m']), false); // a middle tile needs both sides
  assert.equal(isSuji('4m', ['1m', '7m']), true);
  assert.equal(isSuji('1z', ['4z']), false);
  // Your discard before the riichi does not count; the riichi tile is in its river.
  assert.deepEqual(discardsAgainstRiichi(drawn(riichiThen('0m'))), [{ tile: '5m', safe: [['4m', '9p', '3z']] }]);
  // Seat 2 discards 8s after the riichi and seat 1 does not ron it: 8s is safe from then on, as your 5m is.
  const passing = [...riichiThen(), ev(2, 'discard', '8s'), ev(0, 'discard', '5m'), ev(0, 'discard', '8s')];
  assert.deepEqual(discardsAgainstRiichi(drawn(passing)), [
    { tile: '5m', safe: [['4m', '9p', '3z', '8s']] },
    { tile: '8s', safe: [['4m', '9p', '3z', '8s', '5m']] },
  ]);
  // Once you are in riichi yourself, your discards are not choices.
  assert.deepEqual(discardsAgainstRiichi(drawn([...riichiThen('4m'), ev(0, 'riichi', '9p'), ev(0, 'discard', '5s')])), [
    { tile: '4m', safe: [['4m', '9p', '3z']] },
    { tile: '9p', safe: [['4m', '9p', '3z', '4m']] },
  ]);
  assert.deepEqual(discardsAgainstRiichi(drawn([ev(0, 'riichi', '9p'), ev(1, 'riichi', '3z'), ev(0, 'discard', '5s')])), []);
});

test("genbutsu: only safe tiles after the riichi, no deal-in; not judged without a riichi", () => {
  const j = game('genbutsu').judge;
  assert.equal(j(drawn(riichiThen('4m', '3z'))), true);
  assert.equal(j(drawn([...riichiThen(), ev(2, 'discard', '8s'), ev(0, 'discard', '8s')])), true); // passed after the riichi
  assert.equal(j(drawn(riichiThen('4m', '1m'))), false); // 1m is suji, not genbutsu
  assert.equal(j({ you: 0, events: riichiThen('4m'), result: result({ kind: 'ron', winner: 1, from: 0 }) }), false);
  assert.equal(j(drawn([ev(0, 'discard', '4m')])), null); // no riichi
});

test('suji: suji or genbutsu after the riichi, a suji among them, no deal-in', () => {
  const j = game('suji').judge;
  assert.equal(j(drawn(riichiThen('1m', '4m'))), true);
  assert.equal(j(drawn(riichiThen('4m', '9p'))), false); // genbutsu only
  assert.equal(j(drawn(riichiThen('1m', '5s'))), false); // 5s is neither
  assert.equal(j(drawn([ev(0, 'discard', '1m')])), null);
});

test('fold: safe or suji discards after the riichi, neither a win nor a deal-in', () => {
  const j = game('fold').judge;
  assert.equal(j(drawn(riichiThen('4m', '1m'))), true);
  assert.equal(j({ you: 0, events: riichiThen('4m'), result: result({ kind: 'ron', winner: 1, from: 2 }) }), true); // another seat dealt in
  assert.equal(j(drawn(riichiThen('5s'))), false); // pushed a dangerous tile
  assert.equal(j({ you: 0, events: riichiThen('4m'), result: result({ kind: 'ron', winner: 1, from: 0 }) }), false);
  assert.equal(j({ ...win(['tanyao'], riichiThen('4m')) }), false); // a win is not a fold
  assert.equal(j(drawn([ev(0, 'riichi', '5s')])), null); // your own riichi
});

test('stage 5: a win with the lesson\'s yaku, or the higher one of its kind', () => {
  for (const l of LESSONS.filter((x) => x.stage === 5)) {
    const j = game(l.id).judge;
    const key = l.reward.item!;
    assert.equal(j(win(['riichi', key])), true, l.id);
    assert.equal(j(win(['riichi'])), false, l.id);
  }
  assert.equal(game('iipeikou-win').judge(win(['ryanpeikou'])), true);
  assert.equal(game('honitsu-win').judge(win(['chinitsu'])), true);
});

// ---- Progress ----

const keyOf = (n: number) => gameRoundKey('g', n);

test('a lesson is locked until its prerequisites are passed, then assisted, unassisted and done', () => {
  const p = initialProgress();
  assert.equal(lessonStage(p, 'shape-win'), 'unassisted'); // no assists: one stage
  assert.equal(lessonStage(p, 'ryanmen-tenpai'), 'locked');
  assert.equal(lessonStage(p, 'nothing'), 'locked');
  const q = passed(['shape-win']);
  assert.equal(lessonStage(q, 'ryanmen-tenpai'), 'assisted');
  assert.deepEqual(lessonAids(q, 'ryanmen-tenpai'), { yaku: [], assists: ['assist:ukeire'] });
  const r = recordSuccess(q, 'ryanmen-tenpai', keyOf(1));
  assert.deepEqual([r.passed, r.completed], [true, false]);
  assert.equal(lessonStage(r.progress, 'ryanmen-tenpai'), 'unassisted');
  assert.deepEqual(lessonAids(r.progress, 'ryanmen-tenpai'), { yaku: [], assists: [] });
  const s = recordSuccess(r.progress, 'ryanmen-tenpai', keyOf(2));
  assert.deepEqual([s.passed, s.completed], [true, true]);
  assert.equal(lessonStage(s.progress, 'ryanmen-tenpai'), 'done');
  assert.deepEqual(s.progress.lessons['ryanmen-tenpai'], { assisted: true, count: 0, done: true, seen: [] });
  assert.equal(s.progress.coins, 20);
});

test('a lesson of N successes counts them in each stage', () => {
  let p = passed(['shape-win']);
  for (let i = 1; i < 5; i++) {
    const r = recordSuccess(p, 'max-ukeire', keyOf(i));
    assert.equal(r.passed, false);
    p = r.progress;
  }
  assert.equal(p.lessons['max-ukeire'].count, 4);
  p = recordSuccess(p, 'max-ukeire', keyOf(5)).progress;
  assert.deepEqual([p.lessons['max-ukeire'].assisted, p.lessons['max-ukeire'].count], [true, 0]);
});

test('a success is counted once for its key: the same practice position or game round adds nothing', () => {
  const at = session({ seed: 9, discards: ['1m', '0p'] });
  assert.equal(practiceKey(at), 'practice:9:1m5p');
  assert.equal(practiceKey(session({ seed: 9, discards: ['1m', '0p'], status: 'tsumo' })), 'practice:9:1m5p:tsumo'); // a tsumo from there
  assert.equal(practiceKey(session({ seed: 9, discards: ['1m', '5p'], node_id: 7 })), practiceKey(at)); // another node, the same position
  const p = passed(['shape-win']);
  const once = recordSuccess(p, 'max-ukeire', practiceKey(at)).progress;
  assert.equal(once.lessons['max-ukeire'].count, 1);
  const again = recordSuccess(once, 'max-ukeire', practiceKey(at));
  assert.equal(again.progress, once);
  assert.equal(recordSuccess(once, 'max-ukeire', practiceKey(session({ seed: 9, discards: ['1m'] }))).progress.lessons['max-ukeire'].count, 2);
  // A key counted with the assists is not counted again without them.
  const q = recordSuccess(p, 'ryanmen-tenpai', keyOf(1)).progress;
  assert.equal(recordSuccess(q, 'ryanmen-tenpai', keyOf(1)).progress, q);
});

test('a locked or done lesson records nothing; a failure is simply not recorded', () => {
  const p = initialProgress();
  assert.equal(recordSuccess(p, 'ryanmen-tenpai', keyOf(1)).progress, p);
  const done = passed(['shape-win']);
  assert.equal(recordSuccess(done, 'shape-win', keyOf(1)).progress, done);
  assert.equal(recordSuccess(p, 'nothing', keyOf(1)).progress, p);
});

test('the temporary yaku of a lesson are those it teaches', () => {
  assert.deepEqual(lessonAids(passed(['riichi-win', 'tanyao-win']), 'yakuhai-pon').yaku, ['haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei']);
  assert.deepEqual(lessonAids(passed(['yakuhai-pon']), 'kan-win').yaku, ['rinshan']);
  assert.deepEqual(lessonAids(initialProgress(), 'kan-win'), { yaku: [], assists: [] }); // locked
  assert.deepEqual(lessonAids(passed(['yakuhai-pon', 'kan-win']), 'kan-win'), { yaku: [], assists: [] }); // done
});

/** Passes a lesson whose prerequisites are done, through both of its stages. */
function pass(p: DojoProgress, id: string): DojoProgress {
  let q = p;
  for (let i = 0; lessonStage(q, id) !== 'done'; i++) {
    assert.ok(i < 20, `${id} does not end`);
    q = recordSuccess(q, id, keyOf(i)).progress;
  }
  return q;
}

const PINFU_BEFORE = ['shape-win', 'ryanmen-tenpai', 'riichi-win'];

test('passing a lesson grants its reward once, whatever the level', () => {
  const a = pass(passed(PINFU_BEFORE), 'pinfu-win');
  assert.ok(a.ownedYaku.includes('pinfu'));
  assert.ok(a.ownedItems.includes('pinfu'));
  assert.equal(a.coins, 0);
  assert.equal(recordSuccess(a, 'pinfu-win', keyOf(99)).progress, a); // paid once
  const y = pass(passed(['riichi-win', 'tanyao-win']), 'yakuhai-pon');
  for (const k of ['haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei']) assert.ok(y.ownedYaku.includes(k), k);
  assert.ok(y.ownedItems.includes('yakuhai'));
  const d = pass(passed(['suji']), 'fold'); // 危険牌の印 is Lv4 in the shop; a lesson grants it at Lv1
  assert.ok(d.ownedItems.includes('assist:danger'));
  assert.equal(pass(initialProgress(), 'shape-win').coins, 20);
});

test('passing a lesson whose yaku is owned already pays it in coins instead', () => {
  // 平和 bought in the shop, or owned from before it left the initial yaku.
  const bought = pass(passed(PINFU_BEFORE, { ownedItems: ['pinfu'], ownedYaku: ['riichi', 'tsumo', 'tanyao', 'pinfu'] }), 'pinfu-win');
  assert.equal(bought.coins, findItem('pinfu')!.price);
  assert.deepEqual(bought.ownedItems, ['pinfu']);
  const old = pass(passed(PINFU_BEFORE, { ownedYaku: ['riichi', 'tsumo', 'tanyao', 'pinfu'] }), 'pinfu-win');
  assert.equal(old.coins, findItem('pinfu')!.price);
  assert.equal(old.lessons['pinfu-win'].done, true);
});

test('lessons are kept by a save; data before them reads as {}, and a lesson out of shape is dropped alone', () => {
  const p = pass(initialProgress(), 'shape-win');
  assert.deepEqual(parseProgress(JSON.stringify(p)), p);
  const { lessons: _, ...old } = initialProgress();
  assert.deepEqual(parseProgress(JSON.stringify(old))?.lessons, {});
  assert.deepEqual(parseProgress(JSON.stringify({ ...p, lessons: [] })), { ...p, lessons: {} });
  assert.deepEqual(parseProgress(JSON.stringify({ ...p, lessons: 3 }))?.lessons, {});
  const mixed = { 'shape-win': { assisted: true, count: 0, done: true }, bad: { assisted: true, count: -1, done: true }, half: { done: true } };
  assert.deepEqual(parseProgress(JSON.stringify({ ...p, coins: 7, lessons: mixed })), {
    ...p, coins: 7, lessons: { 'shape-win': { assisted: true, count: 0, done: true, seen: [] } }, // seen came later: none
  });
});
