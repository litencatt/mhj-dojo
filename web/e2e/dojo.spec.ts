import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  DOJO_REDRAW_SEED,
  DOJO_RIICHI_SEED,
  DOJO_SUMMON_SEED,
  SEED,
  dojoProgress,
  handPanel,
  newDojoGame,
  onEngineReply,
  playOneStep,
  playToFinal,
  playToResult,
  slowEngine,
  tableState,
  waitForPlayback,
  watchEngine,
} from './helpers';
import { initialProgress, STORAGE_KEY, type DojoProgress } from '../src/dojo/progress.ts';

// The dojo (?mode=dojo): the hub, the games' rewards and the shop. The
// seeds are the ones internal/apicall/e2e_seeds_test.go guards.

// Every CPU move lands at once instead of being replayed step by step.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const LEARNED = ['tanyao', 'pinfu', 'haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei', 'riichi'];

test('a first game pays its reward once, and the 立直 it buys is offered in the next game', async ({ page }) => {
  slowEngine();
  test.setTimeout(600_000);
  await page.goto(`./?mode=dojo&seed=${SEED}`);
  await expect(page.getByTestId('dojo-level')).toHaveText('Lv 1');
  await expect(page.getByTestId('dojo-coins')).toHaveText('0');
  await page.getByRole('link', { name: '対局開始' }).click();
  await expect(handPanel(page)).toBeVisible();
  // A reload keeps the dojo, not a plain game.
  await expect(page).toHaveURL(/mode=dojo/);
  await expect(page).toHaveURL(/[?&]game=/);
  await expect(page).not.toHaveURL(/play=/);

  await playToFinal(page);
  const reward = page.getByTestId('dojo-reward');
  await expect(reward).toContainText('経験値 +');
  const paid = await dojoProgress(page);
  expect(paid?.settled).toEqual([String(SEED)]);
  expect(paid?.coins).toBeGreaterThanOrEqual(15 + 40); // the lowest rank's coins and the first-game bonus

  // Again after a reload: the same game pays nothing more.
  await page.reload();
  await expect(page.getByRole('region', { name: '最終結果' })).toBeVisible();
  await expect(page.getByText('この対局の報酬は受け取り済みです')).toBeVisible();
  expect(await dojoProgress(page)).toEqual(paid);

  await page.getByRole('button', { name: '道場へ戻る' }).click();
  await expect(page.getByTestId('dojo-coins')).toHaveText(String(paid!.coins));
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await expect(page.locator('[data-item="riichi"]')).toContainText('所持');
  await expect(page.getByTestId('dojo-yaku')).toContainText('立直');

  await page.goto(`./?mode=dojo&play=1&seed=${DOJO_RIICHI_SEED}`);
  await expect(handPanel(page)).toBeVisible();
  const riichi = page.getByRole('button', { name: 'リーチ', exact: true });
  for (let i = 0; i < 4 && !(await riichi.isVisible()); i++) await playOneStep(page);
  await expect(riichi).toBeVisible();
});

test('a redraw is restored by a reload and costs its coins once, when the game ends', async ({ page }) => {
  slowEngine();
  test.setTimeout(600_000);
  await newDojoGame(page, DOJO_REDRAW_SEED, {
    ownedYaku: LEARNED,
    ownedItems: ['riichi', 'cheat:redraw'],
    coins: 200,
    xp: 4500,
    firstGameBonus: true,
  });
  const redraw = page.getByRole('button', { name: /^引き直し/ });
  for (let i = 0; i < 4 && !(await redraw.isVisible()); i++) await playOneStep(page);
  await expect(redraw).toBeVisible();
  await redraw.click();
  await expect(redraw).toBeHidden();
  await waitForPlayback(page);
  const before = await tableState(page);

  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  expect(await tableState(page)).toEqual(before);
  await expect(page).toHaveURL(/mode=dojo/);
  expect((await dojoProgress(page))?.coins).toBe(200); // nothing is charged before the game ends

  await playToFinal(page);
  const reward = page.getByTestId('dojo-reward');
  await expect(reward).toContainText('引き直し 1回 -20');
  const delta = Number(/雀銭 ([+-]\d+)/.exec(await reward.innerText())![1]);
  const paid = await dojoProgress(page);
  expect(paid?.coins).toBe(200 + delta);
  await page.reload();
  await expect(page.getByRole('region', { name: '最終結果' })).toBeVisible();
  expect(await dojoProgress(page)).toEqual(paid);
});

test('a dojo game is saved apart from the CPU games and survives a reload as a dojo game', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED);
  await playOneStep(page);
  await expect(page).toHaveURL(/[?&]game=/);
  const id = new URL(page.url()).searchParams.get('game')!;
  const saves = await page.evaluate(() => ({
    games: localStorage.getItem('mhj-dojo.site.games'),
    dojo: localStorage.getItem('mhj-dojo.site.dojo-games'),
  }));
  expect(saves.dojo).toContain(id);
  expect(saves.games ?? '').not.toContain(id);

  const before = await tableState(page);
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  await expect(page).toHaveURL(/mode=dojo/);
  // The header links back to the hub only, not to the other modes.
  await expect(page.getByRole('link', { name: '道場へ戻る' })).toBeVisible();
  await expect(page.getByRole('link', { name: /練習へ|CPU対戦へ/ })).toHaveCount(0);
  expect(await tableState(page)).toEqual(before);

  // The CPU game's page offers none of the dojo's games.
  await page.goto('./?mode=game');
  await expect(handPanel(page)).toBeVisible();
  await expect(page.locator('.resume-panel')).toHaveCount(0);
  const after = await page.evaluate(() => localStorage.getItem('mhj-dojo.site.games'));
  expect(after ?? '').not.toContain(id);
});

test('the hub offers the unfinished dojo game', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED);
  await playOneStep(page);
  const id = new URL(page.url()).searchParams.get('game');
  await page.goto('./?mode=dojo');
  await page.getByRole('link', { name: /続きから/ }).click();
  await expect(handPanel(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('game')).toBe(id);
  await expect(page).toHaveURL(/mode=dojo/);
});

test('the hub offers one unfinished game, and starting anew drops it', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED);
  await playOneStep(page);
  const first = new URL(page.url()).searchParams.get('game');
  await page.goto('./?mode=dojo');
  await expect(page.getByRole('link', { name: /続きから/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: '対局開始' })).toHaveCount(0);

  await page.getByRole('link', { name: '新しく始める' }).click();
  await expect(handPanel(page)).toBeVisible();
  const second = new URL(page.url()).searchParams.get('game');
  expect(second).not.toBe(first);
  const saves = await page.evaluate(() => localStorage.getItem('mhj-dojo.site.dojo-games'));
  expect(saves ?? '').not.toContain(first);

  // Back at the hub, 続きから is the new game, the only one.
  await page.goto('./?mode=dojo');
  await page.getByRole('link', { name: /続きから/ }).click();
  await expect(handPanel(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('game')).toBe(second);
});

test('a broken progress is set aside and the dojo starts over', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mhj-dojo.dojo.v1', '{broken'));
  await page.goto('./?mode=dojo');
  await expect(page.locator('.dojo-notice')).toContainText('読み込めませんでした');
  await expect(page.getByTestId('dojo-level')).toHaveText('Lv 1');
  expect(await page.evaluate(() => localStorage.getItem('mhj-dojo.dojo.v1.corrupt'))).toBe('{broken');
});

test('透視 shows the other seats hands only while it is on', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED, { ownedItems: ['cheat:peek'] });
  const hands = page.locator('.seat-hand[aria-label="手牌"]');
  await expect(hands).toHaveCount(0);
  await page.getByLabel('透視').check();
  await expect(hands).toHaveCount(3);
  await page.getByLabel('透視').uncheck();
  await expect(hands).toHaveCount(0);
});

test('the hub follows what another tab has stored, and buys on top of it', async ({ page, context }) => {
  await page.goto('./?mode=dojo');
  await expect(page.getByTestId('dojo-coins')).toHaveText('0');
  const other = await context.newPage();
  await other.goto('./?mode=dojo');
  await other.evaluate(() => {
    const key = 'mhj-dojo.dojo.v1';
    const p = JSON.parse(localStorage.getItem(key) ?? 'null') ?? {
      version: 1, xp: 0, coins: 0, ownedYaku: ['tanyao', 'pinfu', 'haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei'],
      ownedItems: [], activeTheme: 'default', settled: [], firstGameBonus: true,
    };
    localStorage.setItem(key, JSON.stringify({ ...p, coins: 500, xp: 100 }));
  });
  await expect(page.getByTestId('dojo-coins')).toHaveText('500');
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await expect(page.getByTestId('dojo-coins')).toHaveText('460');
  expect((await dojoProgress(page))?.xp).toBe(100);
});

test('the shop shows one kind of item per tab, in a list that scrolls', async ({ page }) => {
  await page.goto('./?mode=dojo');
  const tabs = page.getByRole('tablist', { name: '商品の種類' });
  await expect(tabs.getByRole('tab')).toHaveText(['役', '牌テーマ', '補助', 'イカサマ']);
  const panel = page.getByRole('tabpanel');
  await expect(tabs.getByRole('tab', { name: '役' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('[data-item="yakuhai"]')).toBeVisible();
  await expect(panel.locator('[data-item^="theme:"]')).toHaveCount(0);

  await tabs.getByRole('tab', { name: '牌テーマ' }).click();
  await expect(panel.locator('[data-item^="theme:"]')).toHaveCount(6);
  await expect(panel.locator('[data-item^="back:"]')).toHaveCount(3);
  await expect(panel.locator('[data-item="riichi"]')).toHaveCount(0);
  // Arrow keys move between the tabs.
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '補助' })).toBeFocused();
  await expect(panel.locator('[data-item^="assist:"]')).toHaveCount(6);
  await page.keyboard.press('ArrowRight');
  await expect(panel.locator('[data-item^="cheat:"]')).toHaveCount(6);

  // The yaku tab is longer than the list's height: it scrolls inside the shop.
  await tabs.getByRole('tab', { name: '役' }).click();
  const scrolls = await panel.evaluate((el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
});

/** Opens the hub with a progress stored first (over the initial one), only while the browser has none. */
async function openHub(page: Page, progress: Partial<DojoProgress> = {}) {
  const stored = JSON.stringify({ ...initialProgress(), ...progress });
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, stored],
  );
  await page.goto('./?mode=dojo');
}

const htmlAttr = (page: Page, name: string) => page.evaluate((n) => document.documentElement.getAttribute(n), name);

test('設定 opens a dialog with the theme, the back and the backup, closed by Esc or 閉じる', async ({ page }) => {
  await openHub(page, { coins: 123, ownedItems: ['theme:sakura', 'back:shima'], firstGameBonus: true });
  // The backup is no longer a panel of the hub.
  await expect(page.getByRole('heading', { name: 'データの書き出しと読み込み' })).toBeHidden();
  const settings = page.getByRole('dialog', { name: '設定' });
  await expect(settings).toBeHidden();

  await page.getByRole('button', { name: '設定' }).click();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: '設定' }).click();
  await settings.getByRole('button', { name: '閉じる' }).click();
  await expect(settings).toBeHidden();

  // Only what is owned is offered; the choice is stored and shown.
  await page.getByRole('button', { name: '設定' }).click();
  const themes = settings.getByRole('group', { name: '牌テーマ' });
  await expect(themes.getByRole('radio')).toHaveCount(2); // 標準 and 桜
  await themes.getByRole('radio', { name: '桜' }).check();
  await expect.poll(() => htmlAttr(page, 'data-tile-theme')).toBe('sakura');
  const backs = settings.getByRole('group', { name: '裏柄' });
  await expect(backs.getByRole('radio')).toHaveCount(2); // 無地 and 縞
  await backs.getByRole('radio', { name: '縞' }).check();
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe('shima');
  const stored = await dojoProgress(page);
  expect(stored).toMatchObject({ activeTheme: 'theme:sakura', activeBack: 'back:shima' });

  // 書き出す saves the progress as it is stored.
  const download = page.waitForEvent('download');
  await settings.getByRole('button', { name: '書き出す' }).click();
  const file = await (await download).path();
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(stored);

  // 読み込む replaces it, once confirmed.
  page.once('dialog', (d) => void d.accept());
  await settings.locator('input[type="file"]').setInputFiles({
    name: 'progress.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...stored, coins: 999, activeBack: 'default' })),
  });
  await expect(settings.getByRole('status')).toContainText('読み込みました');
  await expect(page.getByTestId('dojo-coins')).toHaveText('999');
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe(null);
  await settings.getByRole('button', { name: '閉じる' }).click();
  await expect(settings).toBeHidden();
});

test('an owned tile back is chosen in the shop and patterns the backs of a dojo game only', async ({ page }) => {
  test.setTimeout(90_000);
  await openHub(page, { xp: 1000, ownedItems: ['back:shima', 'back:asanoha'], firstGameBonus: true });
  await page.getByRole('tab', { name: '牌テーマ' }).click();
  const shima = page.locator('[data-item="back:shima"]');
  const asanoha = page.locator('[data-item="back:asanoha"]');
  await asanoha.getByRole('button', { name: '使う' }).click();
  await expect(asanoha.getByRole('button', { name: '使用中' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe('asanoha');
  await asanoha.getByRole('button', { name: '使用中' }).click();
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe(null);
  await shima.getByRole('button', { name: '使う' }).click();
  expect((await dojoProgress(page))?.activeBack).toBe('back:shima');

  await page.goto(`./?mode=dojo&play=1&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe('shima');
  const back = page.locator('.seat-hand-backs .tile-back').first();
  expect(await back.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('repeating-linear-gradient');

  // A CPU game keeps the plain back.
  await page.goto(`./?mode=game&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  expect(await htmlAttr(page, 'data-tile-back')).toBe(null);
  const plain = page.locator('.seat-hand-backs .tile-back').first();
  expect(await plain.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toContain('repeating-linear-gradient');
});

test('the aids show only once bought: the ukeire per discard, the preview and the combos', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED);
  await waitForPlayback(page);
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  await expect(hand.locator('.tile-badge')).toHaveCount(0);
  await expect(page.locator('.combo-section')).toHaveCount(0);
  await hand.locator('.hand-tiles button').first().hover();
  await expect(page.locator('.preview-note')).toHaveCount(0);

  await page.evaluate((key) => {
    const p = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...p, ownedItems: ['assist:ukeire', 'assist:preview'] }));
  }, STORAGE_KEY);
  await page.reload();
  await waitForPlayback(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  // A count under every tile but the duplicates' (one per kind), the best marked.
  expect(await hand.locator('.tile-badge').count()).toBeGreaterThan(5);
  expect(await hand.locator('.tile-ukeire-best').count()).toBeGreaterThan(0);
  await expect(hand.locator('.hand-drawn button')).toHaveAttribute('aria-label', /有効牌\d+枚/);
  await expect(page.locator('.combo-section')).toHaveCount(1);
  await hand.locator('.hand-tiles button').first().hover();
  await expect(page.locator('.preview-note')).toContainText('打牌した場合のプレビュー');
});

// The engine's state is patched to tenpai with no learned yaku (役なし) on 3m-6m.
async function tenpaiWithoutYaku(page: Page) {
  await watchEngine(page);
  onEngineReply(page, (call, reply) => {
    const g = reply.data;
    if (call.fn !== 'request' || !g?.analysis?.length) return;
    for (const r of g.analysis) {
      if (r.key === 'normal') Object.assign(r, { shanten: 0, ukeire: ['3m', '6m'], ukeire_total: 6 });
      else r.shanten = r.shanten === null ? null : Math.max(1, r.shanten);
    }
  });
}

test('役なし警告 and 待ち牌表示: tenpai without a learned yaku', async ({ page }) => {
  test.setTimeout(90_000);
  await tenpaiWithoutYaku(page);
  await newDojoGame(page, SEED, { ownedItems: ['assist:noyaku', 'assist:waits'] });
  await waitForPlayback(page);
  const aid = page.getByTestId('dojo-waits');
  await expect(aid).toContainText('役なし');
  await expect(aid).not.toContainText('立直で和了れます');
  await expect(aid).toContainText('待ち');
  await expect(aid.locator('.tile[aria-label^="3萬 残り"]')).toHaveCount(1);
  await expect(aid.locator('.tile')).toHaveCount(2);
});

test('役なし警告 with 立直 learned: 立直で和了れます', async ({ page }) => {
  test.setTimeout(90_000);
  await tenpaiWithoutYaku(page);
  await newDojoGame(page, SEED, { ownedItems: ['assist:noyaku', 'riichi'], ownedYaku: ['tanyao', 'pinfu', 'riichi'] });
  await waitForPlayback(page);
  const aid = page.getByTestId('dojo-waits');
  await expect(aid).toContainText('立直で和了れます');
  await expect(aid.locator('.tile')).toHaveCount(0); // no 待ち牌表示 bought
});

test('without the aids, a tenpai without yaku shows nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await tenpaiWithoutYaku(page);
  await newDojoGame(page, SEED);
  await waitForPlayback(page);
  await expect(page.getByTestId('dojo-waits')).toHaveCount(0);
});

test('リーチ者の待ち透視: a riichi seat shows the waits the engine sends', async ({ page }) => {
  test.setTimeout(90_000);
  await watchEngine(page);
  onEngineReply(page, (call, reply) => {
    const g = reply.data;
    if (call.fn !== 'request' || !g?.seats) return;
    const s = g.seats[(g.you + 1) % 4];
    Object.assign(s, { riichi: true, waits: ['1p', '4p'] });
  });
  await newDojoGame(page, SEED, { ownedItems: ['cheat:riichiwaits'] });
  await waitForPlayback(page);
  const waits = page.locator('.seat-right').getByTestId('seat-waits');
  await expect(waits.locator('.tile')).toHaveCount(2);
  await expect(page.getByTestId('seat-waits')).toHaveCount(1);
});

test('裏ドラ透視 shows the ura dora during the round, and only once bought', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED, { ownedItems: ['cheat:ura'] });
  await waitForPlayback(page);
  const dora = page.locator('.dora-box');
  await expect(dora.locator('.tile-back')).toHaveCount(0);
  await expect(dora.getByLabel(/^裏ドラ /)).toHaveCount(1);

  await page.evaluate((key) => {
    const p = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...p, ownedItems: [] }));
  }, STORAGE_KEY);
  await page.goto(`./?mode=dojo&play=1&seed=${SEED}`);
  await waitForPlayback(page);
  await expect(dora.locator('.tile-back')).toHaveCount(1);
});

test('山読み shows the next three draws', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED, { ownedItems: ['cheat:wallpeek'] });
  await waitForPlayback(page);
  const next = page.getByTestId('dojo-next-draws');
  await expect(next.locator('.tile')).toHaveCount(3);
  await expect(next).toContainText('次のツモ（鳴きがなければ）');
});

test('牌寄せ fetches a chosen kind into the drawn tile once a round, and costs 50 coins when the game ends', async ({ page }) => {
  slowEngine();
  test.setTimeout(600_000);
  await newDojoGame(page, DOJO_SUMMON_SEED, {
    ownedYaku: LEARNED,
    ownedItems: ['riichi', 'cheat:summon'],
    coins: 200,
    xp: 4500,
    firstGameBonus: true,
  });
  const summon = page.getByRole('button', { name: /^牌寄せ/ });
  for (let i = 0; i < 4 && !(await summon.isVisible()); i++) await playOneStep(page);
  await expect(summon).toBeVisible();
  await summon.click();
  const picker = page.getByRole('group', { name: '寄せる牌' });
  // A kind other than a five, whose red copy would carry another name.
  const choice = picker.locator('button:not([aria-label^="5"])').first();
  const name = (await choice.getAttribute('aria-label'))!.replace(/を寄せる$/, '');
  await choice.click();
  await expect(summon).toBeHidden();
  await waitForPlayback(page);
  await expect(handPanel(page).locator('.hand-drawn button')).toHaveAttribute('aria-label', new RegExp(`^${name}`));
  const before = await tableState(page);

  await page.reload();
  await waitForPlayback(page);
  expect(await tableState(page)).toEqual(before);
  expect((await dojoProgress(page))?.coins).toBe(200);

  await playToFinal(page);
  const reward = page.getByTestId('dojo-reward');
  await expect(reward).toContainText('牌寄せ 1回 -50');
  const delta = Number(/雀銭 ([+-]\d+)/.exec(await reward.innerText())![1]);
  expect((await dojoProgress(page))?.coins).toBe(Math.max(0, 200 + delta));
});

test('a won round pays its 雀銭 as it ends, once, even after a reload', async ({ page }) => {
  slowEngine();
  test.setTimeout(300_000);
  // The engine's state is patched so that the first round counts 2 han for you once it ends.
  await watchEngine(page);
  onEngineReply(page, (_call, reply) => {
    const g = reply.data;
    // Every answer, a reload's restore included.
    if (!Array.isArray(g?.rounds) || g.rounds.length === 0) return;
    g.rounds[0].han = 2;
  });
  await newDojoGame(page, SEED, { coins: 100, firstGameBonus: true });
  await playToResult(page);
  await expect(page.getByTestId('dojo-round-reward')).toHaveText('道場の報酬 +20 雀銭・経験値 +20');
  await expect.poll(async () => (await dojoProgress(page))?.coins).toBe(120);
  const paid = await dojoProgress(page);
  expect(Object.values(paid!.paidRounds)).toEqual([1]);

  await page.reload();
  await waitForPlayback(page);
  await expect(page.getByTestId('dojo-round-reward')).toBeVisible();
  expect(await dojoProgress(page)).toEqual(paid);
});
