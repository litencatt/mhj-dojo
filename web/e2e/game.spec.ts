import { expect, test, type Locator, type Page } from '@playwright/test';

// Seed 47 (東風戦, default): with the "always discard the newest tile"
// strategy used below, seat 0 (you) discards 2p then 5z, after which seats
// 2 and 3 act and a pon on 3z is offered to you. Found with a small Go
// harness reusing internal/server/games_test.go's nextMove() against many
// seeds; see the PR description for how to re-derive it if game logic changes.
const SEED = 47;
const FIRST_DISCARDS = ['2p', '5z'];
const OFFERED_CALL_TILE = '3z';

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

/** One step of a generic "always take a legal action" strategy: tsumo or
 * ron when available, otherwise skip/見逃す any call offer, otherwise
 * discard some legal tile. Mirrors nextMove() in games_test.go. */
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

  const tile = handPanel(page)
    .locator('.hand-tiles button:not([aria-disabled]), .hand-drawn button:not([aria-disabled])')
    .first();
  await tile.waitFor({ state: 'visible', timeout: 15_000 });
  await clickAndWait(page, tile);
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

  // Discard the two tiles that lead to a pon offer, waiting out each request.
  for (const tile of FIRST_DISCARDS) {
    const button = hand.getByRole('button', { name: tile, exact: true }).first();
    await expect(button).toBeVisible();
    await clickAndWait(page, button);
  }

  // The server has auto-played the CPU seats and now offers a pon.
  const actionBar = page.locator('.action-bar');
  const ponButton = actionBar.getByRole('button', { name: 'ポン', exact: true });
  await expect(ponButton).toBeVisible({ timeout: 15_000 });
  await expect(actionBar.locator(`.action-hint [aria-label="${OFFERED_CALL_TILE}"]`)).toBeVisible();
  await expect(actionBar.getByRole('button', { name: 'スキップ', exact: true })).toBeVisible();

  // Take it: a called meld should appear in your hand.
  await clickAndWait(page, ponButton);
  await expect(hand.getByRole('group', { name: 'ポン' })).toBeVisible();

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
