import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GameResult, GameState } from '../../src/api';

// A seed where a "tsumogiri" strategy (discard the tile you just drew; with
// no drawn tile, right after a call, discard the last hand tile), skipping
// every non-pon call offer, is offered a pon within a couple of your turns.
// Found with a small Go harness reusing internal/server/games_test.go's
// newClient()/match.State against many seeds, playing that exact strategy
// (like TestHumanPon's own seed search for a pon); see the PR description
// for how to re-derive it if game logic changes.
const SEED = 12;

const WIND: Record<string, string> = { '1z': '東', '2z': '南', '3z': '西', '4z': '北' };

/** Waits for the action POST triggered by clicking `locator` to complete,
 * so the next step never races a still-in-flight request (the UI serializes
 * requests and disables buttons while busy). This also tolerates any future
 * feature that replays CPU moves with a short animation after the response
 * lands, since later lookups still use Playwright's own auto-waiting. */
async function clickAndWait(page: Page, locator: Locator) {
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    locator.click(),
  ]);
}

/** Waits until the CPU moves have finished replaying: while they replay,
 * the action bar holds a playback スキップ button that sends no request. */
async function waitForPlayback(page: Page) {
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
}

function handPanel(page: Page) {
  return page.getByRole('region', { name: '手牌' });
}

/** One generic step: tsumo or ron when available, otherwise skip/見逃す any
 * call offer (including chii/kan, but the caller checks for pon first),
 * otherwise tsumogiri (discard the tile you just drew, or with none the
 * last hand tile). Mirrors nextMove() in games_test.go, except for the
 * discard rule, which this file's Go seed-finder used to pick SEED. */
async function playOneStep(page: Page) {
  await waitForPlayback(page);
  const actionBar = page.locator('.action-bar');
  await actionBar.waitFor({ state: 'visible', timeout: 15_000 });

  const tsumo = actionBar.getByRole('button', { name: 'ツモ', exact: true });
  const ron = actionBar.getByRole('button', { name: 'ロン', exact: true });
  const skip = actionBar.getByRole('button', { name: /^(見逃す|スキップ)$/ });
  for (const candidate of [tsumo, ron, skip]) {
    if (await candidate.isVisible()) {
      await clickAndWait(page, candidate);
      return;
    }
  }

  const hand = handPanel(page);
  const drawn = hand.locator('.hand-drawn button');
  const tile = (await drawn.count()) > 0 ? drawn : hand.locator('.hand-tiles button').last();
  await tile.waitFor({ state: 'visible', timeout: 15_000 });
  await clickAndWait(page, tile);
}

/** Plays generic steps until a pon is offered, without resolving it (unlike
 * playUntilPonTaken below): used to get two pages looking at the exact same
 * call offer before either of them acts on it. */
async function playUntilPonOffered(page: Page, maxSteps = 60) {
  const actionBar = page.locator('.action-bar');
  const result = page.getByRole('region', { name: '結果' });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await result.isVisible()) {
      throw new Error(`round ended (seed ${SEED}) before a pon was ever offered`);
    }
    await actionBar.waitFor({ state: 'visible', timeout: 15_000 });
    if (await actionBar.getByRole('button', { name: 'ポン', exact: true }).isVisible()) {
      return;
    }
    await playOneStep(page);
  }
  throw new Error(`no pon offered within ${maxSteps} steps (seed ${SEED})`);
}

/** Plays generic steps (like TestHumanPon) until a pon is offered, then
 * takes it and returns the called tile. Fails clearly if the round ends
 * (or maxSteps is exceeded) without ever offering one. */
async function playUntilPonTaken(page: Page, maxSteps = 60): Promise<string> {
  await playUntilPonOffered(page, maxSteps);
  const actionBar = page.locator('.action-bar');
  const ponButton = actionBar.getByRole('button', { name: 'ポン', exact: true });
  const calledTile = await actionBar.locator('.action-hint .tile').first().getAttribute('aria-label');
  expect(calledTile, 'the call bar should show the last-discarded tile').toBeTruthy();
  await clickAndWait(page, ponButton);
  return calledTile!;
}

/** Plays generic steps until the round's result panel appears. */
async function playToResult(page: Page, maxSteps = 150) {
  const result = page.getByRole('region', { name: '結果' });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await result.isVisible()) return;
    await playOneStep(page);
  }
  throw new Error(`round did not reach a result panel within ${maxSteps} steps`);
}

/** On a phone the round's moves run in one row, about a tile tall, scrolled
 * to the newest at the right end, and inside the page's width. */
async function expectPhoneLog(page: Page) {
  const log = page.getByRole('list', { name: 'この局の動き' });
  await expect.poll(async () => (await log.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(48);
  const box = (await log.boundingBox())!;
  const tops = await log.locator('li').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops.length).toBeGreaterThan(1);
  expect(new Set(tops).size).toBe(1);
  await expect
    .poll(() => log.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft))
    .toBeLessThanOrEqual(1);
  const last = (await log.locator('li').last().boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(last.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('a CPU game: pon offer, round result, next round, and a mobile viewport', async ({ page }) => {
  // It plays a whole round: about 17s locally, but over 30s on a busy CI runner.
  test.setTimeout(60_000);
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);

  const hand = handPanel(page);
  await expect(hand).toBeVisible();

  // Play generically until a pon is offered and take it: the called tile
  // should match what the call bar showed, and a meld should appear.
  const calledTile = await playUntilPonTaken(page);
  await expect(hand.getByRole('group', { name: 'ポン' })).toBeVisible();
  await expect(hand.locator(`.meld-called [aria-label^="${calledTile}"]`)).toBeVisible();

  // 面子表示 groups the 11 concealed tiles left after the pon.
  const toggle = hand.getByRole('button', { name: '面子表示' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(hand.locator('.hand-group').first()).toBeVisible();
  await expect(hand.locator('.hand-group .tile')).toHaveCount(11);
  await toggle.click();
  await expect(hand.locator('.hand-group')).toHaveCount(0);

  // Play the round out to its result panel, then start the next round.
  await playToResult(page);
  const result = page.getByRole('region', { name: '結果' });
  const nextRoundButton = result.getByRole('button', { name: '次の局へ' });
  await expect(nextRoundButton).toBeVisible();
  await clickAndWait(page, nextRoundButton);
  await expect(result).toBeHidden();
  await expect(hand).toBeVisible();

  // The page stays usable at a 390px-wide mobile viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: /mhj-dojo/ })).toBeVisible();
  await expect(hand).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// On a phone (360 and 390px wide) the table, the hand and the call buttons
// fit the screen: no sideways page scroll, the hand on one row with the
// called meld on a row of its own, and every action button at least 40px tall.
for (const width of [360, 390]) {
  test(`a CPU game fits a ${width}px-wide phone: one-row hand, 40px action buttons`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    const hand = handPanel(page);
    await expect(hand).toBeVisible();
    const noOverflow = async () =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBeLessThanOrEqual(0);
    const rowsOf = (locator: Locator) =>
      locator.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);

    // The call offer: ポン / スキップ (and any other) buttons are big enough to tap.
    await playUntilPonOffered(page);
    await noOverflow();
    expect(await rowsOf(hand.locator('.hand-tiles button.tile'))).toBe(1);
    const buttons = page.locator('.action-bar button');
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
    for (const b of await buttons.all()) {
      const bb = await b.boundingBox();
      expect(bb!.height).toBeGreaterThanOrEqual(40);
    }
    // Each opponent's concealed hand is one back with a count (see below).
    for (const seat of ['.seat-top', '.seat-left', '.seat-right']) {
      await expect(page.locator(`${seat} .seat-hand-count`)).toBeVisible();
    }
    // The rivers show the discards, so the log of moves is hidden; with the
    // rivers folded away, the round's moves so far run sideways in one short
    // row, the newest in sight.
    await expect(page.getByRole('list', { name: 'この局の動き' })).toBeHidden();
    await page.getByRole('button', { name: '捨て牌' }).click();
    await expectPhoneLog(page);

    // After the pon, the hand is still one row and the meld sits below it.
    await clickAndWait(page, page.locator('.action-bar').getByRole('button', { name: 'ポン', exact: true }));
    await waitForPlayback(page);
    await noOverflow();
    const tiles = hand.locator('.hand-row > .hand-tiles button.tile, .hand-row > .hand-drawn button.tile');
    expect(await rowsOf(tiles)).toBe(1);
    const meld = await hand.getByRole('group', { name: 'ポン' }).boundingBox();
    const lastTile = await tiles.last().boundingBox();
    expect(meld!.y).toBeGreaterThanOrEqual(lastTile!.y + lastTile!.height);
  });
}

// On a phone, upright or on its side, each CPU seat's face-down hand is one
// back with its count on it, beside the points, instead of a row of backs
// under them, which makes the seat shorter; a screen reader still hears
// 「手牌 13枚」.
for (const [width, height] of [[320, 640], [390, 844], [844, 390]]) {
  test(`a ${width}x${height} phone shows the CPU hands as a count`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const seats = ['.seat-top', '.seat-left', '.seat-right'];
    for (const seat of seats) {
      const hand = page.locator(`${seat} .seat-hand`);
      await expect(hand.locator('.seat-hand-backs')).toBeHidden();
      const count = hand.locator('.seat-hand-count');
      await expect(count).toBeVisible();
      await expect(count).toHaveText(/^\d+$/);
      const n = await count.innerText();
      await expect(hand.locator('.visually-hidden')).toHaveText(`手牌 ${n}枚`);
      // In the seat head, on one line with the points.
      const points = await page.locator(`${seat} .seat-points`).boundingBox();
      const box = (await count.boundingBox())!;
      expect(Math.abs(box.y + box.height / 2 - (points!.y + points!.height / 2))).toBeLessThanOrEqual(2);
    }
    const heights = () =>
      Promise.all(seats.map(async (s) => (await page.locator(s).boundingBox())!.height));
    const compact = await heights();
    // The same seats with their rows of backs back in (the desktop's) are taller.
    await page.addStyleTag({
      content: `.seat-hand-hidden .seat-hand-backs { display: flex !important }
        .seat-hand-hidden .seat-hand-count { display: none !important }
        .seat-head .seat-hand-hidden { flex-basis: 100% !important }`,
    });
    const full = await heights();
    for (let i = 0; i < seats.length; i++) expect(compact[i]).toBeLessThan(full[i]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

/** The yaku panel's own scroller, and the page's sideways overflow. */
function yakuScroller(page: Page) {
  return page.getByRole('region', { name: '役別向聴テーブル' });
}
async function pageOverflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// On a phone, as in practice, the yaku panel fills the screen under the
// header, the table and the hand, and scrolls on its own: the page stays put
// (or scrolls a little, the table and the hand then pinned to the top), so
// the hand stays in sight and nothing covers the panel.
for (const [width, height] of [[390, 844], [360, 800]]) {
  test(`a ${width}x${height} phone scrolls the yaku panel on its own, the hand staying in sight`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const hand = handPanel(page);
    const yaku = yakuScroller(page);
    await expect(hand).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.app')).toHaveAttribute('data-hand-fits', 'true');
    await expect.poll(async () => (await yaku.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(199);
    await expect.poll(() => yaku.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const panel = (await yaku.boundingBox())!;

    // A wheel over the panel scrolls the panel, not the page.
    await page.mouse.move(panel.x + panel.width / 2, panel.y + 40);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => yaku.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(hand).toBeInViewport({ ratio: 1 });

    // Scrolled to the page's end, the table and the hand stay pinned, clear
    // of the panel, which still reaches the dock bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(hand).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.game-table')).toBeInViewport({ ratio: 1 });
    const area = (await page.locator('.area-hand').boundingBox())!;
    const after = (await page.locator('.area-yaku').boundingBox())!;
    expect(area.y + area.height).toBeLessThanOrEqual(after.y + 1);
    expect(after.y + after.height).toBeLessThanOrEqual(height);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  });
}

// A CPU game on a phone (a touch screen), upright or on its side, leaves the
// chart and the glossary to practice mode: no dock bar, even with a saved
// layout that has them open, and upright the yaku panel reaches down to the
// page's bottom padding (32px) instead of the dock bar's (60px). Widened to
// a desktop the saved layout is back, and narrowed again they are gone again.
test.describe('a phone game', () => {
  test.use({ hasTouch: true });

  test('has no chart, glossary or dock; the yaku panel takes the room', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mhj-dojo.minimized.v2', '[]'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const chart = page.getByRole('region', { name: '時系列チャート' });
    const glossary = page.getByRole('region', { name: '用語表' });
    const dock = page.getByRole('navigation', { name: '最小化したパネル' });
    const expectPhone = async () => {
      await expect(chart).toHaveCount(0);
      await expect(glossary).toHaveCount(0);
      await expect(dock).toHaveCount(0);
      await expect(page.locator('.app')).not.toHaveClass(/has-dock/);
    };
    await expectPhone();
    await expect
      .poll(async () => {
        const yaku = (await page.locator('.area-yaku').boundingBox())!;
        return Math.round(844 - (yaku.y + yaku.height));
      })
      .toBe(32);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight))
      .toBe(0);

    await page.setViewportSize({ width: 844, height: 390 });
    await expectPhone();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(chart).toBeVisible();
    await expect(glossary).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectPhone();
  });

  // The yaku panel can still be minimized: then (only then) the dock bar
  // holds its tab, which brings it back.
  test('docks a minimized yaku panel, and restores it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const dock = page.getByRole('navigation', { name: '最小化したパネル' });
    const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
    await expect(dock).toHaveCount(0);
    await page.locator('.area-yaku').getByRole('button', { name: /最小化/ }).click();
    await expect(yaku).toBeHidden();
    await expect(dock.getByRole('button')).toHaveText([/役別向聴/]);
    await expect(page.locator('.app')).toHaveClass(/has-dock/);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    await dock.getByRole('button', { name: '役別向聴' }).click();
    await expect(yaku).toBeVisible();
    await expect(dock).toHaveCount(0);
    await expect(page.locator('.app')).not.toHaveClass(/has-dock/);
  });

  // A 667x375 phone on its side (under 760px wide) folds the new-game
  // options behind 設定 too: 設定 comes right before them in the focus
  // order, they open under the status, and nothing overflows.
  test('on its side at 667x375 folds the options behind 設定', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const toggle = page.getByRole('button', { name: /^設定/ });
    const form = page.locator('.new-game-form');
    await expect(toggle).toBeVisible();
    await expect(form).toBeHidden();
    await expect(page.getByRole('region', { name: '時系列チャート' })).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(form).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(form.getByRole('combobox').first()).toBeFocused();
    const status = (await page.locator('.header-status').boundingBox())!;
    const f = (await form.boundingBox())!;
    expect(f.y).toBeGreaterThanOrEqual(status.y + status.height - 1);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  });
});

// A desktop window made short (no touch screen) is no phone on its side:
// the chart and the glossary stay, in the dock.
test('a short desktop window keeps the chart and the glossary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 450 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  await expect(dock.getByRole('button')).toHaveText([/チャート/, /用語表/]);
});

// With the chart and the glossary minimized (the default), a desktop game
// keeps both in the dock.
test('a desktop game keeps the chart and the glossary in the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  await expect(dock.getByRole('button')).toHaveText([/時系列チャート/, /用語表/]);
  await dock.getByRole('button', { name: '用語表' }).click();
  await expect(page.getByRole('region', { name: '用語表' })).toBeVisible();
});

// A screen too short for the table, the hand and the panel together doesn't
// pin them, which would cover the panel: early in the round (short rivers)
// they fit and are pinned, later the page scrolls instead. Either way the
// panel scrolls on its own and, at the page's end, is in full view.
test('a 320x640 phone pins the hand only while it leaves the yaku panel room', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const app = page.locator('.app');
  const yaku = yakuScroller(page);
  const check = async (fits: 'true' | 'false') => {
    await waitForPlayback(page);
    await expect(app).toHaveAttribute('data-hand-fits', fits);
    await expect(page.locator('.area-hand')).toHaveCSS('position', fits === 'true' ? 'sticky' : 'static');
    await expect.poll(() => yaku.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(yaku).toBeInViewport({ ratio: 1 });
    const area = (await page.locator('.area-hand').boundingBox())!;
    const panel = (await page.locator('.area-yaku').boundingBox())!;
    expect(area.y + area.height).toBeLessThanOrEqual(panel.y + 1);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  await check('true');
  // A few turns fill the rivers: the table and the hand outgrow the room.
  for (let i = 0; i < 20; i++) {
    await playOneStep(page);
    await waitForPlayback(page);
    if ((await app.getAttribute('data-hand-fits')) === 'false') break;
  }
  await check('false');
});

// On a phone 捨て牌 ▴/▾ folds the other seats' rivers away (your own, in
// the hand panel, stays), leaving each seat its head, and the yaku panel the room; the log
// of moves stands in for them meanwhile. The choice survives a reload.
test('a phone folds the other seats\' rivers away with 捨て牌, and remembers it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  // A turn round the table: every river has a tile (an empty one isn't shown).
  await playOneStep(page);
  await waitForPlayback(page);
  const toggle = page.getByRole('button', { name: '捨て牌' });
  const cpuRivers = ['#river-top', '#river-left', '#river-right'];
  const expectShown = async (shown: boolean) => {
    await expect(toggle).toHaveAttribute('aria-expanded', String(shown));
    for (const r of cpuRivers) {
      if (shown) await expect(page.locator(r)).toBeVisible();
      else await expect(page.locator(r)).toBeHidden();
    }
    await expect(handPanel(page).locator('[aria-label="自分の捨て牌"]')).toBeVisible();
    for (const seat of ['.seat-top', '.seat-left', '.seat-right']) {
      await expect(page.locator(`${seat} .seat-points`)).toBeVisible();
      await expect(page.locator(`${seat} .seat-hand-count`)).toBeVisible();
    }
  };
  await expectShown(true);
  // Only a choice is saved, not the default.
  expect(await page.evaluate(() => localStorage.getItem('mhj-dojo.rivers.v1'))).toBeNull();
  expect((await toggle.getAttribute('aria-controls'))!.split(' ').sort()).toEqual(['river-left', 'river-right', 'river-top']);
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  const log = page.getByRole('list', { name: 'この局の動き' });
  await expect(log).toBeHidden();
  const yakuTop = async () => (await page.locator('.area-yaku').boundingBox())!.y;
  const before = await yakuTop();

  await toggle.click();
  await expectShown(false);
  // The log is back, under the round's row with 捨て牌 in it.
  await expect(log).toBeVisible();
  const t = (await toggle.boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual((await log.boundingBox())!.y);
  // The table got shorter (by less than the rivers, the log taking a row),
  // and the yaku panel starts higher.
  await expect.poll(yakuTop).toBeLessThan(before - 10);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  await page.reload();
  await waitForPlayback(page);
  await expectShown(false);

  await toggle.click();
  await expectShown(true);
  await page.reload();
  await waitForPlayback(page);
  await expectShown(true);
});

// An upright phone stacks the CPU seats at the table's full width, 対面,
// 上家 then 下家, over the round's row; your seat is in the hand panel (see
// below). A seat with nothing under its head (before its first discard)
// ends at its head.
test('an upright phone stacks the CPU seats at the full width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  await expect(page.locator('.seat-bottom')).toBeHidden();
  // Seed 12 deals you the first turn: no CPU has discarded yet.
  await expect(page.locator('#river-top')).toBeHidden();
  const seat = await box('.seat-top');
  const head = await box('.seat-top .seat-head');
  expect(seat.y + seat.height - (head.y + head.height)).toBeLessThanOrEqual(5);

  for (let i = 0; i < 4; i++) await playOneStep(page);
  await waitForPlayback(page);
  const table = await box('.game-table');
  const rows = await Promise.all(['.seat-top', '.seat-left', '.seat-right', '.table-center'].map(box));
  expect(rows[0].width).toBeGreaterThan(table.width - 16);
  for (const r of rows) {
    expect(Math.abs(r.x - rows[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.width - rows[0].width)).toBeLessThanOrEqual(1);
  }
  for (let i = 1; i < rows.length; i++) expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height);
  expect(rows[3].y + rows[3].height).toBeLessThanOrEqual(table.y + table.height);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  // Your turn marks the hand panel, as your seat's box was marked.
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  await expect(hand).toHaveClass(/hand-acting/);
  const accent = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(hand).toHaveCSS('border-color', accent);
  // Not while the CPU moves play back.
  await clickAndWait(page, hand.locator('.hand-drawn button'));
  await expect(hand).not.toHaveClass(/hand-acting/);
});

// On an upright phone your seat leaves the table for the hand panel: its
// wind (red for the dealer), points, rank and riichi on one line beside
// 手牌, 面子表示 still in view, and its river (the riichi tile sideways)
// under the hand. Called melds sit on a row of their own from the hand's
// left edge, in the hand's tile size, so four fit on one row. The response
// is patched with a riichi and four melds, whatever the seed deals.
test('an upright phone shows your seat in the hand panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  for (let i = 0; i < 4; i++) await playOneStep(page);
  await waitForPlayback(page);
  let st: GameState | null = null;
  await page.route('**/api/games/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const s = (await response.json()) as GameState;
    const me = s.seats[s.you];
    me.riichi = true;
    me.river[1].riichi = true;
    me.melds = [
      { type: 'pon', tiles: ['5z', '5z', '5z'], from: (s.you + 1) % 4, added: false },
      { type: 'chii', tiles: ['2s', '3s', '1s'], from: (s.you + 3) % 4, added: false },
      { type: 'kan', tiles: ['7p', '7p', '7p', '7p'], from: (s.you + 2) % 4, added: true },
      { type: 'ankan', tiles: ['9m', '9m', '9m', '9m'], from: -1, added: false },
    ];
    me.hand = me.hand!.slice(12);
    st = s;
    await route.fulfill({ response, json: s });
  });
  await page.reload();
  await waitForPlayback(page);
  const state = st!;
  const me = state.seats[state.you];
  const hand = handPanel(page);
  await expect(page.locator('.seat-bottom')).toBeHidden();
  const river = hand.locator('[aria-label="自分の捨て牌"]');
  await expect(river.locator('.tile')).toHaveCount(me.river.length);
  await expect(river.locator('.river-riichi')).toHaveCount(1);
  const status = hand.locator('.hand-status');
  await expect(status.locator('.seat-wind')).toHaveText(WIND[me.wind]);
  expect(await status.locator('.seat-wind').evaluate((e) => e.classList.contains('seat-dealer'))).toBe(
    state.dealer === state.you,
  );
  await expect(status.locator('.seat-points')).toHaveText(me.points.toLocaleString());
  await expect(status.locator('.seat-rank')).toHaveText(`${state.standings[state.you].rank}位`);
  await expect(status.locator('.seat-riichi')).toHaveText('リーチ');

  for (const [width, height] of [[390, 844], [360, 800], [320, 640]]) {
    await page.setViewportSize({ width, height });
    const heading = (await hand.locator('.hand-heading').boundingBox())!;
    const s = (await status.boundingBox())!;
    const toggle = (await hand.getByRole('button', { name: '面子表示' }).boundingBox())!;
    expect(s.height, `${width}px`).toBeLessThanOrEqual(24);
    expect(s.x + s.width).toBeLessThanOrEqual(toggle.x);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(heading.x + heading.width + 0.5);
    expect(await status.evaluate((e) => e.scrollWidth <= e.clientWidth), `${width}px: the status is not clipped`).toBe(true);
    // The melds: one row, from the hand's left edge, in its tile size.
    const melds = hand.locator('.hand-row > .melds');
    const bottoms = await melds
      .locator('.meld')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
    expect(bottoms).toHaveLength(4);
    expect(new Set(bottoms).size, `${width}px: four melds on one row`).toBe(1);
    const first = (await hand.locator('.hand-tiles').boundingBox())!;
    expect(Math.abs((await melds.boundingBox())!.x - first.x)).toBeLessThanOrEqual(1);
    const handTile = (await hand.locator('.hand-tiles .tile').first().boundingBox())!;
    const meldTile = (await melds.locator('.meld > .tile').first().boundingBox())!;
    expect(Math.abs(meldTile.width - handTile.width)).toBeLessThanOrEqual(0.5);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  }
});

// On an upright phone the rivers show every discard, so the log of moves is
// hidden while they are shown; with them folded away it stands in for them,
// scrolled to the newest, moves made while it was hidden included.
test('an upright phone shows the log of moves only with the rivers folded away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const log = page.getByRole('list', { name: 'この局の動き' });
  const toggle = page.getByRole('button', { name: '捨て牌' });
  for (let i = 0; i < 6; i++) await playOneStep(page);
  await waitForPlayback(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(log).toBeHidden();
  expect(await page.locator('.event-log li').count()).toBeGreaterThan(12);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expectPhoneLog(page);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  // It keeps the newest in sight as moves land.
  await playOneStep(page);
  await waitForPlayback(page);
  await expectPhoneLog(page);

  await toggle.click();
  await expect(log).toBeHidden();
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
});

// A phone on its side and a desktop keep 上家 and 下家 side by side, your
// seat at the table, and the log of moves with the rivers shown.
for (const [width, height] of [[844, 390], [1280, 900]]) {
  test(`a ${width}x${height} screen keeps 上家 and 下家 side by side, your seat and the log`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    for (let i = 0; i < 2; i++) await playOneStep(page);
    await waitForPlayback(page);
    await expect(page.locator('.game-table')).toHaveAttribute('data-rivers', 'shown');
    const left = (await page.locator('.seat-left').boundingBox())!;
    const right = (await page.locator('.seat-right').boundingBox())!;
    expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
    expect(left.x + left.width).toBeLessThanOrEqual(right.x);
    await expect(page.locator('#river-left')).toBeVisible();
    await expect(page.getByRole('list', { name: 'この局の動き' })).toBeVisible();
    // Your seat stays at the table, not in the hand panel.
    await expect(page.locator('.seat-bottom .seat-points')).toBeVisible();
    await expect(page.locator('.seat-bottom .seat-river')).toBeVisible();
    await expect(page.locator('.hand-status')).toBeHidden();
    await expect(page.locator('.hand-river')).toBeHidden();
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  });
}

// A desktop has no 捨て牌 toggle, and shows every river even with the phone's
// choice saved as hidden.
test('a desktop always shows the rivers, with no 捨て牌 toggle', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mhj-dojo.rivers.v1', 'hidden'));
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  await expect(page.getByRole('button', { name: '捨て牌' })).toBeHidden();
  for (const r of ['#river-top', '#river-left', '#river-right']) {
    await expect(page.locator(r)).toHaveCSS('display', 'grid');
  }
});

// A desktop keeps the row of backs.
test('a desktop shows the CPU hands as rows of backs', async ({ page }) => {
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const hand = page.locator('.seat-top .seat-hand');
  await expect(hand.locator('.seat-hand-count')).toBeHidden();
  await expect(hand.locator('.seat-hand-backs .tile')).not.toHaveCount(0);
  await expect(hand.locator('.seat-hand-backs .tile').first()).toBeVisible();
  // Nothing pinned: the columns scroll as before.
  await expect(page.locator('.area-hand')).toHaveCSS('position', 'static');
});

// On a phone the header is short: the new-game options fold behind 「設定」,
// the status is one or two dense lines and the dora tiles are small.
for (const [width, height, maxHeader] of [[320, 640, 150], [360, 800, 130], [390, 844, 130]]) {
  test(`a ${width}px-wide phone folds the new-game options behind 設定`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const header = page.locator('.app-header');
    const form = page.locator('.new-game-form');
    const toggle = page.getByRole('button', { name: /^設定/ });
    await expect(form).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(maxHeader);
    // The status stays in view, and 設定 is easy to tap.
    await expect(page.locator('.game-status')).toBeVisible();
    await expect(page.locator('.dora-box')).toBeVisible();
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    expect((await page.locator('.dora-indicators .tile').first().boundingBox())!.height).toBeLessThanOrEqual(24);

    // Open: the options under the status, 新規対局 still a big button.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(form).toBeVisible();
    await expect(form.getByRole('combobox')).toHaveCount(3);
    expect((await form.boundingBox())!.y).toBeGreaterThan((await toggle.boundingBox())!.y);
    expect((await form.getByRole('button', { name: '新規対局' }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
    await toggle.click();
    await expect(form).toBeHidden();
  });
}

// 設定 comes right before its options in the focus order: Tab goes from it
// into them. Escape folds them away, and so does a new game once it is on,
// focus going back to 設定 either way; a new game that fails keeps them
// open, as chosen.
test('a phone\'s 設定: Tab into the options, Escape and a new game fold them back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const toggle = page.getByRole('button', { name: /^設定/ });
  const form = page.locator('.new-game-form');
  const length = form.getByRole('combobox').first();

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(form).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(length).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // A failed request keeps the options, as chosen.
  await page.keyboard.press('Enter');
  await length.selectOption('hanchan');
  await page.route('**/api/games', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 500, body: 'boom' }) : route.continue(),
  );
  await form.getByRole('button', { name: '新規対局' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.error-banner')).toBeVisible();
  await expect(form).toBeVisible();
  await expect(length).toHaveValue('hanchan');

  // A new game folds them away, focus back on 設定.
  await page.unroute('**/api/games');
  await form.getByRole('button', { name: '新規対局' }).focus();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/games')),
    page.keyboard.press('Enter'),
  ]);
  await expect(form).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator('.game-status')).toContainText('半荘戦');
});

// A desktop (and a phone on its side) shows the options with the title,
// above the status, though they come after it in the page.
for (const [width, height] of [[1280, 900], [844, 390]]) {
  test(`a ${width}x${height} screen keeps the new-game options above the status`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    await expect(page.locator('.new-game-form')).toBeVisible();
    const form = (await page.locator('.new-game-form').boundingBox())!;
    const status = (await page.locator('.header-status').boundingBox())!;
    const title = (await page.locator('.app-header h1').boundingBox())!;
    expect(form.y).toBeGreaterThanOrEqual(title.y);
    expect(form.y + form.height).toBeLessThanOrEqual(status.y);
  });
}

// The log keeps the newest move in sight only while it is there: a player
// reading earlier moves isn't taken to the end by the next ones.
test('the log of moves stays where a player scrolled it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const log = page.getByRole('list', { name: 'この局の動き' });
  const gap = () => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  for (let i = 0; i < 4; i++) await playOneStep(page);
  await waitForPlayback(page);
  expect(await log.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(gap).toBeLessThanOrEqual(1);
  const count = await log.locator('li').count();
  await log.evaluate((el) => (el.scrollTop = 0));
  await playOneStep(page);
  await waitForPlayback(page);
  await expect(log.locator('li')).not.toHaveCount(count);
  expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
  // Back at the end, it follows again.
  await log.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await playOneStep(page);
  await waitForPlayback(page);
  await expect.poll(gap).toBeLessThanOrEqual(1);
});

// At a round's end, on a phone upright or on its side, every CPU seat's
// revealed hand, melds and river fit the seat: the rivers wrap at the seat's
// width (more than six to a row) in 15px tiles. The log of moves (upright
// only with the rivers folded away) stays one row with the newest (the win)
// in sight, its word shown where a plain discard's 打 is only read out.
test('a phone fits the revealed hands and the rivers in their seats', async ({ page }) => {
  // It plays a whole round.
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await playToResult(page);
  const seats = ['.seat-top', '.seat-left', '.seat-right', '.seat-bottom'];
  for (const [width, height] of [[390, 844], [360, 800], [320, 640], [844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const seat of seats.slice(0, 3)) {
      await expect(page.locator(`${seat} .seat-hand[aria-label="手牌"]`)).toBeVisible();
    }
    const outside = await page.evaluate((sel) => {
      const out: string[] = [];
      for (const s of sel) {
        const box = document.querySelector(s)!.getBoundingClientRect();
        for (const el of document.querySelectorAll(`${s} .seat-hand, ${s} .melds, ${s} .seat-river, ${s} .tile`)) {
          const r = el.getBoundingClientRect();
          if (r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push(`${s} ${el.className}`);
        }
      }
      return out;
    }, seats);
    expect(outside, `${width}x${height}`).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
    const river = page.locator('.seat-top .seat-river');
    const tile = river.locator('.river-tile:not(.river-riichi) .tile').first();
    expect((await tile.boundingBox())!.width).toBeLessThanOrEqual(15);
    // The first row holds more than a desktop's six tiles.
    const tops = await river
      .locator('.river-tile')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops.length).toBeGreaterThan(6);
    expect(tops.filter((t) => t === tops[0]).length).toBeGreaterThan(6);
    if (height > 500) {
      const toggle = page.getByRole('button', { name: '捨て牌' });
      await expect(page.getByRole('list', { name: 'この局の動き' })).toBeHidden();
      await toggle.click();
      await expectPhoneLog(page);
      await toggle.click();
    } else {
      await expectPhoneLog(page);
    }
  }
  const entries = page.getByRole('list', { name: 'この局の動き' }).getByRole('listitem');
  const win = entries.last().locator('.event-verb');
  await expect(win).toHaveText(/^(ツモ|ロン)$/);
  await expect(win).toBeVisible();
  const discard = entries.filter({ has: page.locator('.event-verb-discard') }).first();
  await expect(discard).toHaveText(/^(自分|下家|対面|上家)打/);
  expect((await discard.locator('.event-verb').boundingBox())!.width).toBeLessThanOrEqual(1);
});

// A desktop keeps the new-game options in the header, and the rivers at six
// 18px tiles to a row.
test('a desktop keeps the header options and six-tile rivers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  await expect(page.locator('.new-game-form')).toBeVisible();
  await expect(page.locator('.options-toggle')).toBeHidden();
  const river = page.locator('.seat-river').first();
  expect(await river.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(6);
  await expect(page.locator('.dora-indicators .tile').first()).toHaveCSS('width', '26px');
  await expect(page.locator('.seat-box .tile-xs').first()).toHaveCSS('width', '18px');
  // The log of moves: one move to a row.
  const tops = await page
    .locator('.event-log li')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(tops.length);
});

test('game options from the URL: first dealer you and a weak CPU survive a reload', async ({ page }) => {
  await page.goto(`/?mode=game&seed=${SEED}&first_dealer=you&cpu=weak`);
  await waitForPlayback(page);
  const status = page.locator('.game-status');
  const expectOptions = async () => {
    await expect(status).toContainText('東1局');
    await expect(status.locator('div').filter({ hasText: '自風' }).locator('dd')).toHaveText('東');
    await expect(status.locator('div').filter({ hasText: 'CPU' }).locator('dd')).toHaveText('弱い');
    await expect(page.getByLabel('起家')).toHaveValue('you');
    await expect(page.getByLabel('CPU')).toHaveValue('weak');
    await expect(page).toHaveURL(/[?&]first_dealer=you(&|$)/);
    await expect(page).toHaveURL(/[?&]cpu=weak(&|$)/);
    await expect(page).toHaveURL(/[?&]game=/);
  };
  await expectOptions();
  const url = page.url();
  await page.reload();
  await waitForPlayback(page);
  await expectOptions();
  expect(page.url(), 'the reload resumes the same game').toBe(url);
});

// Two browsers on the same game (two tabs of one browser would stop each
// other, see below).
test('a stale browser: acting after another browser moved the game on shows a notice, not an error', async ({
  page,
  browser,
}) => {
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const hand = handPanel(page);
  await expect(hand).toBeVisible();

  // Get page A to a pon offer, but don't resolve it yet.
  await playUntilPonOffered(page);
  const actionBarA = page.locator('.action-bar');
  const ponButtonA = actionBarA.getByRole('button', { name: 'ポン', exact: true });
  await expect(ponButtonA).toBeVisible();

  // Page B: the same game, fetched fresh - it sees the same offer.
  const gameId = new URL(page.url()).searchParams.get('game');
  expect(gameId, 'the URL should carry the server-assigned game id').toBeTruthy();
  const pageB = await (await browser.newContext()).newPage();
  await pageB.goto(`/?mode=game&game=${gameId}`);
  const actionBarB = pageB.locator('.action-bar');
  const ponButtonB = actionBarB.getByRole('button', { name: 'ポン', exact: true });
  await expect(ponButtonB).toBeVisible();

  // Page A skips the call: the offer's window is now closed for every seat,
  // including the human's, whichever tab acts.
  const skipButtonA = actionBarA.getByRole('button', { name: /^(見逃す|スキップ)$/ });
  await clickAndWait(page, skipButtonA);
  await waitForPlayback(page);

  // Page B, unaware, calls pon on its now-stale offer: the server rejects
  // it (409, the offer is gone), the client re-fetches, sees the game
  // really did move on (a different phase/actor/event count), and shows a
  // notice instead of the raw error.
  await Promise.all([
    pageB.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    ponButtonB.click(),
  ]);
  await expect(pageB.locator('.notice-banner')).toBeVisible({ timeout: 15_000 });
  await expect(pageB.locator('.error-banner')).toBeHidden();
  await waitForPlayback(pageB);
  await pageB.context().close();
});

// One tab of a browser at a time plays a game (src/singleTab.ts): the
// newest tab to open it wins, and the one before stops until taken back.
function stoppedDialog(page: Page) {
  return page.getByRole('alertdialog', { name: 'このタブは別のタブで開かれたため停止しました' });
}

/** The dialog covers the page: shown modal, so everything else is inert. */
async function expectStopped(page: Page) {
  await expect(stoppedDialog(page)).toBeVisible();
  expect(await stoppedDialog(page).evaluate((d) => d.matches(':modal'))).toBe(true);
}

// Every river, your hand and the status line.
async function tableState(page: Page) {
  const labels = (sel: string) =>
    page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  return {
    rivers: await Promise.all(
      ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'].map((s) => labels(`${s} .seat-river .tile`)),
    ),
    hand: await labels('.area-hand .hand-row .tile'),
    status: await page.locator('.game-status').innerText(),
  };
}

test('a second tab on the same game stops the first, until taken back', async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await waitForPlayback(page);
  await expect(page).toHaveURL(/[?&]game=/);
  const other = await context.newPage();
  await other.emulateMedia({ reducedMotion: 'reduce' });
  await other.goto(page.url());
  await waitForPlayback(other);
  await expect(handPanel(other)).toBeVisible();

  await expectStopped(page);
  await expect(stoppedDialog(other)).toHaveCount(0);

  // B plays on.
  await playOneStep(other);
  await playOneStep(other);
  await waitForPlayback(other);
  const b = await tableState(other);

  // A takes it back, from where B left it; now B stops.
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(stoppedDialog(page)).toHaveCount(0);
  await waitForPlayback(page);
  await expect.poll(() => tableState(page)).toEqual(b);
  await expectStopped(other);
  await playOneStep(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// While the CPU moves replay, the table's numbers follow the step shown, not
// the response's final values: the wall after each move (its
// wall_remaining), a riichi's stick leaving the seat's points for the
// deposit, a kan dora turned over (new_dora_indicators), and the log of the
// round's moves growing by one. The playback clock is Playwright's, so each
// step is looked at in turn; the response is patched with a riichi and a kan
// dora so the steps check those too, whatever the seed deals.
test('the table follows the CPU playback step by step, and スキップ jumps to the end', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  let patched: GameState | null = null;
  let riichiAt = -1;
  await page.route('**/api/games/*/action', async (route) => {
    const response = await route.fetch();
    const state = (await response.json()) as GameState;
    if (patched === null) {
      // The first CPU discard becomes an accepted riichi, and the last move
      // turns a kan dora over.
      riichiAt = state.events.findIndex((e, i) => i > 0 && e.type === 'discard');
      const e = state.events[riichiAt];
      if (riichiAt > 0 && riichiAt < state.events.length - 1) {
        e.type = 'riichi';
        state.seats[e.seat].riichi = true;
        state.seats[e.seat].points -= 1000;
        state.deposit += 1000;
        state.events[state.events.length - 1].new_dora_indicators = ['1m'];
        state.dora_indicators.push('1m');
        state.dora.push('2m');
      }
      patched = state;
    }
    await route.fulfill({ response, json: state });
  });

  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  // The clock stands still: skip the CPU turns before your first, if any.
  if ((await table.getAttribute('data-playing')) === 'true') {
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  const log = page.locator('.event-log li');
  const earlier = await log.count();

  // From here the page's time only moves with runFor: effects (run on an
  // animation frame) and each playback step.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await clickAndWait(page, hand.locator('.hand-drawn button'));
  await page.clock.runFor(50);
  const st = patched as GameState | null;
  expect(st, 'the action response').not.toBeNull();
  const { events } = st!;
  expect(riichiAt, `a CPU discard before the last move (seed ${SEED})`).toBeGreaterThan(0);
  expect(riichiAt).toBeLessThan(events.length - 1);
  expect(st!.events_from, 'the log so far is the round before this response').toBe(earlier);

  const seatClass = ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'];
  const riichiSeat = events[riichiAt].seat;
  const riichiPoints = page.locator(`${seatClass[(riichiSeat - st!.you + 4) % 4]} .seat-points`);
  const deposit = page.locator('.table-deposit');
  const doraTiles = page.locator('.dora-box dd').first().locator('.tile');
  const finalDora = st!.dora_indicators.length;
  const sticks = (d: number) => (d > 0 ? `供託 ${d / 1000}本` : null);

  // Your own discard shows at once; each CPU move follows PLAYBACK_STEP_MS later.
  for (let step = 1; step < events.length; step++) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    await expect(log).toHaveCount(earlier + step);
    await expect(page.locator('.table-remaining')).toHaveText(`残り ${events[step - 1].wall_remaining}`);
    const accepted = step > riichiAt;
    const points = st!.seats[riichiSeat].points + (accepted ? 0 : 1000);
    await expect(riichiPoints).toHaveText(points.toLocaleString());
    const d = sticks(st!.deposit - (accepted ? 0 : 1000));
    if (d) await expect(deposit).toHaveText(d);
    else await expect(deposit).toHaveCount(0);
    await expect(doraTiles).toHaveCount(2 * (finalDora - 1));
    await page.clock.runFor(350);
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(log).toHaveCount(earlier + events.length);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${st!.wall_remaining}`);
  await expect(riichiPoints).toHaveText(st!.seats[riichiSeat].points.toLocaleString());
  await expect(deposit).toHaveText(sticks(st!.deposit)!);
  await expect(doraTiles).toHaveCount(2 * finalDora);

  // The next response: スキップ right away shows its final values.
  const move =
    st!.phase === 'discard'
      ? hand.locator('.hand-drawn button, .hand-tiles button').last()
      : page.locator('.action-bar').getByRole('button', { name: /^(見逃す|スキップ)$/ });
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    move.click(),
  ]);
  const next = (await response.json()) as GameState;
  await page.clock.runFor(50);
  if (next.events.length > 1) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    // After skipping a call the CPUs move first: the wall before them.
    const lead = next.events[0].seat === next.you ? next.events[0].wall_remaining : next.events_wall_remaining;
    await expect(page.locator('.table-remaining')).toHaveText(`残り ${lead}`);
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${next.wall_remaining}`);
  await expect(log).toHaveCount(next.events_from + next.events.length);
});

// A hidden tab has nobody to show the steps to: the playback jumps to the end.
test('the playback jumps to the end when the tab is hidden', async ({ page }) => {
  await page.clock.install();
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  if ((await table.getAttribute('data-playing')) === 'true') {
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();

  // The clock stands still, so the playback stays at its first step until the tab hides.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    hand.locator('.hand-drawn button').click(),
  ]);
  const st = (await response.json()) as GameState;
  expect(st.events.length, `CPU moves after your discard (seed ${SEED})`).toBeGreaterThan(1);
  await page.clock.runFor(50);
  await expect(table).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + 1);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + st.events.length);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${st.wall_remaining}`);
});

// A tab hidden before the response lands never starts the steps at all.
test('the playback starts at its end when the tab is already hidden', async ({ page }) => {
  await page.clock.install();
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  if ((await table.getAttribute('data-playing')) === 'true') {
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();

  // The clock stands still: only the hidden tab can end the playback.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    hand.locator('.hand-drawn button').click(),
  ]);
  const st = (await response.json()) as GameState;
  expect(st.events.length, `CPU moves after your discard (seed ${SEED})`).toBeGreaterThan(1);
  await page.clock.runFor(50);
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + st.events.length);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${st.wall_remaining}`);
});

// A game whose first dealer is a CPU opens with the CPU turns before yours:
// before the first of them lands, the wall is the one they started from.
const CPU_DEALS = 13; // a seed whose first dealer is not you
test('the wall before the first CPU move of a round', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  const created = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/games',
  );
  await page.goto(`/?mode=game&seed=${CPU_DEALS}&first_dealer=random&length=tonpuu`);
  // Effects run on an animation frame: step the paused clock a frame at a
  // time until the game is dealt and the table is up, well short of the
  // first playback step.
  const table = page.locator('.game-table');
  await expect
    .poll(async () => {
      await page.clock.runFor(16);
      return table.count();
    })
    .toBe(1);
  const first = (await (await created).json()) as GameState;
  if (first.events.length === 0 || first.events[0].seat === first.you) {
    throw new Error(`seed ${CPU_DEALS}: you deal first`);
  }
  await expect(table).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.event-log li')).toHaveCount(0);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${first.events_wall_remaining}`);
  await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${first.wall_remaining}`);
});

// playbackState works the table out backwards from a response's final
// state: the round result's deltas come off first (the settlement shows only
// once the playback ends), then each accepted riichi still to play gives its
// stick back. These tests patch your first action's response (your discard,
// then three CPU discards) into a round that ends in it, then check each
// step's points, deposit and ranks, and the final values once it is over.
const SEAT_BOXES = ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'];
const START = [25000, 25000, 25000, 25000];

/** Ranks by points, ties to the seat nearer the first dealer. */
function ranksOf(points: number[], firstDealer: number): number[] {
  const near = (s: number) => (s - firstDealer + 4) % 4;
  const order = [0, 1, 2, 3].sort((a, b) => points[b] - points[a] || near(a) - near(b));
  return [0, 1, 2, 3].map((s) => order.indexOf(s) + 1);
}

interface RoundEnd {
  // Turns the real response into the patched one; `cpus` are the seats of
  // the three CPU discards, in order (events 1-3).
  patch: (st: GameState, cpus: number[]) => void;
  // The points and deposit shown with `step` events played.
  during: (step: number) => { points: number[]; deposit: number };
  ranks?: number[]; // the ranks at every step, if not by ranksOf
}

/** Ends the round in `st`: the result, the final points and deposit. */
function endRound(st: GameState, result: Partial<GameResult>, deltas: number[], deposit: number) {
  const zero = [0, 0, 0, 0];
  st.result = {
    kind: 'ron', winner: -1, from: -1, win_tile: null, yaku: [], han: 0, fu: 0, dora: 0, ura_dora: 0,
    points: { limit: '', multiplier: 0, total: 0 }, deltas, hand_deltas: deltas, honba_deltas: zero,
    stick_deltas: zero, honba: st.honba, tenpai: [false, false, false, false], deposit: 0, pao: [],
    ...result,
  };
  st.phase = 'ended';
  st.actor = -1;
  st.can_next = true;
  st.deposit = deposit;
  for (const s of st.seats) s.points += deltas[s.seat];
}

async function checkRoundEnd(page: Page, end: RoundEnd) {
  await page.clock.install();
  let patched: GameState | null = null;
  // The events of the real response, checked after the click: an expect()
  // failing in here would leave the page waiting, and the test timing out.
  let real: string[] = [];
  await page.route('**/api/games/*/action', async (route) => {
    const response = await route.fetch();
    const st = (await response.json()) as GameState;
    if (patched === null) {
      real = st.events.map((e) => e.type);
      patched = st;
      if (real.join() !== 'discard,discard,discard,discard') {
        await route.fulfill({ response, json: st });
        return;
      }
      end.patch(st, st.events.slice(1).map((e) => e.seat));
      const ranks = end.ranks ?? ranksOf(st.seats.map((s) => s.points), st.first_dealer);
      for (const sd of st.standings) {
        sd.points = st.seats[sd.seat].points;
        sd.rank = ranks[sd.seat];
      }
    }
    await route.fulfill({ response, json: st });
  });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled({ timeout: 15_000 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await clickAndWait(page, hand.locator('.hand-drawn button'));
  await page.clock.runFor(50);
  const st = patched as GameState | null;
  expect(real, `your discard, then three CPU discards (seed ${SEED})`).toEqual(Array(4).fill('discard'));

  const table = page.locator('.game-table');
  const result = page.getByRole('region', { name: '結果' });
  const expectTable = async (points: number[], deposit: number) => {
    const ranks = end.ranks ?? ranksOf(points, st!.first_dealer);
    for (let s = 0; s < 4; s++) {
      const box = page.locator(SEAT_BOXES[(s - st!.you + 4) % 4]);
      await expect(box.locator('.seat-points'), `seat ${s} points`).toHaveText(points[s].toLocaleString());
      await expect(box.locator('.seat-rank'), `seat ${s} rank`).toHaveText(`${ranks[s]}位`);
    }
    if (deposit > 0) await expect(page.locator('.table-deposit')).toHaveText(`供託 ${deposit / 1000}本`);
    else await expect(page.locator('.table-deposit')).toHaveCount(0);
  };
  for (let step = 1; step < st!.events.length; step++) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    await expect(result).toHaveCount(0);
    const d = end.during(step);
    await expectTable(d.points, d.deposit);
    await page.clock.runFor(350);
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(result).toBeVisible();
  await expectTable(
    st!.seats.map((s) => s.points),
    st!.deposit,
  );
}

test('playback before a ron with honba and a carried stick: points, stick and ranks as before it', async ({ page }) => {
  // The third CPU discard is ronned by the second CPU: 3900 and 2 honba,
  // and the stick carried on the table goes to the winner.
  await checkRoundEnd(page, {
    patch: (st, [, winner, from]) => {
      st.honba = 2; // a new round key for useRoundLog too: the log starts over, which is fine here
      const hand = [0, 0, 0, 0];
      const honba = [0, 0, 0, 0];
      const sticks = [0, 0, 0, 0];
      [hand[winner], hand[from]] = [3900, -3900];
      [honba[winner], honba[from]] = [600, -600];
      sticks[winner] = 1000;
      st.events.push({ seat: winner, type: 'ron', wall_remaining: st.events[3].wall_remaining });
      const deltas = [0, 1, 2, 3].map((s) => hand[s] + honba[s] + sticks[s]);
      endRound(st, { kind: 'ron', winner, from, hand_deltas: hand, honba_deltas: honba, stick_deltas: sticks }, deltas, 0);
    },
    during: () => ({ points: START, deposit: 1000 }),
  });
});

test('playback before a tsumo by a riichi seat: the stick leaves with the riichi, the win waits', async ({ page }) => {
  // The first CPU discard declares riichi (accepted), and that seat wins by
  // tsumo: 1000/2000 (the dealer pays 2000), its own stick back.
  let riichi = -1;
  await checkRoundEnd(page, {
    patch: (st, [seat]) => {
      riichi = seat;
      st.events[1].type = 'riichi';
      st.seats[seat].riichi = true;
      st.seats[seat].river[st.seats[seat].river.length - 1].riichi = true;
      st.events.push({ seat, type: 'tsumo', wall_remaining: st.events[3].wall_remaining });
      const hand = [0, 1, 2, 3].map((s) => (s === seat ? 4000 : s === st.dealer ? -2000 : -1000));
      // -1000 for its riichi, +1000 from the table: the final points are
      // the start plus the deltas, as the engine settles them.
      const sticks = [0, 0, 0, 0];
      endRound(st, { kind: 'tsumo', winner: seat, hand_deltas: hand, stick_deltas: sticks }, hand, 0);
    },
    during: (step) => ({
      points: START.map((p, s) => (s === riichi && step > 1 ? p - 1000 : p)),
      deposit: step > 1 ? 1000 : 0,
    }),
  });
});

test('playback before an exhaustive draw: the tenpai payments wait for the end', async ({ page }) => {
  await checkRoundEnd(page, {
    patch: (st, [, b]) => {
      const tenpai = [0, 1, 2, 3].map((s) => s === st.you || s === b);
      const hand = tenpai.map((t) => (t ? 1500 : -1500));
      endRound(st, { kind: 'draw', tenpai, hand_deltas: hand }, hand, 0);
    },
    during: () => ({ points: START, deposit: 0 }),
  });
});

test('playback before a ron on a riichi declaration: that riichi never puts a stick down', async ({ page }) => {
  // The third CPU discard declares riichi and is ronned: the riichi does
  // not stand (no badge, no stick) at any step.
  await checkRoundEnd(page, {
    patch: (st, [, winner, from]) => {
      st.events[3].type = 'riichi';
      const hand = [0, 0, 0, 0];
      [hand[winner], hand[from]] = [2000, -2000];
      st.events.push({ seat: winner, type: 'ron', wall_remaining: st.events[3].wall_remaining });
      endRound(st, { kind: 'ron', winner, from, hand_deltas: hand }, hand, 0);
    },
    during: () => ({ points: START, deposit: 0 }),
  });
  await expect(page.locator('.seat-riichi')).toHaveCount(0);
});

test('playback with the points tied: ranks go to the seat nearer the first dealer', async ({ page }) => {
  // Everyone tenpai: no payments, all four on 25,000 before and after. With
  // seat 2 as the first dealer, seats 2, 3, 0, 1 rank 1st to 4th.
  await checkRoundEnd(page, {
    patch: (st) => {
      st.first_dealer = 2;
      endRound(st, { kind: 'draw', tenpai: [true, true, true, true] }, [0, 0, 0, 0], 0);
    },
    during: () => ({ points: START, deposit: 0 }),
    ranks: [3, 4, 1, 2],
  });
});
