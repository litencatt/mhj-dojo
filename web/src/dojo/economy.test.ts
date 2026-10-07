// The economy's targets (catalog.ts's header), played out on the games the
// engine measured (docs/dojo-economy.md: seat 0 played by the weak CPU, 400
// 東風戦 a stage). The stage goes up as the yaku are bought, and each stage
// has its own ranks, won han and wins a game:
//   S0 the initial yaku (断么九・平和・門前清自摸和)
//   S1 S0 and 立直, 役牌
//   S2 S1 and every 2-han yaku
//   S3 every yaku
// The games are spread evenly over the measured ranks and pay the measured
// han and wins on average (the remainders carry over to the next game).
// The targets count the core of the shop: the yaku, the assists and the tile
// themes. The cheats and the other looks (the tile backs, the table cloths, the
// riichi sticks and the win effects) are extras for the long run, bought apart
// (the last test).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, YAKUHAI_KEYS, YAKUMAN_PACK, type ShopItem } from './catalog.ts';
import { initialProgress, level, purchase, settle, type DojoProgress, type RoundLite } from './progress.ts';

const CORE_KINDS: ShopItem['kind'][] = ['yaku', 'assist', 'theme', 'pack'];
const core = CATALOG.filter((it) => CORE_KINDS.includes(it.kind));

interface Stage {
  ranks: readonly number[]; // the share of 1st to 4th
  han: number; // won han a game
  wins: number; // wins a game
}

const STAGES: readonly Stage[] = [
  { ranks: [0.08, 0.255, 0.29, 0.375], han: 0.74, wins: 0.58 },
  { ranks: [0.222, 0.228, 0.26, 0.29], han: 1.66, wins: 1.02 },
  { ranks: [0.245, 0.245, 0.242, 0.268], han: 2.0, wins: 1.11 },
  { ranks: [0.278, 0.235, 0.235, 0.252], han: 2.37, wins: 1.11 },
];

const TWO_HAN = ['double_riichi', 'sanshoku', 'ittsu', 'chanta', 'chiitoitsu', 'toitoi', 'sanankou', 'sanshoku_doukou', 'sankantsu', 'shousangen', 'honroutou'];
const ALL_YAKU = CATALOG.filter((it) => it.kind === 'yaku').map((it) => it.id);

function stage(p: DojoProgress): Stage {
  const has = (keys: readonly string[]) => keys.every((k) => p.ownedYaku.includes(k));
  if (has(ALL_YAKU) && p.ownedItems.includes(YAKUMAN_PACK)) return STAGES[3];
  if (!has(['riichi', ...YAKUHAI_KEYS])) return STAGES[0];
  return has(TWO_HAN) ? STAGES[2] : STAGES[1];
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
}

function start(): Run {
  return { p: initialProgress(), games: 0, han: 0, wins: 0 };
}

/** One game at the run's stage, then buys the cheapest thing it can of `shop` (the core by default). */
function play(r: Run, shop: readonly ShopItem[] = core) {
  const s = stage(r.p);
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
  for (const it of [...shop].sort((a, b) => a.price - b.price)) {
    const bought = purchase(r.p, it.id);
    if (bought.ok) r.p = bought.progress;
  }
}

const packless = core.filter((it) => it.id !== YAKUMAN_PACK);
const packlessCost = packless.reduce((n, it) => n + it.price, 0);
const spent = (p: DojoProgress) => packless.filter((it) => p.ownedItems.includes(it.id)).reduce((n, it) => n + it.price, 0);

test('立直 is affordable in the first game, even for a 4th place without a win', () => {
  const { progress } = settle(initialProgress(), {
    seed: 1, you: 0, game_over: true, standings: [{ seat: 0, rank: 4 }], rounds: [],
  });
  assert.ok(purchase(progress, 'riichi').ok);
});

test('立直 is bought within 2 measured games', () => {
  const r = start();
  while (!r.p.ownedItems.includes('riichi')) play(r);
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
  const r = start();
  while (!CATALOG.every((it) => r.p.ownedItems.includes(it.id)) && r.games < 400) play(r, CATALOG);
  assert.ok(r.games >= 160 && r.games <= 190, `${r.games} games`);
});
