import { expect, test } from '@playwright/test';
import {
  DOJO_REDRAW_SEED,
  DOJO_RIICHI_SEED,
  SEED,
  dojoProgress,
  handPanel,
  newDojoGame,
  playOneStep,
  playToFinal,
  slowEngine,
  tableState,
  waitForPlayback,
} from './helpers';

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
  const delta = Number(/コイン ([+-]\d+)/.exec(await reward.innerText())![1]);
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
  await expect(page.getByRole('link', { name: '道場へ' })).toBeVisible();
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
  await expect(panel.locator('[data-item^="theme:"]')).toHaveCount(3);
  await expect(panel.locator('[data-item="riichi"]')).toHaveCount(0);
  // Arrow keys move between the tabs.
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '補助' })).toBeFocused();
  await expect(panel.locator('[data-item^="assist:"]')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect(panel.locator('[data-item^="cheat:"]')).toHaveCount(2);

  // The yaku tab is longer than the list's height: it scrolls inside the shop.
  await tabs.getByRole('tab', { name: '役' }).click();
  const scrolls = await panel.evaluate((el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
});
