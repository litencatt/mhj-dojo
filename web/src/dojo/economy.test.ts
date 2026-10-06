// The economy's targets (catalog.ts's header), played out on average games:
// ranks cycle 1st to 4th (XP 50 and 35 coins on average) and the won han
// alternate 1 and 2 (1.5 on average), so a game pays 65 XP and 50 coins.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, YAKUMAN_PACK } from './catalog.ts';
import { initialProgress, level, purchase, settle, type DojoProgress } from './progress.ts';

/** One average game, then buys the cheapest thing it can. */
function play(p: DojoProgress, n: number): DojoProgress {
  const g = {
    seed: n,
    you: 0,
    game_over: true,
    standings: [{ seat: 0, rank: ((n - 1) % 4) + 1 }],
    rounds: [{ han: n % 2 === 1 ? 1 : 2 }],
  };
  p = settle(p, g).progress;
  for (const it of [...CATALOG].sort((a, b) => a.price - b.price)) {
    const r = purchase(p, it.id);
    if (r.ok) p = r.progress;
  }
  return p;
}

const packless = CATALOG.filter((it) => it.id !== YAKUMAN_PACK);
const packlessCost = packless.reduce((n, it) => n + it.price, 0);
const spent = (p: DojoProgress) => packless.filter((it) => p.ownedItems.includes(it.id)).reduce((n, it) => n + it.price, 0);

test('立直 is affordable in the first game, even for a 4th place without a win', () => {
  const { progress } = settle(initialProgress(), {
    seed: 1, you: 0, game_over: true, standings: [{ seat: 0, rank: 4 }], rounds: [],
  });
  assert.ok(purchase(progress, 'riichi').ok);
});

test('立直 is bought within 2 average games', () => {
  let p = initialProgress();
  let games = 0;
  while (!p.ownedItems.includes('riichi')) p = play(p, ++games);
  assert.ok(games <= 2, `${games} games`);
});

test('Lv10 comes after 60 to 80 average games, with 80% of the shop bought', () => {
  let p = initialProgress();
  let games = 0;
  while (level(p.xp) < 10) p = play(p, ++games);
  assert.ok(games >= 60 && games <= 80, `${games} games`);
  assert.ok(spent(p) / packlessCost >= 0.8, `${spent(p)} of ${packlessCost} coins`);
});

test('the yakuman pack is bought within 40 games of Lv10', () => {
  let p = initialProgress();
  let games = 0;
  while (level(p.xp) < 10) p = play(p, ++games);
  const atTen = games;
  while (!p.ownedItems.includes(YAKUMAN_PACK) && games < 200) p = play(p, ++games);
  assert.ok(games - atTen <= 40, `${games - atTen} games after Lv10`);
});
