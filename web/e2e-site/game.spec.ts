import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { hideTab } from './tabs';

// The static site's CPU game (?mode=game): the engine runs the game, CPU
// turns included, as WebAssembly in the browser, and saves each game to
// localStorage so a reload (or the engine evicting it) rebuilds it.

// The same seed as e2e/game.spec.ts: it plays a round with calls.
const SEED = 12;

// Every CPU move lands at once instead of being replayed step by step.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

function handPanel(page: Page) {
  return page.getByRole('region', { name: '手牌' });
}

async function waitForPlayback(page: Page) {
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
}

// Everything an action changes: the table (rivers, points, wall), the hand
// and the result panel. There are no HTTP requests to wait for here.
function snapshot(page: Page) {
  return page.locator('.area-hand').innerText();
}

/** Clicks and waits until the game has moved on. */
async function clickAndWait(page: Page, locator: Locator) {
  const before = await snapshot(page);
  await locator.click();
  await expect.poll(() => snapshot(page), { timeout: 30_000 }).not.toBe(before);
  await waitForPlayback(page);
}

/** The control for one step, as in e2e/game.spec.ts: tsumo or ron when
 * offered, skip any other call, otherwise tsumogiri (with no drawn tile, the
 * last hand tile). */
async function nextMove(page: Page): Promise<Locator> {
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

async function playOneStep(page: Page) {
  await clickAndWait(page, await nextMove(page));
}

async function playToResult(page: Page, maxSteps = 150) {
  const result = page.getByRole('region', { name: '結果' });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await result.isVisible()) return;
    await playOneStep(page);
  }
  throw new Error(`round did not reach a result panel within ${maxSteps} steps`);
}

// What a reload must bring back: every river, your hand and the status line.
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

function gameId(page: Page) {
  return new URL(page.url()).searchParams.get('game');
}

function savedGames(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('mhj-dojo.site.games') ?? 'null') as { v: number; games: Record<string, { save: string }> } | null,
  );
}

test('a CPU game runs in the browser and a reload resumes it', async ({ page }) => {
  test.setTimeout(90_000);
  const apiRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) apiRequests.push(req.url());
  });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await expect(page.getByRole('link', { name: '練習へ' })).toBeVisible();
  // The table's log keeps the round's moves across your moves (events_from):
  // it never shrinks within the round (skipping a call adds nothing when
  // the draw is yours next) and holds at least every discard on the table.
  const log = page.locator('.event-log li');
  let logged = await log.count();
  for (let i = 0; i < 4; i++) {
    await playOneStep(page);
    expect(await log.count()).toBeGreaterThanOrEqual(logged);
    logged = await log.count();
  }
  await expect(page.locator('.seat-bottom .seat-river .tile')).not.toHaveCount(0);
  expect(logged).toBeGreaterThanOrEqual(await page.locator('.seat-river .tile').count());

  const id = gameId(page);
  expect(id).toBeTruthy();
  expect((await savedGames(page))?.games[id!]).toBeTruthy();
  const before = await tableState(page);
  const url = page.url();

  // Twice: the rebuilt game keeps its id, so the URL stays good.
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await waitForPlayback(page);
    await expect(handPanel(page)).toBeVisible();
    expect(await tableState(page)).toEqual(before);
    expect(page.url()).toBe(url);
    await expect(page.locator('.error-banner')).toHaveCount(0);
  }

  // Playing on after the rebuild works and is saved in turn.
  await playOneStep(page);
  const after = await tableState(page);
  expect(after).not.toEqual(before);
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  expect(await tableState(page)).toEqual(after);
  expect(page.url()).toBe(url);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test('a CPU game plays a round to its result and the next round, across a reload', async ({ page }) => {
  // A whole round of CPU turns in wasm.
  test.setTimeout(180_000);
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playToResult(page);
  const result = page.getByRole('region', { name: '結果' });
  const summary = await result.innerText();

  // The finished round comes back as it was.
  await page.reload();
  await waitForPlayback(page);
  await expect(result).toBeVisible();
  expect(await result.innerText()).toBe(summary);

  await clickAndWait(page, result.getByRole('button', { name: '次の局へ' }));
  await expect(result).toBeHidden();
  await expect(page.locator('.game-status')).toContainText('東2局');
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// Two tabs on one game share its save: a move on a screen the other tab has
// moved on from is not made (its actions don't say which state they were
// chosen on); the tab shows the latest state with a notice instead. Both
// tabs are switched away from here, so neither catches up by itself.
async function twoTabs(page: Page, context: BrowserContext): Promise<Page> {
  await hideTab(page);
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await expect(page).toHaveURL(/[?&]game=/);
  const other = await context.newPage();
  await other.emulateMedia({ reducedMotion: 'reduce' });
  await hideTab(other);
  await other.goto(page.url());
  await waitForPlayback(other);
  expect(await tableState(other)).toEqual(await tableState(page));
  return other;
}

async function savedGame(page: Page) {
  return (await savedGames(page))?.games[gameId(page)!]?.save;
}

test('two tabs on the same game stay in step', async ({ page, context }) => {
  test.setTimeout(90_000);
  const other = await twoTabs(page, context);

  await playOneStep(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  const a = await tableState(page);

  // B still shows the state before A's move: its move is refused.
  await playOneStep(other);
  await expect(other.locator('.notice-banner')).toBeVisible();
  await expect(other.locator('.error-banner')).toHaveCount(0);
  expect(await tableState(other)).toEqual(a);

  // B plays on from there; now A is behind and is told in turn.
  await playOneStep(other);
  const b = await tableState(other);
  await playOneStep(page);
  await expect(page.locator('.notice-banner')).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(await tableState(page)).toEqual(b);

  // Both keep the same state across a reload.
  for (const p of [page, other]) {
    await p.reload();
    await waitForPlayback(p);
    await expect(handPanel(p)).toBeVisible();
    expect(await tableState(p)).toEqual(b);
    await expect(p.locator('.error-banner')).toHaveCount(0);
  }
});

test('a save from another tab this engine cannot rebuild is kept, and asks for a reload', async ({ page, context }) => {
  test.setTimeout(90_000);
  const other = await twoTabs(page, context);
  // B's engine refuses A's save, as an older engine refuses one from a newer
  // version of the site.
  await other.workers()[0].evaluate(() => {
    const orig = self.onmessage!;
    self.onmessage = (e: MessageEvent) =>
      e.data.fn === 'restoreGame'
        ? self.postMessage({ id: e.data.id, status: 409, body: '{"error":"save does not match this engine"}' })
        : orig.call(self, e);
  });

  await playOneStep(page);
  const a = await tableState(page);
  const save = await savedGame(page);

  const before = await snapshot(other);
  await (await nextMove(other)).click();
  await expect(other.locator('.error-banner')).toContainText('再読み込み');
  expect(await snapshot(other)).toBe(before);
  expect(await savedGame(other)).toBe(save);

  // Reloaded (a new engine), B shows A's game.
  await other.reload();
  await waitForPlayback(other);
  await expect(handPanel(other)).toBeVisible();
  expect(await tableState(other)).toEqual(a);
  await expect(other.locator('.error-banner')).toHaveCount(0);
});

test('a move racing a save by another tab gives way to it', async ({ page, context }) => {
  test.setTimeout(90_000);
  const other = await twoTabs(page, context);
  // B's engine holds its next move until released.
  const worker = other.workers()[0];
  await worker.evaluate(() => {
    const w = self as unknown as { held: boolean };
    w.held = true;
    const orig = self.onmessage!;
    self.onmessage = async (e: MessageEvent) => {
      if (e.data.fn === 'request' && e.data.args[0] === 'POST') {
        while (w.held) await new Promise((r) => setTimeout(r, 10));
      }
      return orig.call(self, e);
    };
  });

  await (await nextMove(other)).click();
  await playOneStep(page);
  const a = await tableState(page);
  const save = await savedGame(page);
  await worker.evaluate(() => {
    (self as unknown as { held: boolean }).held = false;
  });

  await expect(other.locator('.notice-banner')).toBeVisible();
  await waitForPlayback(other);
  await expect(other.locator('.error-banner')).toHaveCount(0);
  expect(await tableState(other)).toEqual(a);
  expect(await savedGame(other)).toBe(save);
});

test('game options from the URL survive a reload', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&first_dealer=you&cpu=weak`);
  await waitForPlayback(page);
  const status = page.locator('.game-status');
  const expectOptions = async () => {
    await expect(status).toContainText('東1局');
    await expect(status.locator('div').filter({ hasText: '自風' }).locator('dd')).toHaveText('東');
    await expect(status.locator('div').filter({ hasText: 'CPU' }).locator('dd')).toHaveText('弱い');
    await expect(page.getByLabel('起家')).toHaveValue('you');
    await expect(page.getByLabel('CPU')).toHaveValue('weak');
    await expect(page).toHaveURL(/[?&]game=/);
  };
  await expectOptions();
  const url = page.url();
  await page.reload();
  await waitForPlayback(page);
  await expectOptions();
  expect(page.url()).toBe(url);
});

test('a random-seed game keeps its seed hidden and still resumes', async ({ page }) => {
  await page.goto('./?mode=game');
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await expect(page).not.toHaveURL(/[?&]seed=/);
  await expect(page.locator('.game-status')).toContainText('終局後に表示');
  const before = await tableState(page);
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  expect(await tableState(page)).toEqual(before);
});

// The engine (cmd/mhj-dojo-wasm) keeps only a couple of games in memory; the
// rest are evicted and rebuilt from their save on their next request, as in
// practice.spec.ts's eviction tests. Games created straight through the
// worker's mhjDojoRequest are unknown to the page, so it still sends its next
// action to the engine, which no longer has the game.
const GAME_CAP = 2; // cmd/mhj-dojo-wasm/main.go's game cap; keep in sync

async function evictGames(page: Page, seedFrom: number) {
  const worker = page.workers()[0];
  for (let i = 0; i <= GAME_CAP; i++) {
    const res = (await worker.evaluate(
      (seed) => mhjDojoRequest('POST', '/api/games', JSON.stringify({ seed })),
      seedFrom + i,
    )) as { status: number };
    expect(res.status).toBe(200);
  }
}

test('a game evicted by the engine cap is rebuilt from its save, no reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await playOneStep(page);
  const url = page.url();
  const before = await tableState(page);

  await evictGames(page, 1000);
  await playOneStep(page);
  expect(page.url()).toBe(url);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  const after = await tableState(page);
  // The move continued the same game: every river kept what it had (a skip
  // may only bring a draw, so nothing need have been added).
  after.rivers.forEach((r, i) => expect(r.slice(0, before.rivers[i].length)).toEqual(before.rivers[i]));
  expect(after).not.toEqual(before);
});

test('after the engine exits, the next move restarts it and rebuilds the game', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  const url = page.url();
  const before = await tableState(page);

  expect(page.workers()).toHaveLength(1);
  await page.workers()[0].evaluate(() => self.postMessage({ type: 'failed', error: 'test exit' }));
  await playOneStep(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(page.url()).toBe(url);
  const after = await tableState(page);
  expect(after.rivers[0].slice(0, before.rivers[0].length)).toEqual(before.rivers[0]);
  expect(after.rivers[0].length).toBeGreaterThan(before.rivers[0].length);
});

test('an unusable game save deals again from the seed in the URL', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  const start = await tableState(page);
  await playOneStep(page);
  const id = gameId(page)!;
  await page.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.games')!);
    const save = JSON.parse(s.games[id].save);
    save.actions = [{ type: 'discard', tile: '9z' }]; // not a tile anyone holds
    s.games[id].save = JSON.stringify(save);
    localStorage.setItem('mhj-dojo.site.games', JSON.stringify(s));
  }, id);
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  expect(await tableState(page)).toEqual(start);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  // The unusable save is dropped; the fresh game is saved instead.
  const saved = await savedGames(page);
  expect(saved?.games[id]).toBeUndefined();
  expect(saved?.games[gameId(page)!]).toBeTruthy();
});

test('practice saves survive playing CPU games, and only the last 5 games are kept', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?seed=1&turns=18');
  const hand = handPanel(page);
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  await drawn.click();
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  const practiceUrl = page.url();

  for (let i = 0; i < 6; i++) {
    await page.goto(`./?mode=game&seed=${100 + i}`);
    await expect(handPanel(page)).toBeVisible();
    await expect(page).toHaveURL(/[?&]game=/);
  }
  expect(Object.keys((await savedGames(page))!.games)).toHaveLength(5);

  await page.goto(practiceUrl);
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(page.url()).toBe(practiceUrl);
});

// A save the engine fails on (500) is kept for another try, but the second
// failure in a row drops it: it may be what breaks the engine.
test('a save the engine fails on twice in a row is dropped', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  const id = gameId(page)!;
  const worker = page.workers()[0];
  await worker.evaluate(() => {
    const orig = self.onmessage!;
    self.onmessage = (e: MessageEvent) =>
      e.data.fn === 'restoreGame'
        ? self.postMessage({ id: e.data.id, status: 500, body: '{"error":"boom"}', save: '' })
        : orig.call(self, e);
  });
  await evictGames(page, 4000);

  const hand = handPanel(page);
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  await drawn.click();
  await expect(page.locator('.error-banner')).toContainText('boom');
  expect((await savedGames(page))?.games[id]).toBeTruthy();

  await expect(drawn).toBeEnabled();
  await drawn.click();
  await expect(page.locator('.error-banner')).toContainText('boom');
  await expect.poll(async () => (await savedGames(page))?.games[id]).toBeUndefined();
});

// localStorage refusing a write (its quota) keeps just the current game's
// save rather than none.
test('a full localStorage keeps the current game saved', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'mhj-dojo.site.games' && Object.keys(JSON.parse(value).games).length > 1) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await page.goto(`./?mode=game&seed=${SEED + 1}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  expect(Object.keys((await savedGames(page))!.games)).toEqual([gameId(page)]);
  const before = await tableState(page);
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  expect(await tableState(page)).toEqual(before);
  expect(warnings).toEqual([]);
});

test('a localStorage refusing every write warns once', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'mhj-dojo.site.games') throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await playOneStep(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(warnings.filter((w) => w.includes('localStorage'))).toHaveLength(1);
});

// A call the engine never answers (it hung, or looped) is given up after
// wasm.ts's CALL_TIMEOUT_MS: the request fails, and the next one starts a new
// engine that rebuilds the game from its save.
test('a hung engine is given up and the next move restarts it', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  const id = gameId(page)!;
  const before = await tableState(page);
  // From now on the engine swallows every call.
  await page.workers()[0].evaluate(() => {
    self.onmessage = () => {};
  });
  await page.clock.install();

  const hand = handPanel(page);
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  await drawn.click();
  await page.clock.fastForward(59_000);
  await expect(page.locator('.error-banner')).toHaveCount(0); // still waiting
  await page.clock.fastForward(2_000);
  await expect(page.locator('.error-banner')).toContainText('計算エンジンが応答しません');
  expect(await tableState(page)).toEqual(before);

  // The same move again: a new engine, the game rebuilt under the same id.
  await clickAndWait(page, drawn);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(gameId(page)).toBe(id);
  const after = await tableState(page);
  expect(after.rivers[0]).toHaveLength(before.rivers[0].length + 1);
});
