// The dojo's progress (progress.ts), run by `npm test` in plain Node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, INITIAL_YAKU, YAKUHAI_KEYS, YAKUMAN_KEYS } from './catalog.ts';
import { rankName } from './rules.ts';
import {
  CORRUPT_KEY,
  STORAGE_KEY,
  canAffordRedraw,
  canAffordSummon,
  dojoOptions,
  initialProgress,
  level,
  loadProgress,
  parseProgress,
  dojoGame,
  payRounds,
  purchase,
  saveProgress,
  setBack,
  setCloth,
  setEffect,
  setGameCpu,
  setGameLength,
  setStick,
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

test('a new dojo owns 断么九, 平和 and 門前清自摸和 only', () => {
  assert.deepEqual(initialProgress().ownedYaku, INITIAL_YAKU);
  assert.deepEqual([...INITIAL_YAKU].sort(), ['pinfu', 'tanyao', 'tsumo']);
  assert.equal(CATALOG.some((it) => it.id === 'tsumo'), false);
});

test('a progress from before 門前清自摸和 was given owns it once loaded', () => {
  const old = { ...withFirstBonus(), ownedYaku: ['tanyao', 'pinfu', 'riichi'] };
  assert.deepEqual(parseProgress(JSON.stringify(old))?.ownedYaku, ['tanyao', 'pinfu', 'riichi', 'tsumo']);
});

test('a won round pays its han and its 和了祝儀 at once, and only once', () => {
  const p = withFirstBonus({ coins: 5, xp: 90 });
  const first = payRounds(p, 'g1', [{ han: 3 }]);
  assert.ok(first);
  assert.deepEqual([first.coins, first.xp], [40, 30]); // 3 han x 10 and the 和了祝儀's 10; no XP for the 祝儀
  assert.equal(first.progress.coins, 45);
  assert.equal(level(first.progress.xp), 2); // a level-up mid-game
  assert.deepEqual(first.progress.paidRounds, { g1: 1 });
  // The same rounds again (a reload): nothing more.
  assert.equal(payRounds(first.progress, 'g1', [{ han: 3 }]), null);
  // A round lost, then a round won.
  const lost = payRounds(first.progress, 'g1', [{ han: 3 }, {}]);
  assert.ok(lost);
  assert.equal(lost.coins, 0);
  const won = payRounds(lost.progress, 'g1', [{ han: 3 }, {}, { han: 2 }]);
  assert.equal(won?.progress.coins, 45 + 30);
  // Another game counts apart.
  assert.equal(payRounds(won!.progress, 'g2', [{ han: 1 }])?.progress.paidRounds.g2, 1);
});

test('settling a game does not pay again the rounds paid as they ended', () => {
  // 1st with two wins (3 and 2 han) and one redraw: 150 XP and 110 coins (和了祝儀 included) in all, as when nothing was paid before.
  const rounds = [{ han: 3 }, { han: 2 }, { redraws: 1 }];
  const paid = payRounds(payRounds(withFirstBonus(), 'g', rounds.slice(0, 1))!.progress, 'g', rounds.slice(0, 2))!.progress;
  assert.equal(paid.coins, 70);
  const { progress, reward } = settle(paid, game(1, 1, rounds), 'g');
  assert.equal(reward?.xp, 150);
  assert.equal(reward?.coins, 110);
  assert.equal(reward?.paidCoins, 70);
  assert.equal(reward?.hanCoins, 50);
  assert.deepEqual([reward?.wins, reward?.winBonusCoins], [2, 20]);
  assert.equal(reward?.rankCoins, 60);
  assert.equal(progress.coins, 110);
  assert.equal(progress.xp, 150);
  assert.deepEqual(progress.paidRounds, {});
  assert.equal(reward?.levelBefore, 1);
  // A round paid but not the last: settle pays the last one.
  const part = settle(payRounds(withFirstBonus(), 'h', rounds.slice(0, 1))!.progress, game(2, 1, rounds), 'h');
  assert.equal(part.progress.coins, 110);
});

test('a progress from before the rounds were paid loads with none paid', () => {
  const { paidRounds: _, ...old } = withFirstBonus();
  assert.deepEqual(parseProgress(JSON.stringify(old))?.paidRounds, {});
  assert.equal(parseProgress(JSON.stringify({ ...old, paidRounds: { g: -1 } })), null);
  assert.equal(parseProgress(JSON.stringify({ ...old, paidRounds: [] })), null);
});

test('reward: 1st with two wins (3 and 2 han) and one redraw is 150 XP and 110 coins, 和了祝儀 (10 a win) included', () => {
  const { progress, reward } = settle(withFirstBonus(), game(1, 1, [{ han: 3 }, { han: 2 }, { redraws: 1 }]));
  assert.equal(reward?.xp, 150);
  assert.equal(reward?.coins, 110); // rank 60 + han 50 + 和了祝儀 20 - redraw 20
  assert.equal(progress.xp, 150);
  assert.equal(progress.coins, 110);
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
  assert.equal(pack.progress.coins, 5000 - 80 - 2000);
});

test('役牌 is bought as one item that grants the dragons and the winds', () => {
  const p = withFirstBonus({ coins: 40 });
  assert.ok(!p.ownedYaku.includes('haku'));
  const r = purchase(p, 'yakuhai');
  assert.ok(r.ok);
  for (const k of YAKUHAI_KEYS) assert.ok(r.progress.ownedYaku.includes(k), k);
  assert.equal(r.progress.coins, 0);
  assert.deepEqual(dojoOptions(r.progress).yaku.sort(), [...INITIAL_YAKU, ...YAKUHAI_KEYS].sort());
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
  assert.deepEqual(dojoOptions(p), {
    yaku: ['tanyao', 'riichi'], peek: true, redraws_per_round: 1,
    ura_peek: false, riichi_waits: false, wall_peek: 0, summons_per_round: 0,
  });
  assert.deepEqual(dojoOptions(initialProgress()), {
    yaku: [...INITIAL_YAKU], peek: false, redraws_per_round: 0,
    ura_peek: false, riichi_waits: false, wall_peek: 0, summons_per_round: 0,
  });
  const cheats = withFirstBonus({ ownedItems: ['cheat:ura', 'cheat:riichiwaits', 'cheat:wallpeek', 'cheat:summon'] });
  assert.deepEqual(dojoOptions(cheats), {
    yaku: [...INITIAL_YAKU], peek: false, redraws_per_round: 0,
    ura_peek: true, riichi_waits: true, wall_peek: 3, summons_per_round: 1,
  });
});

test('reward: summons cost 50 each, settled with the redraws', () => {
  const { progress, reward } = settle(withFirstBonus({ coins: 200 }), game(1, 4, [{ summons: 1 }, { summons: 1, redraws: 1 }]));
  assert.equal(reward?.summons, 2);
  assert.equal(reward?.summonCost, 100);
  assert.equal(reward?.coins, 15 - 20 - 100);
  assert.equal(progress.coins, 200 + 15 - 20 - 100);
});

test('the summon needs the balance less the finished rounds redraws and summons', () => {
  assert.equal(canAffordSummon(withFirstBonus({ coins: 50 }), []), true);
  assert.equal(canAffordSummon(withFirstBonus({ coins: 49 }), []), false);
  assert.equal(canAffordSummon(withFirstBonus({ coins: 100 }), [{ summons: 1 }]), true); // 100 - 50 = 50
  assert.equal(canAffordSummon(withFirstBonus({ coins: 100 }), [{ summons: 1, redraws: 1 }]), false); // 100 - 70 = 30
  assert.equal(canAffordRedraw(withFirstBonus({ coins: 60 }), [{ summons: 1 }]), false); // 60 - 50 = 10
});

test('a tile back is set only when it is owned, apart from the theme', () => {
  const p = withFirstBonus({ ownedItems: ['back:shima'], activeTheme: 'theme:wafuu' });
  assert.equal(initialProgress().activeBack, 'default');
  assert.equal(setBack(p, 'back:shima').activeBack, 'back:shima');
  assert.equal(setBack(p, 'back:shima').activeTheme, 'theme:wafuu');
  assert.equal(setBack(p, 'back:asanoha').activeBack, 'default');
  assert.equal(setBack(setBack(p, 'back:shima'), 'default').activeBack, 'default');
});

test('a progress from before the tile backs loads with the default back', () => {
  const { activeBack: _, ...old } = withFirstBonus({ coins: 7 });
  const parsed = parseProgress(JSON.stringify(old));
  assert.equal(parsed?.activeBack, 'default');
  assert.equal(parsed?.coins, 7);
  assert.equal(parseProgress(JSON.stringify({ ...old, activeBack: 3 })), null);
});

test('the looks (cloth, riichi stick, win effect) are bought, then set only when owned', () => {
  const p0 = withFirstBonus({ coins: 1000, xp: 1000 });
  assert.deepEqual([p0.activeCloth, p0.activeStick, p0.activeEffect], ['default', 'default', 'default']);
  assert.equal(setCloth(p0, 'cloth:midori').activeCloth, 'default');
  const bought = purchase(p0, 'cloth:midori');
  assert.ok(bought.ok);
  const p = { ...bought.progress, ownedItems: [...bought.progress.ownedItems, 'stick:take', 'effect:sakura'] };
  assert.equal(p.coins, 960);
  assert.equal(setCloth(p, 'cloth:midori').activeCloth, 'cloth:midori');
  assert.equal(setCloth(p, 'cloth:kon').activeCloth, 'default');
  assert.equal(setStick(p, 'stick:take').activeStick, 'stick:take');
  assert.equal(setStick(p, 'stick:kogane').activeStick, 'default');
  assert.equal(setEffect(p, 'effect:sakura').activeEffect, 'effect:sakura');
  assert.equal(setEffect(p, 'effect:kinkou').activeEffect, 'default');
  assert.equal(setCloth(setCloth(p, 'cloth:midori'), 'default').activeCloth, 'default');
  // One look apart from the others and from the theme and back.
  const set = setEffect(setStick(setCloth({ ...p, activeTheme: 'theme:wafuu' }, 'cloth:midori'), 'stick:take'), 'effect:sakura');
  assert.deepEqual(
    [set.activeTheme, set.activeBack, set.activeCloth, set.activeStick, set.activeEffect],
    ['theme:wafuu', 'default', 'cloth:midori', 'stick:take', 'effect:sakura'],
  );
});

test('the looks sell cheap from the first ranks', () => {
  const looks = CATALOG.filter((it) => it.kind === 'cloth' || it.kind === 'stick' || it.kind === 'effect');
  assert.equal(looks.length, 9);
  assert.ok(looks.every((it) => it.price >= 40 && it.price <= 150 && it.level <= 5), JSON.stringify(looks));
  assert.ok(looks.some((it) => it.level === 1));
});

test('a progress from before the looks loads with the default cloth, stick and effect', () => {
  const { activeCloth: _c, activeStick: _s, activeEffect: _e, ...old } = withFirstBonus({ coins: 7 });
  const parsed = parseProgress(JSON.stringify(old));
  assert.deepEqual([parsed?.activeCloth, parsed?.activeStick, parsed?.activeEffect], ['default', 'default', 'default']);
  assert.equal(parsed?.coins, 7);
  const chosen = parseProgress(JSON.stringify({ ...old, activeCloth: 'cloth:kon', activeStick: 'stick:take', activeEffect: 'effect:kinkou' }));
  assert.deepEqual([chosen?.activeCloth, chosen?.activeStick, chosen?.activeEffect], ['cloth:kon', 'stick:take', 'effect:kinkou']);
  assert.equal(parseProgress(JSON.stringify({ ...old, activeCloth: 1 })), null);
  assert.equal(parseProgress(JSON.stringify({ ...old, activeStick: null })), null);
  assert.equal(parseProgress(JSON.stringify({ ...old, activeEffect: [] })), null);
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

test('saved progress loads back to the same state', () => {
  const p = settle(initialProgress(), game(77, 1, [{ han: 4, redraws: 1 }])).progress;
  const bought = purchase({ ...p, coins: 500 }, 'riichi');
  assert.ok(bought.ok);
  const store = memoryStore();
  assert.equal(saveProgress(bought.progress, store), true);
  assert.deepEqual(loadProgress(store).progress, bought.progress);
});

test('a stored progress with a wrong shape is refused', () => {
  assert.equal(parseProgress('[]'), null);
  assert.equal(parseProgress('null'), null);
  assert.equal(parseProgress(JSON.stringify({ ...initialProgress(), coins: -1 })), null);
  assert.equal(parseProgress(JSON.stringify({ ...initialProgress(), ownedYaku: [1] })), null);
});

test('saving without a store reports failure', () => {
  assert.equal(saveProgress(initialProgress(), null), false);
});

test('a won round with a redraw or a summon pays its han but no 和了祝儀', () => {
  const p = withFirstBonus();
  assert.equal(payRounds(p, 'g', [{ han: 2, redraws: 1 }])?.coins, 20);
  assert.equal(payRounds(p, 'g', [{ han: 2, summons: 1 }])?.coins, 20);
  assert.equal(payRounds(p, 'g', [{ han: 2, redraws: 1 }])?.xp, 20);
  // 1st: rank 60, han 50, one 和了祝儀 (the other win had a summon), the summon -50.
  const rounds = [{ han: 3 }, { han: 2, summons: 1 }];
  const { reward } = settle(p, game(1, 1, rounds));
  assert.deepEqual([reward?.wins, reward?.cheatedWins, reward?.winBonusCoins], [2, 1, 10]);
  assert.equal(reward?.coins, 60 + 50 + 10 - 50);
  // Paid round by round, the same in all.
  const paid = payRounds(payRounds(p, 'h', rounds.slice(0, 1))!.progress, 'h', rounds)!.progress;
  assert.equal(paid.coins, 30 + 10 + 20);
  assert.equal(settle(paid, game(2, 1, rounds), 'h').progress.coins, 60 + 50 + 10 - 50);
});

test('the rank pays x2 in 半荘戦, x1.5 against the normal CPU and x3 with both; the han and the bonuses do not', () => {
  const rounds = [{ han: 2 }];
  const at = (length: FinishedGame['length'], cpu: FinishedGame['cpu'], rank = 1) =>
    settle(initialProgress(), { ...game(1, rank, rounds), length, cpu }).reward!;
  const plain = at('tonpuu', 'weak');
  assert.deepEqual([plain.rankMultiplier, plain.rankXp, plain.rankCoins, plain.xp, plain.coins], [1, 100, 60, 120, 60 + 20 + 10 + 40]);
  const hanchan = at('hanchan', 'weak');
  assert.deepEqual([hanchan.rankMultiplier, hanchan.rankXp, hanchan.rankCoins, hanchan.xp, hanchan.coins], [2, 200, 120, 220, 120 + 20 + 10 + 40]);
  const normal = at('tonpuu', 'normal', 4);
  assert.deepEqual([normal.rankMultiplier, normal.rankXp, normal.rankCoins], [1.5, 15, 23]); // 10 x 1.5, 15 x 1.5 rounded
  const both = at('hanchan', 'normal', 2);
  assert.deepEqual([both.rankMultiplier, both.rankXp, both.rankCoins], [3, 180, 120]);
  // A game without them (from before) is the plain game.
  assert.equal(settle(initialProgress(), game(1, 1, rounds)).reward?.rankMultiplier, 1);
});

test('半荘戦 is chosen from Lv5 and the normal CPU from Lv7', () => {
  const lv4 = withFirstBonus({ xp: 999 });
  assert.equal(setGameLength(lv4, 'hanchan').gameLength, 'tonpuu');
  const lv5 = withFirstBonus({ xp: 1000 });
  assert.equal(setGameLength(lv5, 'hanchan').gameLength, 'hanchan');
  assert.equal(setGameCpu(lv5, 'normal').gameCpu, 'weak');
  const lv7 = withFirstBonus({ xp: 2100 });
  assert.equal(setGameCpu(lv7, 'normal').gameCpu, 'normal');
  assert.equal(setGameCpu(setGameCpu(lv7, 'normal'), 'weak').gameCpu, 'weak');
  assert.deepEqual(dojoGame(setGameCpu(setGameLength(lv7, 'hanchan'), 'normal')), { length: 'hanchan', cpu: 'normal' });
  // A loaded backup's choice above its level plays the first game.
  assert.deepEqual(dojoGame({ ...lv4, gameLength: 'hanchan', gameCpu: 'normal' }), { length: 'tonpuu', cpu: 'weak' });
});

test('a progress from before the game choice loads with 東風戦 against weak CPUs', () => {
  const { gameLength: _l, gameCpu: _c, ...old } = withFirstBonus({ xp: 2100 });
  const parsed = parseProgress(JSON.stringify(old));
  assert.deepEqual([parsed?.gameLength, parsed?.gameCpu], ['tonpuu', 'weak']);
  assert.equal(parseProgress(JSON.stringify({ ...old, gameLength: 'south' })), null);
  assert.equal(parseProgress(JSON.stringify({ ...old, gameCpu: 3 })), null);
  const chosen = parseProgress(JSON.stringify({ ...old, gameLength: 'hanchan', gameCpu: 'normal' }))!;
  assert.deepEqual([chosen.gameLength, chosen.gameCpu], ['hanchan', 'normal']);
});

test('a level is shown as its 級位: 10級 to 1級, then 初段, 二段 and on', () => {
  assert.deepEqual([1, 2, 10, 11, 12, 20, 21].map(rankName), ['10級', '9級', '1級', '初段', '二段', '十段', '11段']);
});
