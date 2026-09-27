import { expect, test, type Locator, type Page } from '@playwright/test';

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
    // Each opponent's concealed hand stays on one row in its seat.
    for (const seat of ['.seat-top', '.seat-left', '.seat-right']) {
      expect(await rowsOf(page.locator(`${seat} .seat-hand .tile`))).toBe(1);
    }

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

test('a stale tab: acting after another tab moved the game on shows a notice, not an error', async ({
  page,
  context,
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
  const pageB = await context.newPage();
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
});
