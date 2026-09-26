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
  const engineFile = (name: string) =>
    page.waitForResponse((res) => new URL(res.url()).pathname.endsWith(`/${name}`));
  const files = ['worker.js', 'wasm_exec.js', 'mhj2.wasm'].map(engineFile);
  await page.goto('./?seed=1&turns=18');

  // The three engine files are loaded with one version (cache busting).
  const responses = await Promise.all(files);
  const versions = responses.map((res) => new URL(res.url()).searchParams.get('v'));
  expect(versions[0]).toMatch(/^[0-9a-f]{12}$/);
  expect(new Set(versions).size).toBe(1);
  expect(responses[2].headers()['content-type']).toBe('application/wasm');

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
  const url = page.url();

  // Twice: the rebuilt session keeps its id, so the URL (a bookmark) stays
  // good across any number of reloads.
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(nodes).toHaveCount(4);
    await expect(nodes.nth(3)).toHaveAttribute('aria-current', 'true');
    expect(await labels(page, '.discard-river')).toEqual(riverBefore);
    expect(await labels(page, '.hand-tiles')).toEqual(handBefore);
    await expect(page.locator('.error-banner')).toHaveCount(0);
    expect(page.url()).toBe(url);
  }

  // Acting on the rebuilt session works and is saved in turn.
  await discardDrawn(page);
  await expect(nodes).toHaveCount(5);
  await page.reload();
  await expect(nodes).toHaveCount(5);
  expect(page.url()).toBe(url);
});

test('two tabs keep their own saved sessions', async ({ page, context }) => {
  const other = await context.newPage();
  await page.goto('./?seed=11&turns=18');
  await other.goto('./?seed=12&turns=18');
  await discardDrawn(page);
  await discardDrawn(other);
  await discardDrawn(other);
  for (const [p, n] of [
    [page, 1],
    [other, 2],
  ] as const) {
    await p.reload();
    await expect(p.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(n);
    await expect(p.locator('.error-banner')).toHaveCount(0);
  }
});

// Seed 2's best-advice line: eleven discards, then tsumo on the twelfth draw.
const TSUMO_LINE = ['6z', '7z', '1m', '2s', '9p', '2z', '9m', '2z', '7z', '8s', '5s'];
const tsumoMoves = [...TSUMO_LINE.map((tile, i) => ({ parent: i, tile })), { parent: TSUMO_LINE.length }];

async function seedStorage(page: Page, id: string, current: number) {
  const saved = { v: 2, sessions: { [id]: { seed: 2, max_turns: 18, moves: tsumoMoves, current, used: 1 } } };
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('mhj2.site.practice', s);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(saved));
}

test('a saved tsumo node is rebuilt with its win', async ({ page }) => {
  await seedStorage(page, 'e2etsumo', tsumoMoves.length);
  await page.goto('./?session=e2etsumo&seed=2&turns=18');
  await expect(page.getByRole('region', { name: '和了' })).toBeVisible();
  const nodes = page.getByRole('region', { name: '履歴ツリー' }).locator('.tree-node-btn');
  await expect(nodes).toHaveCount(tsumoMoves.length + 1);
  await expect(nodes.last()).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(/[?&]session=e2etsumo(&|$)/);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('a saved session resumes at an inner node', async ({ page }) => {
  await seedStorage(page, 'e2einner', 3);
  await page.goto('./?session=e2einner&seed=2&turns=18');
  const nodes = page.getByRole('region', { name: '履歴ツリー' }).locator('.tree-node-btn');
  await expect(nodes).toHaveCount(tsumoMoves.length + 1);
  await expect(nodes.nth(3)).toHaveAttribute('aria-current', 'true');
  expect(await labels(page, '.discard-river')).toHaveLength(3);
  await expect(page.getByRole('region', { name: '和了' })).toHaveCount(0);
  // The review of the discard that led here is computed on the rebuilt node.
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('an engine that fails to load shows an error, and a new game retries', async ({ page }) => {
  await page.route('**/mhj2.wasm*', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('./?seed=1&turns=18');
  await expect(page.locator('.error-banner')).toContainText('計算エンジン');
  await page.unroute('**/mhj2.wasm*');
  await page.getByRole('button', { name: '新規対局' }).click();
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('unusable saved moves start over from the seed in the URL', async ({ page }) => {
  await page.goto('./?seed=3&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand).toBeVisible();
  const start = await labels(page, '.hand-tiles');
  await discardDrawn(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mhj2.site.practice')!);
    const id = new URL(location.href).searchParams.get('session')!;
    s.sessions[id].moves[0].tile = '9z'; // not a tile that can be discarded
    localStorage.setItem('mhj2.site.practice', JSON.stringify(s));
  });
  await page.reload();
  await expect(hand.locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(hand.locator('.discard-river .tile')).toHaveCount(0);
  expect(await labels(page, '.hand-tiles')).toEqual(start);
  // The unusable save is dropped; the fresh session is saved instead.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mhj2.site.practice')!));
  const id = new URL(page.url()).searchParams.get('session')!;
  expect(saved.sessions[id].moves).toEqual([]);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
