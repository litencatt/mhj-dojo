import { expect, test } from '@playwright/test';
import {
  GAME_URL,
  discardDrawn,
  gameSnapshot,
  handPanel,
  isGameAction,
  nextMove,
  onEngineReply,
  playOneStep,
  waitForPlayback,
  watchEngine,
} from './helpers';

// What the page offers when something goes wrong (issue #190): the error
// banner's 再試行 sends the request again, and a browser refusing to save
// is told once.

// An engine that made the move and then failed (a panic partway) leaves its
// copy changed: the retry rebuilds the game from its last save and makes
// the move there, rather than sending it to a game that has moved on.
test('a move the engine failed partway: 再試行 makes it on the saved game', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await watchEngine(page);
  await page.goto(GAME_URL);
  await playOneStep(page);
  let failed = false;
  const stop = onEngineReply(page, (call, reply) => {
    if (failed || !isGameAction(call)) return;
    failed = true;
    reply.status = 500;
    reply.data = { error: 'internal error' };
  });
  await waitForPlayback(page);
  const before = await gameSnapshot(page);
  await (await nextMove(page)).click();
  const banner = page.locator('.error-banner');
  await expect(banner.locator('.error-message')).toHaveText('internal error');
  stop();
  expect(await gameSnapshot(page)).toBe(before);
  await banner.getByRole('button', { name: '再試行' }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => gameSnapshot(page)).not.toBe(before);
  await playOneStep(page);
  await expect(banner).toHaveCount(0);
});

test('a refused request: no 再試行', async ({ page }) => {
  await watchEngine(page);
  await page.goto('./?seed=1&turns=18');
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  onEngineReply(page, (call, reply) => {
    if (call.fn !== 'request' || !/\/discard/.test(call.path ?? '')) return;
    reply.status = 409;
    reply.data = { error: 'conflict' };
  });
  await hand.locator('.hand-drawn button').click();
  const banner = page.locator('.error-banner');
  await expect(banner.locator('.error-message')).toHaveText('conflict');
  await expect(banner.getByRole('button', { name: '再試行' })).toHaveCount(0);
  await expect(banner.getByRole('button', { name: '再読み込み' })).toBeVisible();
});

test('an engine that fails to load: 再試行 deals the URL\'s seed again', async ({ page }) => {
  await page.route('**/mhj-dojo.wasm*', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('./?seed=1&turns=18');
  const banner = page.locator('.error-banner');
  await expect(banner).toContainText('計算エンジン');
  await expect(banner.getByRole('button', { name: '再読み込み' })).toBeVisible();
  await page.unroute('**/mhj-dojo.wasm*');
  await banner.getByRole('button', { name: '再試行' }).click();
  await expect(handPanel(page).locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]seed=1(&|$)/);
});

test('a failed discard: 再試行 sends it again', async ({ page }) => {
  await page.goto('./?seed=2&turns=18');
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  // The engine fails the next discard without making it.
  await page.workers()[0].evaluate(() => {
    const orig = self.onmessage!;
    let failed = false;
    self.onmessage = (e: MessageEvent) => {
      if (!failed && e.data.fn === 'request' && /\/discard/.test(e.data.args[1])) {
        failed = true;
        self.postMessage({ id: e.data.id, status: 500, body: '{"error":"boom"}' });
        return;
      }
      orig.call(self, e);
    };
  });
  await hand.locator('.hand-drawn button').click();
  const banner = page.locator('.error-banner');
  await expect(banner).toContainText('boom');
  await expect(hand.locator('.discard-river .tile')).toHaveCount(0);
  await banner.getByRole('button', { name: '再試行' }).click();
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  await expect(banner).toHaveCount(0);
  await discardDrawn(page);
});

test('a localStorage refusing every write is told once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'mhj-dojo.site.games') throw new DOMException('full', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto(GAME_URL);
  await expect(handPanel(page)).toBeVisible();
  const notice = page.locator('.save-failed');
  await expect(notice).toHaveText(/このブラウザに保存できません。再読み込みすると最初からになります/);
  await notice.getByRole('button', { name: '閉じる' }).click();
  await expect(notice).toHaveCount(0);
  await playOneStep(page);
  await playOneStep(page);
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
