import { expect, test } from '@playwright/test';

// Solo practice mode (the root page): load a fixed seed and discard once,
// checking that both the table (discard river) and the analysis (yaku
// table) update from the server response.
test('practice mode loads and a discard updates the table and analysis', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');

  const handPanel = page.getByRole('region', { name: '手牌' });
  await expect(handPanel).toBeVisible();

  const yakuPanel = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yakuPanel).toBeVisible();
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);

  // 13 hand tiles + 1 drawn tile, nothing discarded yet.
  await expect(handPanel.locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(handPanel.locator('.discard-river')).toHaveCount(0);

  // Capture the analysis before discarding, to prove it actually changes
  // (not just "still has rows") once the new node's analysis comes back.
  const analysisBody = yakuPanel.locator('.yaku-table tbody');
  const analysisBefore = await analysisBody.innerText();

  // Discard the drawn tile: the simplest legal move from any seeded hand.
  const drawn = handPanel.locator('.hand-drawn button');
  await expect(drawn).toBeVisible();
  const drawnTile = await drawn.getAttribute('aria-label');
  expect(drawnTile).toBeTruthy();
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
    drawn.click(),
  ]);

  // The table now shows one discard in the river, holding that tile.
  await expect(handPanel.locator('.discard-river .tile')).toHaveCount(1);
  await expect(handPanel.locator(`.discard-river [aria-label="${drawnTile}"]`)).toBeVisible();

  // The analysis table is repopulated for the new node, and its content
  // actually changed (a different 13-tile hand has different shanten rows).
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);
  await expect(analysisBody).not.toHaveText(analysisBefore);
});

// Two tabs on the same practice session (issue #53): page A discards first,
// moving the session on; page B, still showing the pre-discard node, then
// discards too. Its request carries the node it acted from (node_id), the
// server rejects it as stale (409, mirroring the game stale-tab test in
// game.spec.ts), and the client's re-fetch-on-real-change logic shows the
// notice instead of an error and lands page B on the current node.
test('a stale tab: discarding after another tab moved the session on shows a notice, not an error', async ({
  page,
  context,
}) => {
  await page.goto('/?seed=1&turns=18');
  const handA = page.getByRole('region', { name: '手牌' });
  await expect(handA).toBeVisible();

  // Page B: the same session, fetched fresh before either tab has acted -
  // it sees the same root node as page A. The URL gets ?session= in an
  // effect after the first paint, so wait for it.
  await expect(page).toHaveURL(/[?&]session=/);
  const sessionId = new URL(page.url()).searchParams.get('session');
  expect(sessionId, 'the URL should carry the server-assigned session id').toBeTruthy();
  const pageB = await context.newPage();
  await pageB.goto(`/?session=${sessionId}`);
  const handB = pageB.getByRole('region', { name: '手牌' });
  const drawnB = handB.locator('.hand-drawn button');
  await expect(drawnB).toBeVisible();

  // Page A discards its drawn tile, moving the session to node 1.
  const drawnA = handA.locator('.hand-drawn button');
  await expect(drawnA).toBeVisible();
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
    drawnA.click(),
  ]);
  await expect(handA.locator('.discard-river .tile')).toHaveCount(1);

  // Page B, unaware, discards from its now-stale node 0: the server rejects
  // it (409, node_id no longer matches), the client re-fetches, sees the
  // session really did move on (a different node_id), and shows a notice
  // instead of the raw error, landing on the current (node 1) state.
  await Promise.all([
    pageB.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
    drawnB.click(),
  ]);
  await expect(pageB.locator('.notice-banner')).toBeVisible({ timeout: 15_000 });
  await expect(pageB.locator('.error-banner')).toBeHidden();
  await expect(handB.locator('.discard-river .tile')).toHaveCount(1);
});

// The 面子表示 toggle regroups the hand under labelled brackets without a
// request, keeps every tile, restores the plain order when turned off, and
// is remembered across a reload.
test('hand groups toggle: brackets, the same tiles, restore and reload', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  const handPanel = page.getByRole('region', { name: '手牌' });
  const tiles = handPanel.locator('.hand-tiles .tile');
  await expect(tiles).toHaveCount(13);
  const toggle = handPanel.getByLabel('面子表示');
  await expect(toggle).not.toBeChecked(); // off by default
  const labels = () => tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const plain = await labels();

  let requests = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/')) requests++;
  });
  await toggle.check();
  const groups = handPanel.locator('.hand-group');
  await expect(groups.first()).toBeVisible();
  await expect(tiles).toHaveCount(13);
  expect([...(await labels())].sort()).toEqual([...plain].sort());
  const names = await handPanel.locator('.hand-group-label').allInnerTexts();
  expect(names.length).toBe(await groups.count());
  for (const n of names) expect(['順子', '刻子', '雀頭', '両面', '嵌張', '辺張', '対子', '浮き']).toContain(n);
  expect(requests, 'the toggle sends no request').toBe(0);

  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(groups.first()).toBeVisible();

  await toggle.uncheck();
  await expect(groups).toHaveCount(0);
  expect(await labels()).toEqual(plain);
});

test('hand groups fit a 390px-wide viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=1&turns=18');
  const handPanel = page.getByRole('region', { name: '手牌' });
  await handPanel.getByLabel('面子表示').check();
  await expect(handPanel.locator('.hand-group').first()).toBeVisible();
  await expect(handPanel.locator('.hand-tiles .tile')).toHaveCount(13);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
