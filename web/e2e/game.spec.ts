import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GameResult, GameState } from '../src/api';

// A seed where a "tsumogiri" strategy (discard the tile you just drew; with
// no drawn tile, right after a call, discard the last hand tile), skipping
// every non-pon call offer, is offered a pon within a couple of your turns.
// Found with a small Go harness reusing internal/server/games_test.go's
// newClient()/match.State against many seeds, playing that exact strategy
// (like TestHumanPon's own seed search for a pon); see the PR description
// for how to re-derive it if game logic changes.
const SEED = 12;

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
    // The round's moves so far scroll in a short box, the newest in sight.
    const log = page.locator('.event-log');
    expect((await log.boundingBox())!.height).toBeLessThanOrEqual(90);
    await expect
      .poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
      .toBeLessThanOrEqual(1);

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

// A desktop keeps the row of backs.
test('a desktop shows the CPU hands as rows of backs', async ({ page }) => {
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const hand = page.locator('.seat-top .seat-hand');
  await expect(hand.locator('.seat-hand-count')).toBeHidden();
  await expect(hand.locator('.seat-hand-backs .tile')).not.toHaveCount(0);
  await expect(hand.locator('.seat-hand-backs .tile').first()).toBeVisible();
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

// At a round's end, on a phone upright or on its side, every CPU seat's
// revealed hand, melds and river fit the seat: the rivers wrap at the seat's
// width (more than six to a row) in 15px tiles.
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
  }
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
