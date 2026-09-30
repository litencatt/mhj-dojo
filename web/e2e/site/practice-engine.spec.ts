import { expect, test } from '@playwright/test';
import { discardDrawn, engineSession, isRequest, nextEngineReply, onEngineReply, watchEngine } from '../helpers';

// Practice mode against what its engine answers: an error in the engine's
// shape, which calls the page makes (?advice=0, ?tree_from=), and the tables
// checked against the whole session as the engine has it (engineSession).
// e2e/shared and e2e/site/practice.spec.ts have the rest.

test.beforeEach(async ({ page }) => {
  await watchEngine(page);
});

interface Session {
  node_count: number;
  hand: string[];
  tree: { node_id: number; discard: string | null }[];
  remaining: Record<string, number>;
  analysis: { key: string; name: string; han: number; yakuman: boolean }[];
  by_discard: Record<string, { key: string; shanten: number | null; ukeire: string[]; ukeire_total: number }[]>;
  advice: { candidates: { tile: string }[] } | null;
  discard_review: { text: string } | null;
}

// The engine's error messages are English, meant for API clients, and
// sometimes embed a raw tile code (session.go's "tile %q is not in hand or
// drawn"). errorMessage() (panels.ts) must turn a quoted or bare code into
// its name before it reaches the error banner, but leave a longer, non-code
// token (e.g. "18p") alone. The discard's answer is replaced with the
// engine's actual error shape (400, {"error": "..."}) instead of provoking a
// real one, since a real rejection (an out-of-hand tile) never reaches the
// engine - only hand tiles are clickable.
test('an engine error with a tile code shows the tile name, not the code', async ({ page }) => {
  await page.goto('./?seed=1&turns=18');
  const handPanel = page.getByRole('region', { name: '手牌' });
  const drawn = handPanel.locator('.hand-drawn button');
  await expect(drawn).toBeVisible();

  onEngineReply(page, (call, reply) => {
    if (!isRequest(call, 'POST', /^\/api\/sessions\/[^/]+\/discard$/)) return;
    reply.status = 400;
    reply.data = { error: 'tile "5p" is not in hand or drawn (also 5p, seat 2, 18p)' };
  });

  await drawn.click();
  const banner = page.getByRole('alert');
  await expect(banner).toHaveText('tile 5筒 is not in hand or drawn (also 5筒, seat 2, 18p)');
});

// While the advice panel is minimized the page asks for no advice
// (?advice=0), so neither the advice nor the review of a discard is computed;
// opening the panel asks for the state again with them, and they are the
// same as if they had been there all along.
test('advice: left out while minimized, filled in (the review too) when the panel opens', async ({ page }) => {
  await page.goto('./?seed=3&turns=18');
  // The session is created after the page loads: count only what follows it.
  await expect(page).toHaveURL(/[?&]session=/);
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeEnabled();
  const sent: string[] = [];
  onEngineReply(page, (call) => {
    sent.push(call.fn === 'request' ? `${call.method} ${call.path}` : call.fn);
  });
  await discardDrawn(page);
  await discardDrawn(page);
  expect(sent.length).toBe(2);
  for (const s of sent) expect(s).toMatch(/^POST \/api\/sessions\/[^/]+\/discard\?advice=0&tree_from=\d+$/);

  const panel = page.getByRole('region', { name: 'アドバイス' });
  const dockTab = page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' });
  const get = nextEngineReply(page, (call) => isRequest(call, 'GET', /^\/api\/sessions\/[^/]+$/));
  sent.length = 0;
  await dockTab.click();
  await get;
  expect(sent).toHaveLength(1);
  expect(new URL(sent[0].split(' ')[1], 'http://x').searchParams.get('advice')).toBeNull();
  const want = await engineSession<Session>(page);
  expect(want.advice!.candidates).toHaveLength(3);
  await expect(panel.locator('.advice-candidate')).toHaveCount(3);
  await expect(panel.locator('.advice-review')).toHaveText(want.discard_review!.text);

  // With the panel open, the next discard brings its advice and review along.
  sent.length = 0;
  await discardDrawn(page);
  expect(sent).toEqual([expect.stringMatching(/\/discard\?tree_from=3$/)]);
  await expect(panel.locator('.advice-review')).toHaveText((await engineSession<Session>(page)).discard_review!.text);
});

// The page asks only for the tree nodes it lacks (?tree_from=) and appends
// them: the tree stays whole across moves, branches, gotos and a reload.
// (e2e/site/practice.spec.ts checks the save keeps up with them.)
test('history tree: only new nodes are sent, the tree stays whole across goto, branches and reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-minimized')) return;
    localStorage.setItem('mhj-dojo.minimized.v2', JSON.stringify(['chart', 'advice', 'gloss']));
    sessionStorage.setItem('e2e-minimized', '1');
  });
  await page.goto('./?seed=5&turns=18');
  const tree = page.getByRole('region', { name: '履歴ツリー' });
  const nodes = tree.locator('.tree-node-btn');
  const hand = page.getByRole('region', { name: '手牌' });
  const shown = () => nodes.evaluateAll((els) => els.map((e) => e.textContent));
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  const trees: number[] = [];
  onEngineReply(page, (call, reply) => {
    if (call.fn === 'request' && reply.status === 200 && call.path!.startsWith('/api/sessions/')) trees.push((reply.data as { tree: unknown[] }).tree.length);
  });

  await discardDrawn(page);
  await discardDrawn(page);
  await discardDrawn(page);
  await expect(nodes).toHaveCount(4);
  await nodes.nth(1).click();
  await expect(nodes.nth(1)).toHaveAttribute('aria-current', 'true');
  // A branch: a tile other than the one discarded from here before.
  const at1 = await engineSession<Session>(page);
  const other = at1.hand.findIndex((t) => t !== at1.tree[2].discard);
  await hand.locator('.hand-tiles button').nth(other).click();
  await expect(nodes).toHaveCount(5);
  await nodes.nth(3).click();
  await expect(nodes.nth(3)).toHaveAttribute('aria-current', 'true');
  // Each discard sent back its one new node, each goto none.
  expect(trees).toEqual([1, 1, 1, 0, 1, 0]);

  const whole = await engineSession<Session>(page);
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
// table shows what the engine's preview says.
test('preview: the rows after a discard, with names, han and remaining counts', async ({ page }) => {
  await page.goto('./?seed=1&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yaku.locator('.yaku-table tbody tr')).not.toHaveCount(0);
  const st = await engineSession<Session>(page);
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
