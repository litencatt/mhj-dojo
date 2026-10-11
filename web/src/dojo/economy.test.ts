// The economy's targets (catalog.ts's header), played out on the games the
// engine measured (docs/dojo-economy.md: seat 0 played by the weak CPU, 400
// 東風戦 a stage). The stage goes up as the yaku are bought, and each stage
// has its own ranks, won han and wins a game:
//   S0 the initial yaku (立直・門前清自摸和・断么九)
//   S1 S0 and 平和, 役牌 (the first purchases)
//   S2 S1 and every 2-han yaku
//   S3 every yaku
// The games are spread evenly over the measured ranks and pay the measured
// han and wins on average (the remainders carry over to the next game).
// The targets count the core of the shop: the yaku, the assists and the tile
// themes. The cheats and the other looks (the tile backs, the table cloths, the
// riichi sticks and the win effects) are extras for the long run, bought apart
// (the whole-shop tests). The curriculum is played along (learn, #320): its
// rewards are paid as they are earned, and once the 師範戦 opens it is tried
// until won (MASTER_TRIES), which opens the ウラ面 and its cheats in the shop.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, YAKUHAI_KEYS, YAKUMAN_PACK, type ShopItem } from './catalog.ts';
import { initialProgress, level, purchase, settle, type DojoProgress, type RoundLite } from './progress.ts';
import { LESSONS, lessonActive, recordSuccess } from './lessons.ts';
import { curriculumDone, masterMatchOpen } from './masterMatch.ts';

const CORE_KINDS: ShopItem['kind'][] = ['yaku', 'assist', 'theme', 'pack'];
const core = CATALOG.filter((it) => CORE_KINDS.includes(it.kind));

interface Stage {
  ranks: readonly number[]; // the share of 1st to 4th
  han: number; // won han a game
  wins: number; // wins a game
}

const STAGES: readonly Stage[] = [
  { ranks: [0.1975, 0.23, 0.265, 0.3075], han: 1.36, wins: 1.03 },
  { ranks: [0.222, 0.228, 0.26, 0.29], han: 1.66, wins: 1.02 },
  { ranks: [0.245, 0.245, 0.242, 0.268], han: 2.0, wins: 1.11 },
  { ranks: [0.278, 0.235, 0.235, 0.252], han: 2.37, wins: 1.11 },
];

// The same stages with seat 0 played human-like (docs/dojo-economy.md: the
// normal CPU without calls, which folds against a riichi): the faster bound.
const HUMAN_STAGES: readonly Stage[] = [
  { ranks: [0.3375, 0.28, 0.24, 0.1425], han: 2.08, wins: 1.54 },
  { ranks: [0.3725, 0.28, 0.22, 0.1275], han: 2.61, wins: 1.53 },
  { ranks: [0.4175, 0.27, 0.2025, 0.11], han: 3.1, wins: 1.65 },
  { ranks: [0.47, 0.2625, 0.165, 0.1025], han: 3.75, wins: 1.63 },
];

const TWO_HAN = ['double_riichi', 'sanshoku', 'ittsu', 'chanta', 'chiitoitsu', 'toitoi', 'sanankou', 'sanshoku_doukou', 'sankantsu', 'shousangen', 'honroutou'];
const ALL_YAKU = CATALOG.filter((it) => it.kind === 'yaku').map((it) => it.id);

function stage(p: DojoProgress, stages: readonly Stage[]): Stage {
  const has = (keys: readonly string[]) => keys.every((k) => p.ownedYaku.includes(k));
  if (has(ALL_YAKU) && p.ownedItems.includes(YAKUMAN_PACK)) return stages[3];
  if (!has(['pinfu', ...YAKUHAI_KEYS])) return stages[0];
  return has(TWO_HAN) ? stages[2] : stages[1];
}

/** The rank whose share holds u (0 to 1). */
function rankAt(ranks: readonly number[], u: number): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += ranks[i];
    if (u < sum) return i + 1;
  }
  return 4;
}

/** A run of games: the han and wins owed so far, below one, carry over. */
interface Run {
  p: DojoProgress;
  games: number;
  han: number;
  wins: number;
  stages: readonly Stage[];
  curriculum: boolean; // the curriculum played along (learn)
  masterTries: number; // the 師範戦's games so far (it opens the ウラ面 on the MASTER_TRIES-th)
}

/**
 * The 師範戦's tries until it is won: a human-like player is 1st in about 22% of them
 * (docs/dojo-economy.md), so the 5th try wins (1 - 0.78^5 ≈ 71%). They count as games of the
 * run's stage: the 師範戦 pays x6 against the 表's x1, but the 1st place is rarer.
 */
const MASTER_TRIES = 5;

/** A run from a new dojo, the curriculum played along unless `curriculum` is false. */
function start(stages: readonly Stage[] = STAGES, curriculum = true): Run {
  return { p: initialProgress(), games: 0, han: 0, wins: 0, stages, curriculum, masterTries: 0 };
}

/**
 * The curriculum played along a game: every practice lesson open is passed at once (practice mode
 * costs no game), and the first game lesson open gets one success in the game (a lesson with
 * assists needs its successes twice, with them and without). Its rewards are paid as lessons.ts pays them.
 */
function learn(p: DojoProgress, game: number): DojoProgress {
  const practice = () => {
    for (let again = true; again; ) {
      again = false;
      for (const l of LESSONS.filter((l) => l.form === 'practice' && lessonActive(p, l.id))) {
        for (let i = 0; lessonActive(p, l.id); i++) p = recordSuccess(p, l.id, `practice:${l.id}:${i}`).progress;
        again = true;
      }
    }
  };
  practice();
  const next = LESSONS.find((l) => l.form === 'game' && lessonActive(p, l.id));
  if (next) p = recordSuccess(p, next.id, `game:${game}`).progress;
  practice();
  return p;
}

/** One game at the run's stage, then buys the cheapest thing it can of `shop` (the core by default). */
function play(r: Run, shop: readonly ShopItem[] = core) {
  const s = stage(r.p, r.stages);
  r.games++;
  r.han += s.han;
  r.wins += s.wins;
  // The won rounds: each worth one han at least, the rest on the first.
  const wins = Math.floor(r.wins);
  const han = Math.floor(r.han);
  const rounds: RoundLite[] = [];
  if (wins > 0 && han >= wins) {
    for (let i = 0; i < wins; i++) rounds.push({ han: i === 0 ? han - wins + 1 : 1 });
    r.wins -= wins;
    r.han -= han;
  }
  const rank = rankAt(s.ranks, (r.games * 0.6180339887) % 1); // spread evenly over the ranks
  const g = { seed: r.games, you: 0, game_over: true, standings: [{ seat: 0, rank }], rounds };
  r.p = settle(r.p, g).progress;
  if (r.curriculum) r.p = learn(r.p, r.games);
  // Once open, the 師範戦 is tried until it is won, which opens the ウラ面 (and its cheats in the shop).
  if (!r.p.masterMatch.uraOpen && masterMatchOpen(r.p) && ++r.masterTries >= MASTER_TRIES) {
    r.p = { ...r.p, masterMatch: { tries: r.masterTries, wins: 1, uraOpen: true } };
  }
  for (const it of [...shop].sort((a, b) => a.price - b.price)) {
    const bought = purchase(r.p, it.id);
    if (bought.ok) r.p = bought.progress;
  }
}

const packless = core.filter((it) => it.id !== YAKUMAN_PACK);
const packlessCost = packless.reduce((n, it) => n + it.price, 0);
const spent = (p: DojoProgress) => packless.filter((it) => p.ownedItems.includes(it.id)).reduce((n, it) => n + it.price, 0);

test('平和 or 役牌 is affordable in the first game, even for a 4th place without a win', () => {
  const { progress } = settle(initialProgress(), {
    seed: 1, you: 0, game_over: true, standings: [{ seat: 0, rank: 4 }], rounds: [],
  });
  assert.ok(purchase(progress, 'pinfu').ok);
  assert.ok(purchase(progress, 'yakuhai').ok);
});

test('平和 and 役牌 are bought within 2 measured games', () => {
  const r = start();
  while (!['pinfu', 'yakuhai'].every((id) => r.p.ownedItems.includes(id)) && r.games < 10) play(r);
  assert.ok(r.games <= 2, `${r.games} games`);
});

test('Lv10 comes after 60 to 80 measured games, with 80% of the core shop (yakuman pack aside) bought', () => {
  const r = start();
  while (level(r.p.xp) < 10) play(r);
  assert.ok(r.games >= 60 && r.games <= 80, `${r.games} games`);
  assert.ok(spent(r.p) / packlessCost >= 0.8, `${spent(r.p)} of ${packlessCost} coins`);
});

test('the yakuman pack is bought within 40 games of Lv10, the core shop bought first', () => {
  const r = start();
  while (level(r.p.xp) < 10) play(r);
  const atTen = r.games;
  while (!r.p.ownedItems.includes(YAKUMAN_PACK) && r.games < 200) play(r);
  assert.ok(r.games - atTen <= 40, `${r.games - atTen} games after Lv10`);
});

test('the whole shop, cheats and every look included, is bought in about 175 games', () => {
  const r = start(STAGES);
  while (!CATALOG.every((it) => r.p.ownedItems.includes(it.id)) && r.games < 400) play(r, CATALOG);
  assert.ok(r.games >= 160 && r.games <= 190, `${r.games} games`);
});

test('human-like: 平和 and 役牌 are bought within 2 games', () => {
  const r = start(HUMAN_STAGES);
  while (!['pinfu', ...YAKUHAI_KEYS].every((k) => r.p.ownedYaku.includes(k)) && r.games < 10) play(r);
  assert.ok(r.games <= 2, `${r.games} games`);
});

test('human-like: Lv10 comes after 40 to 60 games', () => {
  const r = start(HUMAN_STAGES);
  while (level(r.p.xp) < 10) play(r);
  assert.ok(r.games >= 40 && r.games <= 60, `${r.games} games`);
});

test('human-like: the whole shop is bought in 110 to 150 games', () => {
  const r = start(HUMAN_STAGES);
  while (!CATALOG.every((it) => r.p.ownedItems.includes(it.id)) && r.games < 400) play(r, CATALOG);
  assert.ok(r.games >= 110 && r.games <= 150, `${r.games} games`);
});


// ---- The curriculum and the 師範戦 (#320), played along ----

/** Plays the run until `done` holds, at most `limit` games, and returns the games played. */
function until(r: Run, done: (p: DojoProgress) => boolean, shop: readonly ShopItem[] = core, limit = 400): number {
  while (!done(r.p) && r.games < limit) play(r, shop);
  return r.games;
}

test('the curriculum is passed in 25 to 35 games, one success a game', () => {
  for (const stages of [STAGES, HUMAN_STAGES]) {
    const n = until(start(stages), curriculumDone);
    assert.ok(n >= 25 && n <= 35, `${n} games`);
  }
});

test('the 師範戦 opens about when the curriculum is passed: 25 to 40 games', () => {
  for (const stages of [STAGES, HUMAN_STAGES]) {
    const n = until(start(stages), masterMatchOpen);
    assert.ok(n >= 25 && n <= 40, `${n} games`);
  }
});

test('the first purchase comes with the first game', () => {
  const r = start(STAGES);
  play(r);
  assert.ok(r.p.ownedItems.length > 0, `${r.p.ownedItems}`);
});

test('without the curriculum, the shop takes no longer than with it', () => {
  const all = (p: DojoProgress) => CATALOG.every((it) => p.ownedItems.includes(it.id));
  const without = start(STAGES, false);
  // Without the curriculum the 師範戦 never opens: the cheats are left out of the comparison.
  const noCheats = CATALOG.filter((it) => it.kind !== 'cheat');
  const a = until(without, (p) => noCheats.every((it) => p.ownedItems.includes(it.id)), noCheats);
  const b = until(start(STAGES), (p) => noCheats.every((it) => p.ownedItems.includes(it.id)), noCheats);
  assert.ok(b <= a, `with ${b}, without ${a}`);
  assert.ok(!all(without.p));
});
