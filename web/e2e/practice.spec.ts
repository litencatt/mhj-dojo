import { expect, test, type Page } from '@playwright/test';

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
  // The 複合役 section lists up to five yaku combinations, named with ＋.
  const comboRows = yakuPanel.locator('.combo-table tbody tr');
  await expect(comboRows).not.toHaveCount(0);
  expect(await comboRows.count()).toBeLessThanOrEqual(5);
  await expect(comboRows.first().locator('th')).toContainText('＋');

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

// Two browsers on the same practice session (issue #53; two tabs of one
// browser would stop each other, see below): page A discards first, moving
// the session on; page B, still showing the pre-discard node, then discards
// too. Its request carries the node it acted from (node_id), the
// server rejects it as stale (409, mirroring the game stale-tab test in
// game.spec.ts), and the client's re-fetch-on-real-change logic shows the
// notice instead of an error and lands page B on the current node.
test('a stale browser: discarding after another browser moved the session on shows a notice, not an error', async ({
  page,
  browser,
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
  const pageB = await (await browser.newContext()).newPage();
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
  for (const p of [page, pageB]) await expect(stoppedDialog(p)).toHaveCount(0);
  await pageB.context().close();
});

// One tab of a browser at a time plays a session (src/singleTab.ts): the
// newest tab to open it wins, and the one before stops until taken back.
function stoppedDialog(page: Page) {
  return page.getByRole('dialog', { name: 'このタブは別のタブで開かれたため停止しました' });
}

async function discardDrawn(page: Page) {
  const hand = page.getByRole('region', { name: '手牌' });
  const river = hand.locator('.discard-river .tile');
  const before = await river.count();
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  await drawn.click();
  await expect(river).toHaveCount(before + 1);
}

function riverOf(page: Page) {
  return page
    .getByRole('region', { name: '手牌' })
    .locator('.discard-river .tile')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

test('a second tab on the same session stops the first, until taken back', async ({ page, context }) => {
  await page.goto('/?seed=21&turns=18');
  await discardDrawn(page);
  await expect(page).toHaveURL(/[?&]session=/);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(1);

  // A stops: the dialog covers it, nothing under it can be clicked, and it
  // sends nothing more.
  await expect(stoppedDialog(page)).toBeVisible();
  await expect(stoppedDialog(other)).toHaveCount(0);
  const sent: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) sent.push(`${req.method()} ${req.url()}`);
  });
  const handA = page.getByRole('region', { name: '手牌' });
  await expect(handA.locator('.hand-drawn button').click({ timeout: 1000 })).rejects.toThrow();
  await expect(page.getByRole('button', { name: '新規対局' }).click({ timeout: 1000 })).rejects.toThrow();

  // B plays on.
  await discardDrawn(other);
  await discardDrawn(other);
  expect(sent).toEqual([]);

  // A takes it back with a GET, from where B left it; now B stops.
  const get = page.waitForRequest((req) => req.method() === 'GET' && /\/api\/sessions\/[^/]+$/.test(req.url()));
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await get;
  await expect(stoppedDialog(page)).toHaveCount(0);
  await expect(handA.locator('.discard-river .tile')).toHaveCount(3);
  expect(await riverOf(page)).toEqual(await riverOf(other));
  await expect(stoppedDialog(other)).toBeVisible();
  await discardDrawn(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('tabs on different sessions both play, and a new session lets go of the one before', async ({
  page,
  context,
}) => {
  await page.goto('/?seed=31&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  const first = page.url();
  await page.locator('.new-game-form input[type="number"]').first().fill('32');
  await page.getByRole('button', { name: '新規対局' }).click();
  await expect(page).toHaveURL(/[?&]seed=32(&|$)/);

  const other = await context.newPage();
  await other.goto(first);
  await discardDrawn(other);
  await discardDrawn(page);
  await discardDrawn(other);
  for (const p of [page, other]) {
    await expect(stoppedDialog(p)).toHaveCount(0);
    await expect(p.locator('.error-banner')).toHaveCount(0);
  }
});

// The 面子表示 toggle regroups the hand under labelled brackets without a
// request, keeps every tile, restores the plain order when turned off, and
// is remembered across a reload.
test('hand groups toggle: brackets, the same tiles, restore and reload', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  const handPanel = page.getByRole('region', { name: '手牌' });
  const tiles = handPanel.locator('.hand-tiles .tile');
  await expect(tiles).toHaveCount(13);
  const toggle = handPanel.getByRole('button', { name: '面子表示' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false'); // off by default
  const labels = () => tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const plain = await labels();

  let requests = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/')) requests++;
  });
  await toggle.click();
  const groups = handPanel.locator('.hand-group');
  await expect(groups.first()).toBeVisible();
  await expect(tiles).toHaveCount(13);
  expect([...(await labels())].sort()).toEqual([...plain].sort());
  const names = await handPanel.locator('.hand-group-label').allInnerTexts();
  expect(names.length).toBe(await groups.count());
  for (const n of names) expect(['順子', '刻子', '雀頭', '両面', '嵌張', '辺張', '対子', '浮き']).toContain(n);
  expect(requests, 'the toggle sends no request').toBe(0);

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(groups.first()).toBeVisible();

  await toggle.click();
  await expect(groups).toHaveCount(0);
  expect(await labels()).toEqual(plain);
});

// The advice panel starts minimized in the right-edge dock (so the answer
// isn't shown before the player has thought), opens from its dock tab, lists
// three candidates, highlights a hovered candidate in the hand, stays open
// across a reload, minimizes back to the dock, and after a discard reviews it
// against the best one.
test('advice panel: docked by default, three candidates, remembered, review after a discard', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  const panel = page.getByRole('region', { name: 'アドバイス' });
  const dockTab = page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' });
  await expect(panel).toBeHidden();
  await expect(dockTab).toBeVisible();
  const candidates = panel.locator('.advice-candidate');

  await dockTab.click();
  await expect(panel).toBeVisible();
  await expect(dockTab).toBeHidden();
  await expect(candidates).toHaveCount(3);
  await expect(panel.locator('.advice-outlook')).toContainText('1巡目');

  // Hovering a candidate marks that tile in the hand.
  const best = await candidates.first().locator('.tile').getAttribute('aria-label');
  expect(best).toBeTruthy();
  await candidates.first().hover();
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand.locator('.tile-advice').first()).toHaveAttribute('aria-label', best!);

  await page.reload();
  await expect(panel).toBeVisible();
  await expect(candidates).toHaveCount(3);

  // Discard the recommended tile: the next node reviews it as the best.
  const tile = hand.locator(`.hand-tiles [aria-label="${best}"], .hand-drawn [aria-label="${best}"]`).first();
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
    tile.click(),
  ]);
  await expect(panel.locator('.advice-review')).toHaveText(/^前巡の打 .+: 最善/);
  await expect(candidates).toHaveCount(3);

  // The – button sends it back to the dock.
  await panel.getByRole('button', { name: 'アドバイスを最小化' }).click();
  await expect(panel).toBeHidden();
  await expect(dockTab).toBeVisible();
});

test('hand groups fit a 390px-wide viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=1&turns=18');
  const handPanel = page.getByRole('region', { name: '手牌' });
  await handPanel.getByRole('button', { name: '面子表示' }).click();
  await expect(handPanel.locator('.hand-group').first()).toBeVisible();
  await expect(handPanel.locator('.hand-tiles .tile')).toHaveCount(13);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

// Server error messages are English, meant for API clients, and sometimes
// embed a raw tile code (session.go's "tile %q is not in hand or drawn").
// errorMessage() (panels.ts) must turn a quoted or bare code into its name
// before it reaches the error banner, but leave a longer, non-code token
// (e.g. "18p") alone. Intercept a discard with the server's actual error
// shape (400, {"error": "..."}) instead of provoking a real one, since a
// real rejection (an out-of-hand tile) never reaches the client - only
// hand tiles are clickable.
test('a server error with a tile code shows the tile name, not the code', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  const handPanel = page.getByRole('region', { name: '手牌' });
  const drawn = handPanel.locator('.hand-drawn button');
  await expect(drawn).toBeVisible();

  await page.route('**/api/sessions/*/discard', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'tile "5p" is not in hand or drawn (also 5p, seat 2, 18p)' }),
    }),
  );

  await drawn.click();
  const banner = page.getByRole('alert');
  await expect(banner).toHaveText('tile 5筒 is not in hand or drawn (also 5筒, seat 2, 18p)');
});
