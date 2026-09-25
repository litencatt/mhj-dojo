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

function handPanel(page: Page) {
  return page.getByRole('region', { name: '手牌' });
}

/** One generic step: tsumo or ron when available, otherwise skip/見逃す any
 * call offer (including chii/kan, but the caller checks for pon first),
 * otherwise tsumogiri (discard the tile you just drew, or with none the
 * last hand tile). Mirrors nextMove() in games_test.go, except for the
 * discard rule, which this file's Go seed-finder used to pick SEED. */
async function playOneStep(page: Page) {
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

/** Plays generic steps (like TestHumanPon) until a pon is offered, then
 * takes it and returns the called tile. Fails clearly if the round ends
 * (or maxSteps is exceeded) without ever offering one. */
async function playUntilPonTaken(page: Page, maxSteps = 60): Promise<string> {
  const actionBar = page.locator('.action-bar');
  const result = page.getByRole('region', { name: '結果' });
  for (let i = 0; i < maxSteps; i++) {
    if (await result.isVisible()) {
      throw new Error(`round ended (seed ${SEED}) before a pon was ever offered`);
    }
    await actionBar.waitFor({ state: 'visible', timeout: 15_000 });
    const ponButton = actionBar.getByRole('button', { name: 'ポン', exact: true });
    if (await ponButton.isVisible()) {
      const calledTile = await actionBar.locator('.action-hint .tile').first().getAttribute('aria-label');
      expect(calledTile, 'the call bar should show the last-discarded tile').toBeTruthy();
      await clickAndWait(page, ponButton);
      return calledTile!;
    }
    await playOneStep(page);
  }
  throw new Error(`no pon offered within ${maxSteps} steps (seed ${SEED})`);
}

/** Plays generic steps until the round's result panel appears. */
async function playToResult(page: Page, maxSteps = 150) {
  const result = page.getByRole('region', { name: '結果' });
  for (let i = 0; i < maxSteps; i++) {
    if (await result.isVisible()) return;
    await playOneStep(page);
  }
  throw new Error(`round did not reach a result panel within ${maxSteps} steps`);
}

test('a CPU game: pon offer, round result, next round, and a mobile viewport', async ({ page }) => {
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);

  const hand = handPanel(page);
  await expect(hand).toBeVisible();

  // Play generically until a pon is offered and take it: the called tile
  // should match what the call bar showed, and a meld should appear.
  const calledTile = await playUntilPonTaken(page);
  await expect(hand.getByRole('group', { name: 'ポン' })).toBeVisible();
  await expect(hand.locator(`.meld-called [aria-label^="${calledTile}"]`)).toBeVisible();

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
  await expect(page.getByRole('heading', { name: /mhj2/ })).toBeVisible();
  await expect(hand).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
