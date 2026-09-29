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
  return page.getByRole('alertdialog', { name: 'このタブは別のタブで開かれたため停止しました' });
}

/** The dialog covers the page: shown modal, so everything else is inert. */
async function expectStopped(page: Page) {
  await expect(stoppedDialog(page)).toBeVisible();
  expect(await stoppedDialog(page).evaluate((d) => d.matches(':modal'))).toBe(true);
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

  // A stops: the dialog covers it, and it sends nothing more.
  await expectStopped(page);
  await expect(stoppedDialog(other)).toHaveCount(0);
  const sent: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) sent.push(`${req.method()} ${req.url()}`);
  });
  const handA = page.getByRole('region', { name: '手牌' });

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
  await expectStopped(other);
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

  await page.route('**/api/sessions/*/discard*', (route) =>
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

/** Opens practice mode with every panel open (the layout is kept in localStorage; a reload keeps its own). */
async function openAllPanels(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-minimized')) return;
    localStorage.setItem('mhj-dojo.minimized.v2', '[]');
    sessionStorage.setItem('e2e-minimized', '1');
  });
  await page.goto('/?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '時系列チャート' })).toBeVisible();
}

// The panels are memoized, so their – buttons keep the callback of an
// earlier render: each must still act on the latest set of minimized panels
// (a stale one would bring back a panel minimized since).
test('minimize and restore: each panel goes to the dock and back, the others stay put', async ({ page }) => {
  await openAllPanels(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  const panels = [
    { region: '時系列チャート', button: '時系列チャートを最小化', tab: '時系列チャート' },
    { region: '履歴ツリー', button: '履歴ツリーを最小化', tab: '履歴ツリー' },
    { region: '役別向聴テーブル', button: '役別向聴を最小化', tab: '役別向聴' },
    { region: 'アドバイス', button: 'アドバイスを最小化', tab: 'アドバイス' },
    { region: '用語表', button: '用語表を最小化', tab: '用語表' },
  ];
  await expect(dock).toHaveCount(0);

  // One at a time, with a new node (new data for the panels) in between.
  for (const [i, p] of panels.entries()) {
    await page.getByRole('region', { name: p.region }).getByRole('button', { name: p.button }).click();
    await expect(page.getByRole('region', { name: p.region })).toBeHidden();
    await expect(dock.getByRole('button')).toHaveText(panels.slice(0, i + 1).map((q) => new RegExp(q.tab)));
    if (i < 2) await discardDrawn(page);
  }
  // A minimized panel draws nothing, but its place is kept.
  await expect(page.locator('.area-chart')).toBeAttached();
  await expect(page.locator('.area-chart > *')).toHaveCount(0);

  // Back from the dock in another order, each leaving the rest docked.
  for (const [i, p] of [...panels].reverse().entries()) {
    await dock.getByRole('button', { name: p.tab }).click();
    await expect(page.getByRole('region', { name: p.region })).toBeVisible();
    await expect(dock.getByRole('button')).toHaveCount(panels.length - i - 1);
  }
  await expect(page.locator('.yaku-table tbody tr')).not.toHaveCount(0);

  // Two in one go (before the page renders again), and then the layout survives a reload.
  await page.evaluate(() => {
    for (const name of ['時系列チャートを最小化', '用語表を最小化']) {
      document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click();
    }
  });
  await expect(dock.getByRole('button')).toHaveText([/時系列チャート/, /用語表/]);
  await page.reload();
  await expect(page.getByRole('region', { name: '履歴ツリー' })).toBeVisible();
  await expect(dock.getByRole('button')).toHaveText([/時系列チャート/, /用語表/]);
});

// A minimized panel stays mounted: its own state (the chart's legend, the
// glossary's search) is there again when it comes back, even after new data
// arrived while it was in the dock, which it then shows.
test('minimize and restore keep the chart legend and the glossary search', async ({ page }) => {
  await openAllPanels(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  const chart = page.getByRole('region', { name: '時系列チャート' });
  const glossary = page.getByRole('region', { name: '用語表' });

  const legend = chart.locator('.legend-item');
  const off = chart.locator('.legend-item[aria-pressed="false"]').first();
  const name = (await off.textContent())!;
  await off.click();
  const item = legend.filter({ hasText: name });
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  const onBefore = await chart.locator('.legend-item[aria-pressed="true"]').count();
  const search = glossary.getByRole('searchbox', { name: '用語を検索' });
  await search.fill('リャンメン');
  await expect(glossary.locator('.glossary-item')).toHaveCount(1);

  await chart.getByRole('button', { name: '時系列チャートを最小化' }).click();
  await glossary.getByRole('button', { name: '用語表を最小化' }).click();
  await expect(chart).toBeHidden();
  await expect(glossary).toBeHidden();
  await discardDrawn(page);
  await expect(page.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(1);

  await dock.getByRole('button', { name: '時系列チャート' }).click();
  await dock.getByRole('button', { name: '用語表' }).click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('.legend-item[aria-pressed="true"]')).toHaveCount(onBefore);
  // The chart shows the node discarded to while it was docked: two turns.
  await expect(chart.locator('.chart-axis-label[text-anchor="middle"]')).toHaveCount(2);
  await expect(search).toHaveValue('リャンメン');
  await expect(glossary.locator('.glossary-item')).toHaveCount(1);
});

/** The whole state of the page's session, as the server has it (the view the page doesn't ask for). */
async function fullState(page: Page) {
  await expect(page).toHaveURL(/[?&]session=/);
  const id = new URL(page.url()).searchParams.get('session');
  const res = await page.request.get(`/api/sessions/${encodeURIComponent(id!)}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as {
    node_count: number;
    hand: string[];
    tree: { node_id: number; discard: string | null }[];
    remaining: Record<string, number>;
    analysis: { key: string; name: string; han: number; yakuman: boolean }[];
    by_discard: Record<string, { key: string; shanten: number | null; ukeire: string[]; ukeire_total: number }[]>;
    advice: { candidates: { tile: string }[] } | null;
    discard_review: { text: string } | null;
  };
}

// While the advice panel is minimized the page asks for no advice
// (?advice=0), so neither the advice nor the review of a discard is computed;
// opening the panel asks for the state again with them, and they are the
// same as if they had been there all along.
test('advice: left out while minimized, filled in (the review too) when the panel opens', async ({ page }) => {
  await page.goto('/?seed=3&turns=18');
  // The session is created after the page loads: count only what follows it.
  await expect(page).toHaveURL(/[?&]session=/);
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeEnabled();
  const sent: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/sessions')) sent.push(`${req.method()} ${new URL(req.url()).pathname}${new URL(req.url()).search}`);
  });
  await discardDrawn(page);
  await discardDrawn(page);
  expect(sent.length).toBe(2);
  for (const s of sent) expect(s).toMatch(/^POST \/api\/sessions\/[^/]+\/discard\?advice=0&tree_from=\d+$/);

  const panel = page.getByRole('region', { name: 'アドバイス' });
  const dockTab = page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' });
  const get = page.waitForResponse((res) => res.request().method() === 'GET' && res.url().includes('/api/sessions/'));
  await dockTab.click();
  const res = await get;
  expect(new URL(res.url()).searchParams.get('advice')).toBeNull();
  const want = await fullState(page);
  expect(want.advice!.candidates).toHaveLength(3);
  await expect(panel.locator('.advice-candidate')).toHaveCount(3);
  await expect(panel.locator('.advice-review')).toHaveText(want.discard_review!.text);

  // With the panel open, the next discard brings its advice and review along.
  sent.length = 0;
  await discardDrawn(page);
  expect(sent).toEqual([expect.stringMatching(/\/discard\?tree_from=3$/)]);
  await expect(panel.locator('.advice-review')).toHaveText((await fullState(page)).discard_review!.text);
});

// The page asks only for the tree nodes it lacks (?tree_from=) and appends
// them: the tree stays whole across moves, branches, gotos and a reload.
test('history tree: only new nodes are sent, the tree stays whole across goto, branches and reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-minimized')) return;
    localStorage.setItem('mhj-dojo.minimized.v2', JSON.stringify(['chart', 'advice', 'gloss']));
    sessionStorage.setItem('e2e-minimized', '1');
  });
  await page.goto('/?seed=5&turns=18');
  const tree = page.getByRole('region', { name: '履歴ツリー' });
  const nodes = tree.locator('.tree-node-btn');
  const hand = page.getByRole('region', { name: '手牌' });
  const shown = () => nodes.evaluateAll((els) => els.map((e) => e.textContent));
  const trees: number[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/sessions/')) trees.push(((await res.json()) as { tree: unknown[] }).tree.length);
  });

  await discardDrawn(page);
  await discardDrawn(page);
  await discardDrawn(page);
  await expect(nodes).toHaveCount(4);
  await nodes.nth(1).click();
  await expect(nodes.nth(1)).toHaveAttribute('aria-current', 'true');
  // A branch: a tile other than the one discarded from here before.
  const at1 = await fullState(page);
  const other = at1.hand.findIndex((t) => t !== at1.tree[2].discard);
  await hand.locator('.hand-tiles button').nth(other).click();
  await expect(nodes).toHaveCount(5);
  await nodes.nth(3).click();
  await expect(nodes.nth(3)).toHaveAttribute('aria-current', 'true');
  // Each discard sent back its one new node, each goto none.
  expect(trees).toEqual([1, 1, 1, 0, 1, 0]);

  const whole = await fullState(page);
  expect(whole.node_count).toBe(5);
  expect(whole.tree).toHaveLength(5);
  const before = await shown();
  await page.reload();
  await expect(nodes).toHaveCount(5);
  expect(await shown()).toEqual(before);
  await expect(nodes.nth(3)).toHaveAttribute('aria-current', 'true');
  await discardDrawn(page);
  await expect(nodes).toHaveCount(6);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// A discard preview (hovering a tile) joins by_discard's rows with the
// analysis's names and han, and counts their ukeire from remaining: the
// table shows what the server's preview says, as before.
test('preview: the rows after a discard, with names, han and remaining counts', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yaku.locator('.yaku-table tbody tr')).not.toHaveCount(0);
  const st = await fullState(page);
  // The hand's buttons are in the hand's order.
  await hand.locator('.hand-tiles button').nth(4).hover();
  await expect(yaku.locator('.preview-note')).toBeVisible();
  const preview = st.by_discard[st.hand[4]];
  expect(preview).toBeTruthy();

  const rows = await yaku.locator('.yaku-table tbody tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      name: tr.querySelector('.yaku-name')!.textContent,
      han: tr.querySelector('.han-cell')!.textContent,
      shanten: tr.querySelector('.shanten-cell > span')!.textContent,
      counts: [...tr.querySelectorAll('.ukeire-count')].map((c) => Number(c.textContent)),
      total: Number(tr.querySelector('.ukeire-total-cell')!.textContent),
    })),
  );
  expect(rows.length).toBeGreaterThan(20);
  for (const r of rows) {
    const a = st.analysis.find((x) => x.name === r.name)!;
    const p = preview.find((x) => x.key === a.key)!;
    expect(r.han).toBe(a.yakuman ? '役満' : a.han > 0 ? `${a.han}翻` : '—');
    expect(r.shanten).toBe(p.shanten === null ? '不可' : p.shanten === 0 ? '聴牌' : `${p.shanten}向聴`);
    expect(r.counts).toEqual(p.ukeire.map((t) => st.remaining[t]));
    expect(r.total).toBe(p.ukeire_total);
  }
});

// On a wider screen the yaku filter bar starts open; 絞り込み folds it away
// but for the count (mobile.spec.ts has the phone's side).
test('the yaku filter bar starts open on a desktop and folds away', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  const toggle = yaku.getByRole('button', { name: /絞り込み/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(yaku.getByRole('searchbox', { name: '役名で検索' })).toBeVisible();
  await expect(yaku.getByRole('combobox')).toHaveCount(2);
  await expect(yaku.getByRole('button', { name: '役満' })).toBeVisible();
  const height = (await yaku.locator('.yaku-filter').boundingBox())!.height;

  await yaku.getByRole('searchbox', { name: '役名で検索' }).fill('ピンフ');
  await expect(yaku.locator('.yaku-filter-count')).toHaveText(/^1 \/ \d+役を表示中$/);
  // 条件をクリア joins the count's row: the bar is no taller.
  await expect(yaku.getByRole('button', { name: '条件をクリア' })).toBeVisible();
  expect(Math.abs((await yaku.locator('.yaku-filter').boundingBox())!.height - height)).toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(yaku.getByRole('searchbox')).toHaveCount(0);
  await expect(yaku.getByRole('button', { name: '役満' })).toHaveCount(0);
  // Folding keeps the search: one row, and the count and 条件をクリア say so.
  await expect(yaku.locator('.yaku-filter-count')).toHaveText(/^1 \/ \d+役を表示中$/);
  await expect(yaku.getByRole('button', { name: '条件をクリア' })).toBeVisible();
});
