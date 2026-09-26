import { expect, test, type Page } from '@playwright/test';

// The static site (issue #67): practice mode with the engine running as
// WebAssembly in a Web Worker, no mhj2 server behind it.

// The tiles' names in a hand or river, in order.
function labels(page: Page, selector: string) {
  return page
    .getByRole('region', { name: '手牌' })
    .locator(`${selector} .tile`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

async function discardDrawn(page: Page) {
  const hand = page.getByRole('region', { name: '手牌' });
  const river = hand.locator('.discard-river .tile');
  const before = await river.count();
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  const tile = await drawn.getAttribute('aria-label');
  await drawn.click();
  await expect(river).toHaveCount(before + 1);
  return tile;
}

test('practice runs in the browser: load, discard, no server requests, no CPU mode', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) apiRequests.push(req.url());
  });
  const wasm = page.waitForResponse((res) => res.url().endsWith('/mhj2.wasm'));
  await page.goto('./?seed=1&turns=18');

  const res = await wasm;
  expect(res.headers()['content-type']).toBe('application/wasm');

  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand).toBeVisible();
  await expect(hand.locator('.hand-tiles .tile')).toHaveCount(13);
  const init = await page.evaluate(() => performance.getEntriesByName('mhj2:wasm-init')[0]?.duration ?? -1);
  expect(init).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'wasm init (ms)', description: init.toFixed(0) });

  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  const rows = yaku.locator('.yaku-table tbody');
  await expect(rows.locator('tr')).not.toHaveCount(0);
  const before = await rows.innerText();

  const t0 = Date.now();
  const tile = await discardDrawn(page);
  test.info().annotations.push({ type: 'discard (ms)', description: String(Date.now() - t0) });
  await expect(hand.locator(`.discard-river [aria-label="${tile}"]`)).toBeVisible();
  await expect(rows).not.toHaveText(before);

  await expect(page).toHaveURL(/[?&]session=/);
  await expect(page.getByRole('link', { name: 'CPU対戦へ' })).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test('?mode=game shows practice on the static site', async ({ page }) => {
  await page.goto('./?mode=game');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('a reload replays the saved moves, branches included', async ({ page }) => {
  await page.goto('./?seed=7&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand).toBeVisible();
  await discardDrawn(page);
  await discardDrawn(page);

  // Back to the first discard and branch off with a hand tile instead.
  const tree = page.getByRole('region', { name: '履歴ツリー' });
  const nodes = tree.locator('.tree-node-btn');
  await expect(nodes).toHaveCount(3);
  await nodes.nth(1).click();
  await expect(nodes.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  await hand.locator('.hand-tiles button').first().click();
  await expect(nodes).toHaveCount(4);
  await expect(hand.locator('.discard-river .tile')).toHaveCount(2);

  const handBefore = await labels(page, '.hand-tiles');
  const riverBefore = await labels(page, '.discard-river');
  const oldId = new URL(page.url()).searchParams.get('session');

  await page.reload();
  await expect(nodes).toHaveCount(4);
  await expect(nodes.nth(3)).toHaveAttribute('aria-current', 'true');
  expect(await labels(page, '.discard-river')).toEqual(riverBefore);
  expect(await labels(page, '.hand-tiles')).toEqual(handBefore);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  // The rebuilt session has a new id, and the URL follows it.
  await expect(page).not.toHaveURL(new RegExp(`session=${oldId}`));
  await expect(page).toHaveURL(/[?&]seed=7/);
});

test('unusable saved moves start over from the seed in the URL', async ({ page }) => {
  await page.goto('./?seed=3&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand).toBeVisible();
  const start = await labels(page, '.hand-tiles');
  await discardDrawn(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mhj2.site.practice')!);
    s.moves[0][1] = '9z'; // not a tile that can be discarded
    localStorage.setItem('mhj2.site.practice', JSON.stringify(s));
  });
  await page.reload();
  await expect(hand.locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(hand.locator('.discard-river .tile')).toHaveCount(0);
  expect(await labels(page, '.hand-tiles')).toEqual(start);
  expect(await page.evaluate(() => localStorage.getItem('mhj2.site.practice'))).toContain('"moves":[]');
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
