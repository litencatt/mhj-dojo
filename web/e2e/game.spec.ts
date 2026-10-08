import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  GAME_URL,
  PHONE,
  SEED,
  clickAndWait,
  expectStopped,
  handPanel,
  openGame,
  openSettings,
  pageOverflowX,
  playOneStep,
  playToResult,
  playUntilPonOffered,
  riversOption,
  savedGame,
  slowEngine,
  stoppedDialog,
  tableState,
  toggleRivers,
  waitForPlayback,
} from './helpers';

// The CPU game (?mode=game): the table, the hand and the
// header at every screen size, and one tab at a time.

/** Plays generic steps (like TestHumanPon) until a pon is offered, then
 * takes it and returns the called tile. Fails clearly if the round ends
 * (or maxSteps is exceeded) without ever offering one. */
async function playUntilPonTaken(page: Page, maxSteps = 60): Promise<string> {
  await playUntilPonOffered(page, maxSteps);
  const actionBar = page.locator('.action-bar');
  const ponButton = actionBar.getByRole('button', { name: 'ポン', exact: true });
  const calledTile = await actionBar.locator('.action-hint .tile').first().getAttribute('aria-label');
  expect(calledTile, 'the call bar should show the last-discarded tile').toBeTruthy();
  // The call is at the right end, near the drawn tile the hand is played from.
  const bar = (await actionBar.boundingBox())!;
  const skip = (await actionBar.getByRole('button', { name: 'スキップ' }).boundingBox())!;
  expect(bar.x + bar.width - (skip.x + skip.width)).toBeLessThanOrEqual(2);
  await clickAndWait(page, ponButton);
  return calledTile!;
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
  slowEngine();
  await page.goto(GAME_URL);

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
  await page.setViewportSize(PHONE);
  await expect(page.getByRole('heading', { name: /mhj-dojo/ })).toBeVisible();
  await expect(hand).toBeVisible();
  const overflow = await pageOverflowX(page);
  expect(overflow).toBeLessThanOrEqual(1);
});

// On a phone (360 and 390px wide) the table, the hand and the call buttons
// fit the screen: no sideways page scroll, the hand on one row with the
// called meld on a row of its own, and every action button the header's 設定 size (32px).
for (const width of [360, 390]) {
  test(`a CPU game fits a ${width}px-wide phone: one-row hand, 設定-size action buttons`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(GAME_URL);
    const hand = handPanel(page);
    await expect(hand).toBeVisible();
    const noOverflow = async () =>
      expect(
        await pageOverflowX(page),
      ).toBeLessThanOrEqual(0);
    const rowsOf = (locator: Locator) =>
      locator.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);

    // The call offer: ポン / スキップ (and any other) buttons are big enough to tap.
    await playUntilPonOffered(page);
    await noOverflow();
    expect(await rowsOf(hand.locator('.hand-tiles button.tile'))).toBe(1);
    // The call's buttons are the header's 設定 size: compact, yet easy to tap.
    const buttons = page.locator('.action-bar button');
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
    const settings = (await page.locator('.app-header').getByRole('button', { name: '設定', exact: true }).boundingBox())!;
    for (const b of await buttons.all()) {
      const bb = await b.boundingBox();
      expect(bb!.height).toBeGreaterThanOrEqual(32);
      expect(Math.abs(bb!.height - settings.height)).toBeLessThanOrEqual(2);
    }
    // Each opponent's concealed hand is one back with a count (see below).
    for (const seat of ['.seat-top', '.seat-left', '.seat-right']) {
      await expect(page.locator(`${seat} .seat-hand-count`)).toBeVisible();
    }
    // The rivers show the discards, so the log of moves is hidden; with the
    // rivers folded away, the round's moves so far run sideways in one short
    // row, the newest in sight.
    await expect(page.getByRole('list', { name: 'この局の動き' })).toBeHidden();
    await toggleRivers(page);
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
    await openGame(page);
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
    const overflow = await pageOverflowX(page);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

/** The yaku panel's own scroller. */
function yakuScroller(page: Page) {
  return page.getByRole('region', { name: '役別向聴テーブル' });
}

// On a phone, as in practice, the yaku panel fills the screen under the
// header, the table and the hand, and scrolls on its own: the page stays put
// (or scrolls a little, the table and the hand then pinned to the top), so
// the hand stays in sight and nothing covers the panel.
for (const [width, height] of [[390, 844], [360, 800]]) {
  test(`a ${width}x${height} phone scrolls the yaku panel on its own, the hand staying in sight`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openGame(page);
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
// page's bottom padding (8px) instead of the dock bar's (60px). Widened to
// a desktop the saved layout is back, and narrowed again they are gone again.
test.describe('a phone game', () => {
  test.use({ hasTouch: true });

  test('has no chart, glossary or dock; the yaku panel takes the room', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mhj-dojo.minimized.v2', '[]'));
    await page.setViewportSize(PHONE);
    await openGame(page);
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
      .toBe(8); // no dock bar: the panel runs nearly to the screen's foot
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight))
      .toBe(0);

    await page.setViewportSize({ width: 844, height: 390 });
    await expectPhone();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(chart).toBeVisible();
    await expect(glossary).toBeVisible();

    await page.setViewportSize(PHONE);
    await expectPhone();
  });

  // The yaku panel can still be minimized: then (only then) the dock bar
  // holds its tab, which brings it back.
  test('docks a minimized yaku panel, and restores it', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openGame(page);
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

  // A 667x375 phone on its side (under 760px wide) has the new-game options
  // behind 設定 too: a modal dialog, focus on the first option, nothing
  // overflowing; Esc closes it, focus back on 設定.
  test('on its side at 667x375 has the options behind 設定', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openGame(page);
    const toggle = page.getByRole('button', { name: /^設定/ });
    const form = page.locator('.new-game-form');
    await expect(toggle).toBeVisible();
    await expect(form).toBeHidden();
    await expect(page.getByRole('region', { name: '時系列チャート' })).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
    await expect(form).toBeVisible();
    await expect(form.getByRole('radio', { checked: true }).first()).toBeFocused();
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  });
});

// A desktop window made short (no touch screen) is no phone on its side:
// the chart, the advice and the glossary stay, in the dock.
test('a short desktop window keeps the chart and the glossary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 450 });
  await openGame(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  await expect(dock.getByRole('button')).toHaveText([/チャート/, /アドバイス/, /用語表/]);
});

// With the chart, the advice and the glossary minimized (the default), a
// desktop game keeps them in the dock.
test('a desktop game keeps the chart and the glossary in the dock', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGame(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  await expect(dock.getByRole('button')).toHaveText([/時系列チャート/, /アドバイス/, /用語表/]);
  await dock.getByRole('button', { name: '用語表' }).click();
  await expect(page.getByRole('region', { name: '用語表' })).toBeVisible();
});

// A screen too short for the table, the hand and the panel together doesn't
// pin them, which would cover the panel: early in the round (short rivers)
// they fit and are pinned, later the page scrolls instead. Either way the
// panel scrolls on its own and, at the page's end, is in full view.
test('a 320x640 phone pins the hand only while it leaves the yaku panel room', async ({ page }) => {
  test.setTimeout(60_000);
  slowEngine();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(GAME_URL);
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

// On a phone 設定's 他家の捨て牌 folds the other seats' rivers away (your own,
// in the hand panel, stays), leaving each seat its head, and the yaku panel the room; the log
// of moves stands in for them meanwhile. The choice survives a reload.
test('a phone folds the other seats\' rivers away with 設定\'s 他家の捨て牌, and remembers it', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(GAME_URL);
  // A turn round the table: every river has a tile (an empty one isn't shown).
  await playOneStep(page);
  await waitForPlayback(page);
  const cpuRivers = ['#river-top', '#river-left', '#river-right'];
  const expectShown = async (shown: boolean) => {
    await openSettings(page);
    if (shown) await expect(riversOption(page)).toBeChecked();
    else await expect(riversOption(page)).not.toBeChecked();
    await page.keyboard.press('Escape');
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
  const log = page.getByRole('list', { name: 'この局の動き' });
  await expect(log).toBeHidden();
  const yakuTop = async () => (await page.locator('.area-yaku').boundingBox())!.y;
  const before = await yakuTop();

  await toggleRivers(page);
  await expectShown(false);
  // The log is back, under the CPU seats.
  await expect(log).toBeVisible();
  const seat = (await page.locator('.seat-right').boundingBox())!;
  expect(seat.y + seat.height).toBeLessThanOrEqual((await log.boundingBox())!.y + 1);
  // The table got shorter (by less than the rivers, the log taking a row),
  // and the yaku panel starts higher.
  await expect.poll(yakuTop).toBeLessThan(before - 10);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  await page.reload();
  await waitForPlayback(page);
  await expectShown(false);

  await toggleRivers(page);
  await expectShown(true);
  await page.reload();
  await waitForPlayback(page);
  await expectShown(true);
});

// An upright phone stacks the CPU seats at the table's full width, 対面,
// 上家 then 下家; your seat is in the hand panel (see
// below). A seat with nothing under its head (before its first discard)
// ends at its head.
test('an upright phone stacks the CPU seats at the full width', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openGame(page);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  await expect(page.locator('.seat-bottom')).toBeHidden();
  // SEED deals you the first turn: no CPU has discarded yet.
  await expect(page.locator('#river-top')).toBeHidden();
  const seat = await box('.seat-top');
  const head = await box('.seat-top .seat-head');
  expect(seat.y + seat.height - (head.y + head.height)).toBeLessThanOrEqual(5);

  for (let i = 0; i < 4; i++) await playOneStep(page);
  await waitForPlayback(page);
  const table = await box('.game-table');
  // The center holds only the hidden log with the rivers shown (and no
  // deposit), so it shows only when it has something.
  const shown = ['.seat-top', '.seat-left', '.seat-right'];
  if (await page.locator('.table-center').isVisible()) shown.push('.table-center');
  const rows = await Promise.all(shown.map(box));
  expect(rows[0].width).toBeGreaterThan(table.width - 16);
  for (const r of rows) {
    expect(Math.abs(r.x - rows[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.width - rows[0].width)).toBeLessThanOrEqual(1);
  }
  for (let i = 1; i < rows.length; i++) expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height);
  const last = rows[rows.length - 1];
  expect(last.y + last.height).toBeLessThanOrEqual(table.y + table.height);
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

// On an upright phone the rivers show every discard, so the log of moves is
// hidden while they are shown; with them folded away it stands in for them,
// scrolled to the newest, moves made while it was hidden included.
test('an upright phone shows the log of moves only with the rivers folded away', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(GAME_URL);
  const log = page.getByRole('list', { name: 'この局の動き' });
  for (let i = 0; i < 6; i++) await playOneStep(page);
  await waitForPlayback(page);
  await expect(log).toBeHidden();
  expect(await page.locator('.event-log li').count()).toBeGreaterThan(12);

  await toggleRivers(page);
  await expectPhoneLog(page);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  // It keeps the newest in sight as moves land.
  await playOneStep(page);
  await waitForPlayback(page);
  await expectPhoneLog(page);

  await toggleRivers(page);
  await expect(log).toBeHidden();
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
});

// A phone on its side and a desktop keep 上家 and 下家 side by side, your
// seat at the table, and the log of moves with the rivers shown.
for (const [width, height] of [[844, 390], [1280, 900]]) {
  test(`a ${width}x${height} screen keeps 上家 and 下家 side by side, your seat and the log`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(GAME_URL);
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

// A desktop has no 他家の捨て牌 option, and shows every river even with the
// phone's choice saved as hidden.
test('a desktop always shows the rivers, with no 他家の捨て牌 option', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('mhj-dojo.rivers.v1', 'hidden'));
  await openGame(page);
  await openSettings(page);
  await expect(riversOption(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const r of ['#river-top', '#river-left', '#river-right']) {
    await expect(page.locator(r)).toHaveCSS('display', 'grid');
  }
});

// A desktop keeps the row of backs.
test('a desktop shows the CPU hands as rows of backs', async ({ page }) => {
  await openGame(page);
  const hand = page.locator('.seat-top .seat-hand');
  await expect(hand.locator('.seat-hand-count')).toBeHidden();
  await expect(hand.locator('.seat-hand-backs .tile')).not.toHaveCount(0);
  await expect(hand.locator('.seat-hand-backs .tile').first()).toBeVisible();
  // Nothing pinned: the columns scroll as before.
  await expect(page.locator('.area-hand')).toHaveCSS('position', 'static');
});

// On a phone the header is short: the new-game options are behind 「設定」
// (a modal dialog), the status is one or two dense lines and the dora tiles
// are small.
for (const [width, height, maxHeader] of [[320, 640, 150], [360, 800, 130], [390, 844, 130]]) {
  test(`a ${width}px-wide phone has the new-game options behind 設定`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openGame(page);
    const header = page.locator('.app-header');
    const form = page.locator('.new-game-form');
    const toggle = page.getByRole('button', { name: /^設定/ });
    await expect(form).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(maxHeader);
    // The status stays in view, and 設定 is easy to tap.
    await expect(page.locator('.game-status')).toBeVisible();
    await expect(page.locator('.dora-box').filter({ visible: true })).toBeVisible();
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    // The title row's mode links never run under 設定 and ?, even at 320px.
    const title = (await page.locator('.app-header h1').boundingBox())!;
    const meta = (await page.locator('.header-meta').boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(meta.x);
    expect((await page.locator('.dora-indicators .tile').filter({ visible: true }).first().boundingBox())!.height).toBeLessThanOrEqual(24);

    // Open: the options in a dialog inside the screen, 新規対局 still a big button.
    await toggle.click();
    const dialog = page.getByRole('dialog', { name: '設定' });
    await expect(dialog).toBeVisible();
    await expect(form).toBeVisible();
    // Boxed as in the dojo's 設定: 対局, 起家, CPU, シード, 再生速度 and 表示; the choices are radio buttons.
    await expect(form.getByRole('group')).toHaveCount(6);
    await expect(form.getByRole('combobox')).toHaveCount(0);
    const d = (await dialog.boundingBox())!;
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(width);
    expect((await form.getByRole('button', { name: '新規対局' }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(
      await pageOverflowX(page),
    ).toBeLessThanOrEqual(0);
    await dialog.getByRole('button', { name: '閉じる' }).click();
    await expect(form).toBeHidden();
    await expect(toggle).toBeFocused();
  });
}

// A desktop (and a phone on its side) has the options behind 設定 too, on
// the title row; the header shows the title and the status only.
for (const [width, height] of [[1280, 900], [844, 390]]) {
  test(`a ${width}x${height} screen has the new-game options behind 設定 on the title row`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openGame(page);
    await expect(page.locator('.new-game-form')).toBeHidden();
    const settings = (await page.locator('.app-header').getByRole('button', { name: '設定', exact: true }).boundingBox())!;
    const title = (await page.locator('.app-header h1').boundingBox())!;
    const status = (await page.locator('.header-status').boundingBox())!;
    expect(settings.y + settings.height).toBeLessThanOrEqual(status.y);
    expect(Math.abs(settings.y + settings.height / 2 - (title.y + title.height / 2))).toBeLessThanOrEqual(8);
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('button', { name: '新規対局' })).toBeVisible();
  });
}

// The log keeps the newest move in sight only while it is there: a player
// reading earlier moves isn't taken to the end by the next ones.
test('the log of moves stays where a player scrolled it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(GAME_URL);
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
// A seed whose first round, played by the generic steps, ends in a win with
// more than six tiles in the top seat's river. Guarded by TestE2ESeedWonRound
// in internal/apicall/e2e_seeds_test.go.
const WON_ROUND = 8;

test('a phone fits the revealed hands and the rivers in their seats', async ({ page }) => {
  // It plays a whole round.
  test.setTimeout(60_000);
  slowEngine();
  await page.setViewportSize(PHONE);
  await page.goto(`./?mode=game&seed=${WON_ROUND}&length=tonpuu`);
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
      await pageOverflowX(page),
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
      await expect(page.getByRole('list', { name: 'この局の動き' })).toBeHidden();
      await toggleRivers(page);
      await expectPhoneLog(page);
      await toggleRivers(page);
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

// A desktop keeps the rivers at six 18px tiles to a row.
test('a desktop has six-tile rivers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openGame(page);
  const river = page.locator('.seat-river').first();
  expect(await river.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(6);
  await expect(page.locator('.dora-indicators .tile').filter({ visible: true }).first()).toHaveCSS('width', '26px');
  await expect(page.locator('.seat-box .tile-xs').first()).toHaveCSS('width', '18px');
  // The log of moves: one move to a row.
  const tops = await page
    .locator('.event-log li')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(tops.length);
});

test('game options from the URL: first dealer you and a weak CPU survive a reload', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&first_dealer=you&cpu=weak`);
  await waitForPlayback(page);
  const status = page.locator('.game-status');
  const expectOptions = async () => {
    await expect(status).toContainText('東1局');
    // A seed the player chose is known from the start, so it shows.
    await expect(status.locator('div').filter({ hasText: 'シード' }).locator('dd')).toHaveText(String(SEED));
    await expect(status.locator('div').filter({ hasText: '自風' }).locator('dd')).toHaveText('東');
    await expect(status.locator('div').filter({ hasText: 'CPU' }).locator('dd')).toHaveText('弱い');
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('group', { name: '起家' }).getByRole('radio', { name: '自分' })).toBeChecked();
    await expect(dialog.getByRole('group', { name: 'CPU' }).getByRole('radio', { name: '弱い' })).toBeChecked();
    await page.keyboard.press('Escape');
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

test('a second tab on the same game stops the first, until taken back', async ({ page, context }) => {
  slowEngine();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(GAME_URL);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await waitForPlayback(page);
  await expect(page).toHaveURL(/[?&]game=/);
  const other = await context.newPage();
  await other.emulateMedia({ reducedMotion: 'reduce' });
  await other.goto(page.url());
  await waitForPlayback(other);
  await expect(handPanel(other)).toBeVisible();
  expect(await tableState(other)).toEqual(await tableState(page));

  await expectStopped(page);
  await expect(stoppedDialog(other)).toHaveCount(0);

  // B plays on, and saves.
  await playOneStep(other);
  await playOneStep(other);
  await waitForPlayback(other);
  const b = await tableState(other);
  const save = await savedGame(other);

  // A takes it back, from where B left it; now B stops.
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(stoppedDialog(page)).toHaveCount(0);
  await waitForPlayback(page);
  await expect.poll(() => tableState(page)).toEqual(b);
  await expectStopped(other);
  await expect.poll(() => savedGame(page)).toBe(save);
  await playOneStep(page);
  await expect.poll(() => savedGame(page)).not.toBe(save);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// On a phone the wall left and the dora sit over the hand, which sticks to
// the top of the screen: scrolled to the page's end, they are still in sight,
// and the header's copy is not shown. A desktop shows the header's.
test('a phone keeps the wall left and the dora in sight over the hand', async ({ page }) => {
  // Tall enough for the hand to pin (style.css, useYakuTop's data-hand-fits).
  await page.setViewportSize({ width: 390, height: 640 });
  await openGame(page);
  const pinned = page.getByTestId('pinned-status');
  await expect(pinned).toBeVisible();
  await expect(page.locator('.header-status .status-wall-dora')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const box = (await pinned.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  await expect(pinned.getByTestId('wall-remaining')).toHaveText(/^\d+$/);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(pinned).toBeHidden();
  await expect(page.locator('.header-status .status-wall-dora')).toBeVisible();
});
