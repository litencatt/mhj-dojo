import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  SEED,
  clickAndWait,
  expectStopped,
  gameSnapshot,
  handPanel,
  nextMove,
  playOneStep,
  playToResult,
  stoppedDialog,
  tableState,
  waitForPlayback,
} from './helpers';

// The CPU game's saves (?mode=game): the engine runs the game, CPU turns
// included, as WebAssembly in the browser, and saves each game to
// localStorage so a reload (or the engine evicting it) rebuilds it
// (game.spec.ts has the table and the layout).

// Every CPU move lands at once instead of being replayed step by step, so
// once the engine has answered (clickAndWait) the table shows the answer.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

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
  await expect(page.getByRole('link', { name: '練習', exact: true })).toBeVisible();
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
  expect(logged).toBeGreaterThanOrEqual(await page.locator('.game-table .seat-river .tile').count());

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

test('a reload shows the game as it stands without replaying the CPU moves', async ({ page }) => {
  test.setTimeout(90_000);
  // Playback on (the other tests turn it off): a live move is replayed.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await (await nextMove(page)).click();
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'true');
  await waitForPlayback(page);
  const before = await tableState(page);

  await page.reload();
  await expect(handPanel(page)).toBeVisible();
  // Not playing from the first frame it is shown, and nothing changes after.
  expect(await page.locator('.game-table').getAttribute('data-playing')).toBe('false');
  expect(await page.getByText('CPUの動きを再生中…').count()).toBe(0);
  expect(await tableState(page)).toEqual(before);

  // Live moves still replay after the reopen.
  await (await nextMove(page)).click();
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'true');
  await waitForPlayback(page);
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

// A game one step in, then a second tab on it.
async function twoTabs(page: Page, context: BrowserContext): Promise<Page> {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await expect(page).toHaveURL(/[?&]game=/);
  const other = await context.newPage();
  await other.emulateMedia({ reducedMotion: 'reduce' });
  await other.goto(page.url());
  await waitForPlayback(other);
  await expect(handPanel(other)).toBeVisible();
  return other;
}

async function savedGame(page: Page) {
  return (await savedGames(page))?.games[gameId(page)!]?.save;
}

test('a save from a newer engine is kept when this tab takes the game back, and asks for a reload', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const other = await twoTabs(page, context);
  await expectStopped(page);
  await playOneStep(other);
  const b = await tableState(other);
  const save = await savedGame(other);
  // A's engine refuses B's save, as an older engine refuses one from a newer
  // version of the site.
  await page.workers()[0].evaluate(() => {
    const orig = self.onmessage!;
    self.onmessage = (e: MessageEvent) =>
      e.data.fn === 'restoreGame'
        ? self.postMessage({ id: e.data.id, status: 409, body: '{"error":"save does not match this engine"}' })
        : orig.call(self, e);
  });

  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(page.locator('.error-message')).toContainText('新しい版');
  // A retry would be refused the same way: only 再読み込み.
  await expect(page.locator('.error-banner').getByRole('button', { name: '再試行' })).toHaveCount(0);
  await expect(page.locator('.error-banner').getByRole('button', { name: '再読み込み' })).toBeVisible();
  expect(await savedGame(page)).toBe(save);
  // A move on the old screen is refused the same way.
  await (await nextMove(page)).click();
  await expect(page.locator('.error-message')).toContainText('新しい版');
  expect(await savedGame(page)).toBe(save);

  // Reloaded (a new engine), A shows B's game.
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  await expect.poll(() => tableState(page)).toEqual(b);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expectStopped(other);
});

test('a move answered after the tab stopped is neither shown nor saved', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await expect(page).toHaveURL(/[?&]game=/);
  const before = await gameSnapshot(page);
  // A's engine holds its next move until released.
  const worker = page.workers()[0];
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
  await (await nextMove(page)).click();

  // B opens the game meanwhile, from the save without A's move, and plays
  // on from there.
  const other = await context.newPage();
  await other.emulateMedia({ reducedMotion: 'reduce' });
  await other.goto(page.url());
  await expectStopped(page);
  await playOneStep(other);
  await playOneStep(other);
  const b = await tableState(other);
  const save = await savedGame(other);

  // A's move is answered now: B's save stands, and A shows nothing new.
  await worker.evaluate(() => {
    (self as unknown as { held: boolean }).held = false;
  });
  const resume = stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' });
  await expect(resume).toBeEnabled();
  expect(await savedGame(page)).toBe(save);
  expect(await gameSnapshot(page)).toBe(before);

  await resume.click();
  await waitForPlayback(page);
  await expect.poll(() => tableState(page)).toEqual(b);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('a random-seed game keeps its seed hidden and still resumes', async ({ page }) => {
  await page.goto('./?mode=game');
  await expect(handPanel(page)).toBeVisible();
  await playOneStep(page);
  await expect(page).not.toHaveURL(/[?&]seed=/);
  // A hidden seed isn't shown at all until the game ends.
  await expect(page.locator('.game-status').getByRole('term').filter({ hasText: /^シード$/ })).toHaveCount(0);
  await expect(page.locator('.game-status')).toContainText('東風戦');
  const before = await tableState(page);
  await page.reload();
  await waitForPlayback(page);
  await expect(handPanel(page)).toBeVisible();
  expect(await tableState(page)).toEqual(before);
});

// The engine (cmd/mhj-dojo-wasm) keeps only a couple of games in memory; the
// rest are evicted and rebuilt from their save on their next request, as in
// practice-saves.spec.ts's eviction tests. Games created straight through the
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
    // Not Playwright's own, for the Service Worker it blocks (playwright.config.ts).
    if (m.type() === 'warning' && !m.text().startsWith('Service Worker registration blocked')) warnings.push(m.text());
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
