import { expect, test, type Locator, type Page } from '@playwright/test';

// What the specs share. The specs in e2e/shared run on both builds, each
// config's one project named after its build: the local server
// (playwright.config.ts) and the static site, its engine running as
// WebAssembly in a Web Worker (playwright.site.config.ts). A shared test that
// needs to know which one it is on asks onSite(); keep such branches few.

export function onSite() {
  return test.info().project.name === 'site';
}

/** A test that plays a whole round on the site's engine (WASM, some three times slower) gets three times its timeout there. */
export function slowOnSite() {
  test.slow(onSite(), 'the engine runs as WebAssembly');
}

/**
 * Records what the page asks its engine from now on: on the server its API
 * requests ("POST /api/sessions/…/discard?…"), on the site the calls posted
 * to the engine's worker ("POST /api/sessions/…/discard?…", or the call's
 * name, such as "restore"). Call it before the page loads. The function it
 * returns takes the calls recorded since its last call.
 */
export async function engineCalls(page: Page): Promise<() => Promise<string[]>> {
  if (!onSite()) {
    const seen: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) seen.push(`${req.method()} ${url.pathname}${url.search}`);
    });
    return async () => seen.splice(0);
  }
  await page.addInitScript(() => {
    const w = window as unknown as { engineCalls: string[] };
    w.engineCalls = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, m: { fn?: string; args?: string[] }) {
      if (m?.fn) w.engineCalls.push(m.fn === 'request' ? `${m.args?.[0]} ${m.args?.[1]}` : m.fn);
      return post.call(this, m as never);
    } as typeof Worker.prototype.postMessage;
  });
  return () => page.evaluate(() => (window as unknown as { engineCalls: string[] }).engineCalls.splice(0));
}

/** How many discards (POST …/discard) are among the calls engineCalls recorded since its last call. */
export async function discardsSent(calls: () => Promise<string[]>) {
  return (await calls()).filter((c) => /^POST \S+\/discard(\?|$)/.test(c)).length;
}

/** The header's version: a commit and its date, or on a released site its tag. */
export function versionPattern() {
  return onSite() ? /^(v\d{4}\.\d{4}\.\d+|(dev|[0-9a-f]{7})( · \d{4}-\d{2}-\d{2})?)$/ : /^(dev|[0-9a-f]{7})( · \d{4}-\d{2}-\d{2})?$/;
}

export function handPanel(page: Page) {
  return page.getByRole('region', { name: '手牌' });
}

/** The tiles' names in the hand panel's hand (.hand-tiles) or river (.discard-river), in order. */
export function labels(page: Page, selector: string) {
  return handPanel(page)
    .locator(`${selector} .tile`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

/** Discards the drawn tile in practice mode and waits for it in the river; returns its name. */
export async function discardDrawn(page: Page) {
  const hand = handPanel(page);
  const river = hand.locator('.discard-river .tile');
  const before = await river.count();
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  const tile = await drawn.getAttribute('aria-label');
  await drawn.click();
  await expect(river).toHaveCount(before + 1);
  return tile;
}

// One tab of a browser at a time plays a session or a game
// (src/singleTab.ts): the newest tab to open it wins, and the one before
// stops until taken back.
export function stoppedDialog(page: Page) {
  return page.getByRole('alertdialog', { name: 'このタブは別のタブで開かれたため停止しました' });
}

/** The dialog covers the page: shown modal, so everything else is inert. */
export async function expectStopped(page: Page) {
  await expect(stoppedDialog(page)).toBeVisible();
  expect(await stoppedDialog(page).evaluate((d) => d.matches(':modal'))).toBe(true);
}

/** The page's sideways overflow: above 0 means it scrolls sideways. */
export function pageOverflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// The CPU game.

// A seed where a "tsumogiri" strategy (discard the tile you just drew; with
// no drawn tile, right after a call, discard the last hand tile), skipping
// every non-pon call offer, is offered a pon within a couple of your turns.
// Found with a small Go harness reusing internal/server/games_test.go's
// newClient()/match.State against many seeds, playing that exact strategy
// (like TestHumanPon's own seed search for a pon); see the PR description
// for how to re-derive it if game logic changes.
export const SEED = 12;

/** Waits until the CPU moves have finished replaying: while they replay,
 * the action bar holds a playback スキップ button that sends no request. */
export async function waitForPlayback(page: Page) {
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
}

/** Everything a game action changes: the table (rivers, points, wall), the hand and the result panel. */
export function gameSnapshot(page: Page) {
  return page.locator('.area-hand').innerText();
}

/** Clicks and waits until the engine has answered, so the next step never
 * races a request still in flight: on the server the action's response, on
 * the site (no HTTP) the table, the hand or the result panel changing (the
 * site saves the game before it shows the answer). The CPU moves may still
 * be playing back: callers that need them over wait for that. */
export async function clickAndWait(page: Page, locator: Locator) {
  if (!onSite()) {
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
      locator.click(),
    ]);
    return;
  }
  const before = await gameSnapshot(page);
  await locator.click();
  await expect.poll(() => gameSnapshot(page), { timeout: 30_000 }).not.toBe(before);
}

/** The control for one generic step: tsumo or ron when offered, otherwise
 * skip/見逃す any call offer (callers wanting a pon check for it first),
 * otherwise tsumogiri (discard the tile you just drew, or with none, right
 * after a call, the last hand tile). Mirrors nextMove() in games_test.go,
 * except for the discard rule, which the seed search for SEED used. */
export async function nextMove(page: Page): Promise<Locator> {
  await waitForPlayback(page);
  const actionBar = page.locator('.action-bar');
  await actionBar.waitFor({ state: 'visible', timeout: 15_000 });
  const tsumo = actionBar.getByRole('button', { name: 'ツモ', exact: true });
  const ron = actionBar.getByRole('button', { name: 'ロン', exact: true });
  const skip = actionBar.getByRole('button', { name: /^(見逃す|スキップ)$/ });
  for (const candidate of [tsumo, ron, skip]) {
    if (await candidate.isVisible()) return candidate;
  }
  const hand = handPanel(page);
  const drawn = hand.locator('.hand-drawn button');
  const tile = (await drawn.count()) > 0 ? drawn : hand.locator('.hand-tiles button').last();
  await expect(tile).toBeEnabled({ timeout: 15_000 });
  return tile;
}

export async function playOneStep(page: Page) {
  await clickAndWait(page, await nextMove(page));
}

/** Plays generic steps until a pon is offered, without resolving it: used
 * to get two pages looking at the exact same call offer before either of
 * them acts on it. */
export async function playUntilPonOffered(page: Page, maxSteps = 60) {
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

/** Plays generic steps until the round's result panel appears. */
export async function playToResult(page: Page, maxSteps = 150) {
  const result = page.getByRole('region', { name: '結果' });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await result.isVisible()) return;
    await playOneStep(page);
  }
  throw new Error(`round did not reach a result panel within ${maxSteps} steps`);
}

/** Every river, your hand and the status line: what a reload or another tab must show the same. */
export async function tableState(page: Page) {
  const tiles = (sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  return {
    rivers: await Promise.all(
      ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'].map((s) => tiles(`${s} .seat-river .tile`)),
    ),
    hand: await tiles('.area-hand .hand-row .tile'),
    status: await page.locator('.game-status').innerText(),
  };
}
