// The dojo's progress (progress.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, INITIAL_YAKU, YAKUMAN_KEYS } from './catalog.ts';
import {
  CORRUPT_KEY,
  STORAGE_KEY,
  canAffordRedraw,
  dojoOptions,
  exportProgress,
  initialProgress,
  level,
  loadProgress,
  parseProgress,
  purchase,
  saveProgress,
  setTheme,
  settle,
  type DojoProgress,
  type FinishedGame,
  type KeyValueStore,
} from './progress.ts';

function game(seed: number, rank: number, rounds: FinishedGame['rounds']): FinishedGame {
  const standings = [1, 2, 3, 4].map((seat) => ({ seat: seat - 1, rank: seat === 1 ? rank : seat }));
  return { seed, you: 0, game_over: true, standings, rounds };
}

function withFirstBonus(over: Partial<DojoProgress> = {}): DojoProgress {
  return { ...initialProgress(), firstGameBonus: true, ...over };
}

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

test('level is computed from the total XP', () => {
  assert.equal(level(0), 1);
  assert.equal(level(99), 1);
  assert.equal(level(100), 2);
  assert.equal(level(300), 3);
  assert.equal(level(4500), 10);
  assert.equal(level(4499), 9);
});

test('a new dojo owns 断么九, 平和, the dragons and the winds only', () => {
  assert.deepEqual(initialProgress().ownedYaku, INITIAL_YAKU);
  assert.deepEqual([...INITIAL_YAKU].sort(), ['chun', 'haku', 'hatsu', 'nan', 'pei', 'pinfu', 'shaa', 'tanyao', 'ton']);
});

test('reward: 1st with two wins (3 and 2 han) and one redraw is 150 XP and 90 coins', () => {
  const { progress, reward } = settle(withFirstBonus(), game(1, 1, [{ han: 3 }, { han: 2, redraws: 1 }, {}]));
  assert.equal(reward?.xp, 150);
  assert.equal(reward?.coins, 90);
  assert.equal(progress.xp, 150);
  assert.equal(progress.coins, 90);
});

test('reward: the first finished game adds the bonus once', () => {
  const first = settle(initialProgress(), game(1, 4, []));
  assert.equal(first.reward?.firstGameBonus, 40);
  assert.equal(first.progress.coins, 15 + 40);
  const second = settle(first.progress, game(2, 4, []));
  assert.equal(second.reward?.firstGameBonus, 0);
  assert.equal(second.progress.coins, 55 + 15);
});

test('reward: the floor at 0 applies to the whole balance, not to the game', () => {
  // 10 + 15 - 5 x 20 = -75: a floor on the game's own difference would leave 25.
  const { progress, reward } = settle(withFirstBonus({ coins: 10 }), game(1, 4, [{ redraws: 5 }]));
  assert.equal(progress.coins, 0);
  assert.equal(reward?.coins, 15 - 100);
});

test('reward: a coin balance covers a game that costs less than it', () => {
  const { progress } = settle(withFirstBonus({ coins: 100 }), game(1, 4, [{ redraws: 3 }]));
  assert.equal(progress.coins, 100 + 15 - 60);
});

test('settling the same seed twice changes nothing the second time', () => {
  const g = game(12345, 2, [{ han: 2 }]);
  const once = settle(withFirstBonus(), g);
  const twice = settle(once.progress, g);
  assert.equal(twice.reward, null);
  assert.deepEqual(twice.progress, once.progress);
  assert.deepEqual(once.progress.settled, ['12345']);
});

test('a game that is not over, or whose seed is unknown, is not settled', () => {
  const p = withFirstBonus();
  assert.equal(settle(p, { ...game(1, 1, []), game_over: false }).reward, null);
  assert.equal(settle(p, { ...game(1, 1, []), seed: null }).reward, null);
});

test('the redraw needs the balance less the finished rounds redraws', () => {
  const p = withFirstBonus({ coins: 50 });
  assert.equal(canAffordRedraw(p, []), true);
  assert.equal(canAffordRedraw(p, [{ redraws: 1 }]), true); // 50 - 20 = 30
  assert.equal(canAffordRedraw(p, [{ redraws: 1 }, { redraws: 1 }]), false); // 50 - 40 = 10
  assert.equal(canAffordRedraw(withFirstBonus({ coins: 19 }), []), false);
});

test('a purchase is refused for the level, the prerequisite and the coins', () => {
  const rich = withFirstBonus({ coins: 5000 });
  assert.deepEqual(purchase(rich, 'sanshoku'), { ok: false, reason: 'level' }); // Lv3
  assert.deepEqual(purchase({ ...rich, xp: 100 }, 'ippatsu'), { ok: false, reason: 'requires' }); // needs 立直
  assert.deepEqual(purchase(withFirstBonus({ coins: 39 }), 'riichi'), { ok: false, reason: 'coins' });
  assert.deepEqual(purchase(rich, 'nothing'), { ok: false, reason: 'unknown' });
  assert.deepEqual(purchase(rich, 'tanyao'), { ok: false, reason: 'unknown' }); // not for sale
});

test('a purchase takes the coins and adds the item', () => {
  const r = purchase(withFirstBonus({ coins: 100 }), 'riichi');
  assert.ok(r.ok);
  assert.equal(r.progress.coins, 60);
  assert.ok(r.progress.ownedYaku.includes('riichi'));
  assert.ok(r.progress.ownedItems.includes('riichi'));
  assert.deepEqual(purchase(r.progress, 'riichi'), { ok: false, reason: 'owned' });
  const after = purchase({ ...r.progress, xp: 100 }, 'ippatsu');
  assert.ok(after.ok);
});

test('the yakuman pack needs 七対子 and grants every yakuman', () => {
  const rich = withFirstBonus({ coins: 5000, xp: 4500 });
  assert.deepEqual(purchase(rich, 'yakuman-pack'), { ok: false, reason: 'requires' });
  const seven = purchase(rich, 'chiitoitsu');
  assert.ok(seven.ok);
  const pack = purchase(seven.progress, 'yakuman-pack');
  assert.ok(pack.ok);
  for (const k of YAKUMAN_KEYS) assert.ok(pack.progress.ownedYaku.includes(k), k);
  assert.equal(pack.progress.coins, 5000 - 80 - 1500);
});

test('the catalog has unique ids and its prerequisites are in it', () => {
  const ids = CATALOG.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const it of CATALOG) for (const r of it.requires ?? []) assert.ok(ids.includes(r), r);
});

test('a theme is set only when it is owned', () => {
  const p = withFirstBonus({ ownedItems: ['theme:wafuu'] });
  assert.equal(setTheme(p, 'theme:wafuu').activeTheme, 'theme:wafuu');
  assert.equal(setTheme(p, 'theme:mono').activeTheme, 'default');
  assert.equal(setTheme(setTheme(p, 'theme:wafuu'), 'default').activeTheme, 'default');
});

test('the dojo options follow what is owned', () => {
  const p = withFirstBonus({ ownedItems: ['cheat:peek', 'cheat:redraw'], ownedYaku: ['tanyao', 'riichi'] });
  assert.deepEqual(dojoOptions(p), { yaku: ['tanyao', 'riichi'], peek: true, redraws_per_round: 1 });
  assert.deepEqual(dojoOptions(initialProgress()).peek, false);
  assert.equal(dojoOptions(initialProgress()).redraws_per_round, 0);
});

test('broken JSON is kept aside and the dojo starts over', () => {
  const store = memoryStore({ [STORAGE_KEY]: '{not json' });
  const { progress, corrupted } = loadProgress(store);
  assert.equal(corrupted, true);
  assert.deepEqual(progress, initialProgress());
  assert.equal(store.data.get(CORRUPT_KEY), '{not json');
});

test('another version is kept aside too', () => {
  const text = JSON.stringify({ ...initialProgress(), version: 2 });
  const store = memoryStore({ [STORAGE_KEY]: text });
  assert.equal(loadProgress(store).corrupted, true);
  assert.equal(store.data.get(CORRUPT_KEY), text);
});

test('no saved progress is a fresh start, not a corruption', () => {
  const store = memoryStore();
  assert.deepEqual(loadProgress(store), { progress: initialProgress(), corrupted: false });
  assert.equal(store.data.has(CORRUPT_KEY), false);
});

test('saved progress loads back, and an export imports to the same state', () => {
  const p = settle(initialProgress(), game(77, 1, [{ han: 4, redraws: 1 }])).progress;
  const bought = purchase({ ...p, coins: 500 }, 'riichi');
  assert.ok(bought.ok);
  const store = memoryStore();
  assert.equal(saveProgress(bought.progress, store), true);
  assert.deepEqual(loadProgress(store).progress, bought.progress);
  assert.deepEqual(parseProgress(exportProgress(bought.progress)), bought.progress);
});

test('an import with a wrong shape is refused', () => {
  assert.equal(parseProgress('[]'), null);
  assert.equal(parseProgress('null'), null);
  assert.equal(parseProgress(JSON.stringify({ ...initialProgress(), coins: -1 })), null);
  assert.equal(parseProgress(JSON.stringify({ ...initialProgress(), ownedYaku: [1] })), null);
});

test('saving without a store reports failure', () => {
  assert.equal(saveProgress(initialProgress(), null), false);
});
