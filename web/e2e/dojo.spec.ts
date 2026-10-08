import { expect, test, type Page } from '@playwright/test';
import {
  DOJO_REDRAW_SEED,
  DOJO_RIICHI_SEED,
  DOJO_NOYAKU_SEED,
  DOJO_CALLED_NOYAKU_SEED,
  DOJO_RIICHIWAITS_SEED,
  DOJO_SUMMON_SEED,
  DOJO_WIN_SEED,
  SEED,
  clickAndWait,
  dojoProgress,
  finishDojoGame,
  handPanel,
  isRequest,
  newDojoGame,
  nextEngineReply,
  openSettings,
  playGameToEnd,
  playOneStep,
  playToResult,
  slowEngine,
  tableState,
  waitForPlayback,
  watchEngine,
} from './helpers';
import { initialProgress, STORAGE_KEY, type DojoProgress } from '../src/dojo/progress.ts';
import { guideFor } from '../src/dojo/yakuGuide.ts';

// The dojo (?mode=dojo): the hub, the games' rewards and the shop. The
// seeds are the ones internal/apicall/e2e_seeds_test.go guards.

// Every CPU move lands at once instead of being replayed step by step.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const LEARNED = ['tanyao', 'pinfu', 'haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei', 'riichi'];

test('a first game pays its reward once, and the 立直 it buys is offered in the next game', async ({ page }) => {
  slowEngine();
  await watchEngine(page);
  await page.goto(`./?mode=dojo&seed=${SEED}`);
  await expect(page.getByTestId('dojo-level')).toHaveText('10級');
  await expect(page.getByTestId('dojo-coins')).toHaveText('0');
  await page.getByRole('link', { name: '対局開始' }).click();
  await expect(handPanel(page)).toBeVisible();
  // A reload keeps the dojo, not a plain game.
  await expect(page).toHaveURL(/mode=dojo/);
  await expect(page).toHaveURL(/[?&]game=/);
  await expect(page).not.toHaveURL(/play=/);

  // The first round and 次の局へ on the page, the rest at once.
  await playToResult(page);
  const result = page.getByRole('region', { name: '結果' });
  await clickAndWait(page, result.getByRole('button', { name: '次の局へ' }));
  await finishDojoGame(page);
  const reward = page.getByTestId('dojo-reward');
  await expect(reward).toContainText('稽古 +');
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
  await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();
  await expect(page.locator('[data-item="riichi"]')).toContainText('所持');
  await expect(page.getByTestId('dojo-yaku')).toContainText('立直');

  await page.goto(`./?mode=dojo&play=1&seed=${DOJO_RIICHI_SEED}`);
  await expect(handPanel(page)).toBeVisible();
  const riichi = page.getByRole('button', { name: 'リーチ', exact: true });
  for (let i = 0; i < 4 && !(await riichi.isVisible()); i++) await playOneStep(page);
  await expect(riichi).toBeVisible();
});

test('a redraw is restored by a reload and costs its coins once, when the game ends', async ({ page }) => {
  test.setTimeout(90_000);
  await watchEngine(page);
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

  await finishDojoGame(page);
  const reward = page.getByTestId('dojo-reward');
  await expect(reward).toContainText('引き直し 1回 -20');
  // The round of the redraw is marked: its win, if any, paid no 和了祝儀.
  await expect(page.locator('.final-rounds tbody tr').first()).toContainText('イカサマ使用');
  const delta = Number(/銭 ([+-]\d+)/.exec(await reward.innerText())![1]);
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
  // The header links to the three modes, 道場 (back to the hub) marked as this page's.
  const modes = page.locator('.app-header h1').getByRole('link');
  await expect(modes).toHaveText(['練習', 'CPU対戦', '道場']);
  await expect(modes.nth(2)).toHaveAttribute('aria-current', 'page');
  await expect(modes.nth(2)).toHaveAttribute('href', '?mode=dojo');
  // And a link of its own back to the hub (道場トップ).
  await expect(page.locator('.app-header').getByRole('link', { name: '道場トップへ戻る' })).toHaveAttribute('href', '?mode=dojo');
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
  await expect(page.getByTestId('dojo-level')).toHaveText('10級');
  expect(await page.evaluate(() => localStorage.getItem('mhj-dojo.dojo.v1.corrupt'))).toBe('{broken');
});

test('透視 shows the other seats hands only while it is on', async ({ page }) => {
  test.setTimeout(90_000);
  await newDojoGame(page, SEED, { ownedItems: ['cheat:peek'] });
  const hands = page.locator('.seat-hand[aria-label="手牌"]');
  await expect(hands).toHaveCount(0);
  // 透視 is in 設定's 表示.
  await (await openSettings(page)).getByRole('checkbox', { name: '透視' }).check();
  await page.keyboard.press('Escape');
  await expect(hands).toHaveCount(3);
  await (await openSettings(page)).getByRole('checkbox', { name: '透視' }).uncheck();
  await page.keyboard.press('Escape');
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
  await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();
  await expect(page.getByTestId('dojo-coins')).toHaveText('460');
  expect((await dojoProgress(page))?.xp).toBe(100);
});

test('the shop shows one kind of item per tab, in a list that scrolls', async ({ page }) => {
  await page.goto('./?mode=dojo');
  const tabs = page.getByRole('tablist', { name: '商品の種類' });
  await expect(tabs.getByRole('tab')).toHaveText(['役', '見た目', '補助', 'イカサマ']);
  const panel = page.getByRole('tabpanel');
  await expect(tabs.getByRole('tab', { name: '役' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('[data-item="yakuhai"]')).toBeVisible();
  await expect(panel.locator('[data-item^="theme:"]')).toHaveCount(0);

  await tabs.getByRole('tab', { name: '見た目' }).click();
  await expect(panel.locator('[data-item^="theme:"]')).toHaveCount(6);
  await expect(panel.locator('[data-item^="back:"]')).toHaveCount(3);
  await expect(panel.locator('[data-item^="cloth:"]')).toHaveCount(3);
  await expect(panel.locator('[data-item^="stick:"]')).toHaveCount(3);
  await expect(panel.locator('[data-item^="effect:"]')).toHaveCount(3);
  await expect(panel.locator('[data-item="riichi"]')).toHaveCount(0);
  // Arrow keys move between the tabs.
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: '補助' })).toBeFocused();
  await expect(panel.locator('[data-item^="assist:"]')).toHaveCount(8);
  await page.keyboard.press('ArrowRight');
  await expect(panel.locator('[data-item^="cheat:"]')).toHaveCount(6);

  // Every tab has the same height and scrolls inside the shop; the yaku tab is longer than it.
  const box = async () => panel.evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, height: el.clientHeight, full: el.scrollHeight }));
  await tabs.getByRole('tab', { name: 'イカサマ' }).click();
  const cheats = await box();
  await tabs.getByRole('tab', { name: '役' }).click();
  const yaku = await box();
  expect([cheats.overflow, yaku.overflow]).toEqual(['scroll', 'scroll']);
  expect(cheats.height).toBe(yaku.height);
  expect(yaku.full).toBeGreaterThan(yaku.height);
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

test('設定 opens a dialog with the game choice, the theme and the back, closed by Esc or 閉じる', async ({ page }) => {
  await openHub(page, { coins: 123, ownedItems: ['theme:sakura', 'back:shima'], firstGameBonus: true });
  // The game choice is in 設定, not on the hub; there is no backup.
  await expect(page.getByRole('radio', { name: '東風戦' })).toBeHidden();
  await expect(page.getByRole('button', { name: '書き出す' })).toHaveCount(0);
  const settings = page.getByRole('dialog', { name: '設定' });
  await expect(settings).toBeHidden();

  await page.getByRole('button', { name: '設定' }).click();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: '設定' }).click();
  await settings.getByRole('button', { name: '閉じる' }).click();
  await expect(settings).toBeHidden();
  // A click (or tap) outside it closes it too.
  await page.getByRole('button', { name: '設定' }).click();
  await expect(settings).toBeVisible();
  await page.mouse.click(5, 5);
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

  await expect(settings.getByRole('radio', { name: '東風戦' })).toBeChecked();
  await settings.getByRole('button', { name: '閉じる' }).click();
  await expect(settings).toBeHidden();
});

test('an owned tile back shows as 所持 in the shop, is chosen in 設定, and patterns the backs of a dojo game only', async ({ page }) => {
  test.setTimeout(90_000);
  await openHub(page, { xp: 1000, ownedItems: ['back:shima', 'back:asanoha'], firstGameBonus: true });
  await page.getByRole('tab', { name: '見た目' }).click();
  const asanoha = page.locator('[data-item="back:asanoha"]');
  await expect(asanoha).toContainText('所持');
  await expect(asanoha.getByRole('button')).toHaveCount(0);

  await page.getByRole('button', { name: '設定' }).click();
  const backs = page.getByRole('dialog', { name: '設定' }).getByRole('group', { name: '裏柄' });
  await backs.getByRole('radio', { name: '麻の葉' }).check();
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe('asanoha');
  await backs.getByRole('radio', { name: '無地' }).check();
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe(null);
  await backs.getByRole('radio', { name: '縞' }).check();
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

/** The computed style of an element of the class (in a parent of its own, when given) added to the page for the check. */
function probe(page: Page, cls: string, prop: string, pseudo: string | null = null, parent: string | null = null) {
  return page.evaluate(
    ([cls, prop, pseudo, parent]) => {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = 'リーチ';
      const box = document.createElement('section');
      if (parent) box.className = parent;
      box.append(el);
      document.body.append(box);
      const v = getComputedStyle(el, pseudo).getPropertyValue(prop);
      box.remove();
      return v;
    },
    [cls, prop, pseudo, parent] as const,
  );
}

test('the looks (cloth, riichi stick, win effect) are bought in 見た目, chosen in 設定, and shown in a dojo game only', async ({ page }) => {
  test.setTimeout(90_000);
  await openHub(page, { xp: 1000, coins: 500, firstGameBonus: true });
  await page.getByRole('tab', { name: '見た目' }).click();
  for (const id of ['cloth:midori', 'stick:tenbou', 'effect:kamifubuki']) {
    await page.locator(`[data-item="${id}"]`).getByRole('button', { name: '購入' }).click();
    await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();
    await expect(page.locator(`[data-item="${id}"]`)).toContainText('所持（設定で選ぶ）');
  }
  await expect(page.getByTestId('dojo-coins')).toHaveText(String(500 - 40 - 40 - 80));

  // 設定 offers the default and what is owned; the choice is stored and shown on <html>.
  await page.getByRole('button', { name: '設定' }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  const cloths = settings.getByRole('group', { name: '卓布' });
  await expect(cloths.getByRole('radio')).toHaveCount(2); // 標準 and 緑
  await cloths.getByRole('radio', { name: '緑' }).check();
  await expect.poll(() => htmlAttr(page, 'data-table-cloth')).toBe('midori');
  const sticks = settings.getByRole('group', { name: 'リーチ棒' });
  await expect(sticks.getByRole('radio')).toHaveCount(2);
  await sticks.getByRole('radio', { name: '千点棒' }).check();
  await expect.poll(() => htmlAttr(page, 'data-riichi-stick')).toBe('tenbou');
  const effects = settings.getByRole('group', { name: '和了演出' });
  await expect(effects.getByRole('radio')).toHaveCount(2); // なし and 紙吹雪
  await effects.getByRole('radio', { name: '紙吹雪' }).check();
  await expect.poll(() => htmlAttr(page, 'data-win-effect')).toBe('kamifubuki');
  expect(await dojoProgress(page)).toMatchObject({ activeCloth: 'cloth:midori', activeStick: 'stick:tenbou', activeEffect: 'effect:kamifubuki' });
  const sample = settings.getByLabel('見本');
  expect(await sample.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(211, 232, 214)');
  expect(await sample.locator('.seat-riichi').evaluate((el) => getComputedStyle(el, '::after').backgroundImage)).toContain('radial-gradient');
  // The chosen win effect plays over the sample (as over a result), again on 演出を見る.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const preview = sample.getByTestId('win-effect');
  await expect(preview).toHaveCSS('display', 'block');
  await expect(preview).toHaveCSS('animation-name', 'win-fall');
  await sample.getByRole('button', { name: '演出を見る' }).click();
  await expect(preview).toHaveCSS('display', 'block');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // A dojo game: the cloth under the table, the stick after a riichi badge, the
  // effect over a high win of yours, but not when motion is reduced.
  await page.goto(`./?mode=dojo&play=1&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  await expect.poll(() => htmlAttr(page, 'data-table-cloth')).toBe('midori');
  expect(await page.locator('.game-table').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(211, 232, 214)');
  expect(await probe(page, 'seat-riichi', 'background-image', '::after')).toContain('radial-gradient');
  expect(await probe(page, 'win-effect', 'display', null, 'result-panel')).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await probe(page, 'win-effect', 'display', null, 'result-panel')).toBe('block');
  expect(await probe(page, 'win-effect', 'animation-name', null, 'result-panel')).toBe('win-fall');

  // A CPU game keeps the plain table, badge and result.
  await page.goto(`./?mode=game&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  for (const attr of ['data-table-cloth', 'data-riichi-stick', 'data-win-effect']) expect(await htmlAttr(page, attr)).toBe(null);
  expect(await page.locator('.game-table').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await probe(page, 'seat-riichi', 'content', '::after')).toBe('none');
  expect(await probe(page, 'win-effect', 'display', null, 'result-panel')).toBe('none');
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

// DOJO_NOYAKU_SEED deals a closed hand tenpai in the general form at once,
// with no row of the initial yaku at shanten 0: no yaku for a ron, but a tsumo
// wins with 門前清自摸和.

/** Opens a dojo game on DOJO_NOYAKU_SEED and returns the waits the engine sends (the normal row's ukeire). */
async function noYakuGame(page: Page, progress: Partial<DojoProgress> = {}) {
  await watchEngine(page);
  const created = nextEngineReply(page, (call) => isRequest(call, 'POST', /^\/api\/games$/));
  await newDojoGame(page, DOJO_NOYAKU_SEED, progress);
  const g = (await created).data;
  await waitForPlayback(page);
  const normal = g.analysis.find((r: { key: string }) => r.key === 'normal');
  expect(normal.shanten).toBe(0);
  return normal.ukeire as string[];
}

test('役なし警告 and 待ち牌表示: a closed tenpai with no learned yaku row wins by tsumo only', async ({ page }) => {
  test.setTimeout(90_000);
  const waits = await noYakuGame(page, { ownedItems: ['assist:noyaku', 'assist:waits'] });
  const aid = page.getByTestId('dojo-waits');
  await expect(aid).toContainText('ロンでは和了れません（ツモなら門前清自摸和）');
  await expect(aid).not.toContainText('役なし');
  await expect(aid).toContainText('待ち');
  await expect(aid.locator('.tile')).toHaveCount(waits.length);
  await expect(aid.locator('.tile').first()).toHaveAttribute('aria-label', / 残り\d+枚$/);
});

test('役なし警告 with 立直 learned: 立直で和了れます', async ({ page }) => {
  test.setTimeout(90_000);
  await noYakuGame(page, { ownedItems: ['assist:noyaku', 'riichi'], ownedYaku: ['tanyao', 'pinfu', 'tsumo', 'riichi'] });
  const aid = page.getByTestId('dojo-waits');
  await expect(aid).toContainText('立直で和了れます');
  await expect(aid.locator('.tile')).toHaveCount(0); // no 待ち牌表示 bought
});

test('without the aids, a tenpai without yaku shows nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await noYakuGame(page);
  await expect(page.getByTestId('dojo-waits')).toHaveCount(0);
});

test('役なし警告 on a called hand: 役なし', async ({ page }) => {
  test.setTimeout(90_000);
  // DOJO_CALLED_NOYAKU_SEED: taking every pon offered, and tsumogiri otherwise, the open hand is
  // tenpai in the general form with no row of the initial yaku within 5 moves (e2e_seeds_test.go).
  await newDojoGame(page, DOJO_CALLED_NOYAKU_SEED, { ownedItems: ['assist:noyaku'] });
  const hand = handPanel(page);
  const aid = page.getByTestId('dojo-waits');
  const pon = page.locator('.action-bar').getByRole('button', { name: 'ポン', exact: true });
  for (let i = 0; i < 5; i++) {
    await waitForPlayback(page);
    if (await aid.isVisible()) break;
    await page.locator('.action-bar').waitFor({ state: 'visible', timeout: 15_000 });
    if (await pon.isVisible()) await clickAndWait(page, pon);
    else await playOneStep(page);
  }
  await expect(hand.getByRole('group', { name: 'ポン' }).first()).toBeVisible();
  await expect(aid).toHaveText('役なし');
});

test('リーチ者の待ち透視: a CPU in riichi shows its waits', async ({ page }) => {
  test.setTimeout(90_000);
  // DOJO_RIICHIWAITS_SEED: the seat across is in riichi at once, waiting on 4m and 西 (3z).
  await newDojoGame(page, DOJO_RIICHIWAITS_SEED, { ownedItems: ['cheat:riichiwaits'] });
  await waitForPlayback(page);
  const waits = page.locator('.seat-top').getByTestId('seat-waits');
  await expect(waits.locator('.tile')).toHaveCount(2);
  await expect(waits.locator('.tile').nth(0)).toHaveAttribute('aria-label', /^4萬/);
  await expect(waits.locator('.tile').nth(1)).toHaveAttribute('aria-label', /^西/);
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
  test.setTimeout(90_000);
  await watchEngine(page);
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

  await finishDojoGame(page);
  const reward = page.getByTestId('dojo-reward');
  await expect(reward).toContainText('牌寄せ 1回 -50');
  const delta = Number(/銭 ([+-]\d+)/.exec(await reward.innerText())![1]);
  expect((await dojoProgress(page))?.coins).toBe(Math.max(0, 200 + delta));
});

test('a won round pays its 銭 as it ends, once, even after a reload', async ({ page }) => {
  test.setTimeout(90_000);
  // DOJO_WIN_SEED: tsumogiri wins the first round by tsumo, 門前清自摸和 (1 han).
  await newDojoGame(page, DOJO_WIN_SEED, { coins: 100, firstGameBonus: true });
  await playToResult(page);
  await expect(page.getByRole('region', { name: '結果' })).toContainText('自分のツモ和了');
  await expect(page.getByTestId('dojo-round-reward')).toHaveText('道場の報酬 +20 銭（和了 +10、和了祝儀 +10）・稽古 +10');
  await expect.poll(async () => (await dojoProgress(page))?.coins).toBe(120);
  const paid = await dojoProgress(page);
  expect(Object.values(paid!.paidRounds)).toEqual([1]);

  await page.reload();
  await waitForPlayback(page);
  await expect(page.getByTestId('dojo-round-reward')).toBeVisible();
  expect(await dojoProgress(page)).toEqual(paid);
});

test('半荘戦 and the normal CPU unlock with the level, and their game pays the rank x4', async ({ page }) => {
  test.setTimeout(120_000);
  await watchEngine(page);
  const stored = (p: Partial<DojoProgress>) => JSON.stringify({ ...initialProgress(), firstGameBonus: true, ...p });
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, stored({ xp: 1000 })], // 6級
  );
  await page.goto(`./?mode=dojo&seed=${SEED}`);
  // The choice is in 設定.
  const settings = page.getByRole('dialog', { name: '設定' });
  await page.getByRole('button', { name: '設定' }).click();
  const hanchan = settings.getByRole('radio', { name: /半荘戦/ });
  const normal = settings.getByRole('radio', { name: /普通/ });
  await expect(page.getByRole('radio', { name: '東風戦' })).toBeChecked();
  await expect(hanchan).toBeEnabled();
  await expect(normal).toBeDisabled();
  await expect(settings.locator('label').filter({ has: page.getByRole('radio', { name: /普通/ }) })).toContainText('4級で解禁');
  await expect(page.getByTestId('dojo-multiplier')).toBeHidden();
  await hanchan.check();
  await expect(page.getByTestId('dojo-multiplier')).toHaveText('順位の報酬 半荘 ×2');
  expect((await dojoProgress(page))?.gameLength).toBe('hanchan');

  // 4級: the normal CPU too; both pay the rank x4.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, stored({ xp: 2100, gameLength: 'hanchan' })]);
  await page.reload();
  await page.getByRole('button', { name: '設定' }).click();
  await expect(hanchan).toBeChecked();
  await normal.check();
  await expect(page.getByTestId('dojo-multiplier')).toHaveText('順位の報酬 半荘・CPU 普通 ×4');
  expect((await dojoProgress(page))?.gameCpu).toBe('normal');
  await settings.getByRole('button', { name: '閉じる' }).click();

  await page.getByRole('link', { name: '対局開始' }).click();
  await expect(handPanel(page)).toBeVisible();
  await finishDojoGame(page);
  await expect(page.getByRole('heading', { name: '最終結果（半荘戦）' })).toBeVisible();
  await expect(page.getByTestId('dojo-reward')).toContainText(/順位 \+\d+（半荘・CPU 普通 ×4）/);
});

test('a progress without the game choice plays 東風戦 against weak CPUs, and 半荘戦 is locked below 6級', async ({ page }) => {
  const { gameLength: _l, gameCpu: _c, ...old } = initialProgress();
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(old)]);
  await page.goto('./?mode=dojo');
  await expect(page.getByRole('link', { name: '対局開始' })).toHaveAttribute('title', '東風戦、CPU は弱い');
  await page.getByRole('button', { name: '設定' }).click();
  const settings = page.getByRole('dialog', { name: '設定' });
  await expect(settings.getByRole('radio', { name: '東風戦' })).toBeChecked();
  await expect(settings.getByRole('radio', { name: /半荘戦/ })).toBeDisabled();
  await expect(settings.locator('label').filter({ has: page.getByRole('radio', { name: /半荘戦/ }) })).toContainText('6級で解禁');
  await expect(settings.getByRole('radio', { name: '弱い' })).toBeChecked();
});

test('the owned yaku list shows the dragons and the winds once, as 役牌', async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ ...initialProgress(), coins: 40, firstGameBonus: true })],
  );
  await page.goto('./?mode=dojo');
  const owned = page.getByTestId('dojo-yaku').getByRole('listitem');
  await expect(owned).toHaveText(['断么九', '平和', '門前清自摸和']);
  await page.locator('[data-item="yakuhai"]').getByRole('button', { name: '購入' }).click();
  await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();
  await expect(owned).toHaveText(['断么九', '平和', '門前清自摸和', '役牌']);
});

test('購入 asks in a dialog: キャンセル keeps the coins, 購入 buys', async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ ...initialProgress(), coins: 100, firstGameBonus: true })],
  );
  await page.goto('./?mode=dojo');
  const confirm = page.getByRole('dialog', { name: '購入しますか？' });
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: '購入' })).toBeFocused();
  await expect(confirm).toContainText('立直');
  await expect(confirm).toContainText('残り 100 → 60 銭');
  await confirm.getByRole('button', { name: 'キャンセル' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('dojo-coins')).toHaveText('100');
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await expect(confirm.getByRole('button', { name: '購入' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('dojo-coins')).toHaveText('100');
  // A click outside it does not buy either.
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await expect(confirm).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('dojo-coins')).toHaveText('100');
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '購入' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('dojo-coins')).toHaveText('60');
  await expect(page.locator('[data-item="riichi"]')).toContainText('所持');
});

test('a hub opened on a seed already settled starts a game on a random seed', async ({ page }) => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ ...initialProgress(), settled: ['42'], firstGameBonus: true })],
  );
  await page.goto('./?mode=dojo&seed=42');
  await expect(page.getByRole('link', { name: '対局開始' })).not.toHaveAttribute('href', /seed=/);
  await page.goto('./?mode=dojo&seed=43');
  await expect(page.getByRole('link', { name: '対局開始' })).toHaveAttribute('href', /seed=43/);
});

test('a whole dojo game played through the page ends on 最終結果 and pays its reward', async ({ page }) => {
  test.setTimeout(120_000);
  // The CPU moves land at once: the file's beforeEach reduces motion, which skips the playback.
  await newDojoGame(page, SEED);
  const before = await dojoProgress(page);
  await playGameToEnd(page);
  await expect(page.getByRole('region', { name: '最終結果' })).toBeVisible();
  await expect(page.getByTestId('dojo-reward')).toContainText('稽古 +');
  const paid = await dojoProgress(page);
  expect(paid?.settled).toEqual([String(SEED)]);
  expect(paid!.coins).toBeGreaterThan(before!.coins);
  expect(paid!.xp).toBeGreaterThan(before!.xp);
  // Paid once: a reload of the finished game pays nothing more.
  await page.reload();
  await expect(page.getByRole('region', { name: '最終結果' })).toBeVisible();
  expect(await dojoProgress(page)).toEqual(paid);
});

test('a dojo game opened by the CPU game URL moves to the dojo page', async ({ page }) => {
  await newDojoGame(page, SEED);
  const id = new URL(page.url()).searchParams.get('game');
  expect(id).toBeTruthy();
  await page.goto(`./?mode=game&game=${id}`);
  await expect(page).toHaveURL(/[?&]mode=dojo(&|$)/);
  await expect(page).toHaveURL(new RegExp(`[?&]game=${id}(&|$)`));
  await expect(handPanel(page)).toBeVisible();
  await expect(page.getByRole('link', { name: '道場トップへ戻る' })).toBeVisible();
});

// A yaku's guide (GuideDialog): shown on buying, and again from the chip in 所持役.
const shantenText = (s: number) => (s === 0 ? '聴牌' : `${s}向聴`);

test('buying a yaku shows its guide: condition, han, an example hand and a way to practise it', async ({ page }) => {
  await openHub(page, { xp: 5000, coins: 500, firstGameBonus: true });
  const guide = guideFor('ittsu')!;
  await page.locator('[data-item="ittsu"]').getByRole('button', { name: '購入' }).click();
  await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();

  const dialog = page.getByRole('dialog', { name: '一気通貫' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('修得しました')).toBeVisible();
  await expect(dialog).toContainText('同じ色で123・456・789の順子');
  await expect(dialog).toContainText('2翻（鳴くと1翻）');
  // 13 tiles of the hand and the winning tile, drawn with the table's tiles.
  const hand = dialog.getByRole('group', { name: '例の手' });
  await expect(hand.locator('.tile')).toHaveCount(14);
  await expect(hand.locator('.tile').last()).toHaveAccessibleName('和了牌 9萬');
  await expect(page.getByTestId('dojo-coins')).toHaveText('420');

  // 練習 opens practice mode on the seed whose hand is near the yaku: its row shows that shanten.
  const seed = guide.practice!.seed;
  await dialog.getByRole('link', { name: 'この役を練習する' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?seed=${seed}&turns=18$`));
  await expect(handPanel(page)).toBeVisible();
  const row = page.getByRole('region', { name: '役別向聴テーブル' }).locator('.yaku-table tbody tr', { hasText: '一気通貫' });
  await expect(row.locator('.shanten-cell')).toContainText(shantenText(guide.practice!.shanten));
  expect(guide.practice!.shanten).toBeLessThanOrEqual(1);
});

test('closing the guide of a bought yaku leaves focus on its chip; a purchase that fails shows no guide', async ({ page }) => {
  await openHub(page, { xp: 5000, coins: 500, firstGameBonus: true });
  await page.locator('[data-item="riichi"]').getByRole('button', { name: '購入' }).click();
  await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();
  const dialog = page.getByRole('dialog', { name: '立直' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('門前で聴牌するまでを練習します');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('dojo-yaku').getByRole('button', { name: '立直' })).toBeFocused();

  // Another tab spent the coins after the confirm dialog opened: nothing is bought, no guide.
  await page.locator('[data-item="iipeikou"]').getByRole('button', { name: '購入' }).click();
  await page.evaluate((key) => {
    const p = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...p, coins: 0 }));
  }, STORAGE_KEY);
  await page.getByRole('dialog', { name: '購入しますか？' }).getByRole('button', { name: '購入' }).click();
  await expect(page.getByRole('dialog', { name: '一盃口' })).toBeHidden();
  await expect(page.getByText('修得しました')).toBeHidden();
});

test('an owned yaku in 所持役 opens its guide again; Esc and a click outside close it', async ({ page }) => {
  await openHub(page, { ownedYaku: ['tanyao', 'pinfu', 'tsumo', 'riichi', 'haku', 'hatsu', 'chun', 'ton', 'nan', 'shaa', 'pei', 'haitei'] });
  const dialog = page.getByRole('dialog', { name: '立直' });
  await expect(dialog).toBeHidden();
  // 断么九・平和・門前清自摸和 are not sold, so they have no guide: just chips.
  await expect(page.getByTestId('dojo-yaku').getByRole('button')).toHaveText(['立直', '役牌', '海底摸月']);

  const chip = page.getByTestId('dojo-yaku').getByRole('button', { name: '立直' });
  await chip.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1翻（門前限定）');
  await expect(dialog.getByText('修得しました')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(chip).toBeFocused();

  await chip.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();

  await chip.click();
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).toBeHidden();

  // The bundle shares one guide; a yaku practice mode cannot reach has no 練習 link.
  await page.getByTestId('dojo-yaku').getByRole('button', { name: '役牌' }).click();
  const bundle = page.getByRole('dialog', { name: '役牌' });
  await expect(bundle).toContainText('白・發・中の刻子');
  await expect(bundle.getByRole('link', { name: 'この役を練習する' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('dojo-yaku').getByRole('button', { name: '海底摸月' }).click();
  const haitei = page.getByRole('dialog', { name: '海底摸月' });
  await expect(haitei).toBeVisible();
  await expect(haitei.getByRole('link', { name: 'この役を練習する' })).toHaveCount(0);
});
