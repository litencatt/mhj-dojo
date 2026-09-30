import { expect, test, type Page } from '@playwright/test';
import { discardDrawn, stoppedDialog } from '../helpers';

// Practice mode on the local server only: its HTTP API (what the page asks
// for, errors in its shape) and two browsers on one session (e2e/shared has
// the rest, on both builds).

// Two browsers on the same practice session (issue #53; two tabs of one
// browser would stop each other, see e2e/shared): page A discards first, moving
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
