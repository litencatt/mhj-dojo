import { expect, test, type Page } from '@playwright/test';

// The static site (issue #67): practice mode with the engine running as
// WebAssembly in a Web Worker, no mhj-dojo server behind it.

// The tiles' names in a hand or river, in order.
function labels(page: Page, selector: string) {
  return page
    .getByRole('region', { name: '手牌' })
    .locator(`${selector} .tile`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

/** Opens the 履歴ツリー panel, which starts in the dock, on every load of the page. */
async function openTree(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('mhj-dojo.minimized.v2', JSON.stringify(['chart', 'advice', 'gloss'])),
  );
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

test('practice runs in the browser: load, discard, no server requests', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/')) apiRequests.push(req.url());
  });
  const engineFile = (name: string) =>
    page.waitForResponse((res) => new URL(res.url()).pathname.endsWith(`/${name}`));
  const files = ['worker.js', 'wasm_exec.js', 'mhj-dojo.wasm'].map(engineFile);
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
  const init = await page.evaluate(() => performance.getEntriesByName('mhj-dojo:wasm-init')[0]?.duration ?? -1);
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
  await expect(page.getByRole('link', { name: 'CPU対戦へ' })).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test('a reload replays the saved moves, branches included', async ({ page }) => {
  await openTree(page);
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
  // Different sessions: neither tab stops the other.
  await discardDrawn(page);
  await discardDrawn(other);
  for (const p of [page, other]) await expect(stoppedDialog(p)).toHaveCount(0);
});

// One tab at a time plays a session (src/singleTab.ts): the newest tab to
// open it wins, and the one before stops until taken back.
function stoppedDialog(page: Page) {
  return page.getByRole('alertdialog', { name: 'このタブは別のタブで開かれたため停止しました' });
}

/** The dialog covers the page: shown modal, so everything else is inert. */
async function expectStopped(page: Page) {
  await expect(stoppedDialog(page)).toBeVisible();
  expect(await stoppedDialog(page).evaluate((d) => d.matches(':modal'))).toBe(true);
}

function savedMoves(page: Page) {
  return page.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.practice') ?? 'null') as {
      sessions: Record<string, { moves: unknown[] }>;
    } | null;
    return s?.sessions[id!]?.moves.length;
  }, new URL(page.url()).searchParams.get('session'));
}

test('a second tab on the same session stops the first, until taken back', async ({ page, context }) => {
  await page.goto('./?seed=21&turns=18');
  await discardDrawn(page);
  await expect(page).toHaveURL(/[?&]session=/);
  const other = await context.newPage();
  await other.goto(page.url());
  const handA = page.getByRole('region', { name: '手牌' });
  const handB = other.getByRole('region', { name: '手牌' });
  await expect(handB.locator('.discard-river .tile')).toHaveCount(1);

  // A stops: the dialog covers it.
  await expectStopped(page);
  await expect(stoppedDialog(other)).toHaveCount(0);

  // B plays on and saves.
  await discardDrawn(other);
  await discardDrawn(other);
  expect(await savedMoves(other)).toBe(3);

  // A takes it back, from where B left it; now B stops.
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(stoppedDialog(page)).toHaveCount(0);
  await expect(handA.locator('.discard-river .tile')).toHaveCount(3);
  expect(await labels(page, '.discard-river')).toEqual(await labels(other, '.discard-river'));
  expect(await labels(page, '.hand-tiles')).toEqual(await labels(other, '.hand-tiles'));
  await expectStopped(other);
  await discardDrawn(page);
  expect(await savedMoves(page)).toBe(4);
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // 閉じる: a tab the page did not open stays open, with a hint.
  await stoppedDialog(other).getByRole('button', { name: '閉じる' }).click();
  await expect(stoppedDialog(other)).toContainText('このタブはそのまま閉じてかまいません');
  expect(other.isClosed()).toBe(false);
});

test('an answer that comes after the tab stopped is neither shown nor saved', async ({ page, context }) => {
  await page.goto('./?seed=24&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  const handA = page.getByRole('region', { name: '手牌' });
  await expect(handA.locator('.hand-drawn button')).toBeEnabled();
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
  await handA.locator('.hand-drawn button').click();

  // B opens the session meanwhile, from the save without A's move, and
  // plays two moves of its own.
  const other = await context.newPage();
  await other.goto(page.url());
  await expectStopped(page);
  await expect(stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' })).toBeDisabled();
  await discardDrawn(other);
  await discardDrawn(other);
  expect(await savedMoves(other)).toBe(2);

  // A's move is answered now: B's save stands, and A shows nothing new.
  await worker.evaluate(() => {
    (self as unknown as { held: boolean }).held = false;
  });
  const resume = stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' });
  await expect(resume).toBeEnabled();
  expect(await savedMoves(page)).toBe(2);
  await expect(handA.locator('.discard-river')).toHaveCount(0);

  await resume.click();
  await expect(handA.locator('.discard-river .tile')).toHaveCount(2);
  expect(await labels(page, '.discard-river')).toEqual(await labels(other, '.discard-river'));
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('a new session lets go of the one before', async ({ page, context }) => {
  await page.goto('./?seed=25&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  const first = page.url();
  await page.locator('.new-game-form input[type="number"]').first().fill('26');
  await page.getByRole('button', { name: '新規対局' }).click();
  await expect(page).not.toHaveURL(first);
  await expect(page).toHaveURL(/[?&]seed=26(&|$)/);

  const other = await context.newPage();
  await other.goto(first);
  await discardDrawn(other);
  await discardDrawn(page);
  for (const p of [page, other]) await expect(stoppedDialog(p)).toHaveCount(0);
});

// Makes page drop the singleTab messages that arrive while deaf (setDeaf),
// as a frozen tab, or one in the back/forward cache, would miss them.
async function deafen(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { deaf: boolean };
    w.deaf = false;
    const Channel = BroadcastChannel;
    window.BroadcastChannel = class extends Channel {
      set onmessage(fn: ((e: MessageEvent) => void) | null) {
        super.onmessage = fn && ((e: MessageEvent) => void (w.deaf || fn.call(this, e)));
      }
      get onmessage() {
        return super.onmessage;
      }
    };
  });
}

async function setDeaf(page: Page, deaf: boolean) {
  await page.evaluate((d) => ((window as unknown as { deaf: boolean }).deaf = d), deaf);
}

// A tab that missed the claim (frozen, say) checks again as it comes back
// into view, and stops then.
test('a tab that missed another tab opening its session stops when shown again', async ({ page, context }) => {
  await deafen(page);
  await page.goto('./?seed=27&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeEnabled();
  await setDeaf(page, true);

  const other = await context.newPage();
  await other.goto(page.url());
  await expect(other.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeEnabled();
  await page.waitForTimeout(300);
  await expect(stoppedDialog(page)).toHaveCount(0);

  await setDeaf(page, false);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expectStopped(page);
  await expect(stoppedDialog(other)).toHaveCount(0);
});

// Even with the newer tab gone, the tab that missed it must not play on its
// out-of-date copy: the claim recorded in localStorage stops it.
test('a tab back from the back/forward cache after the newer tab closed stops', async ({ page, context }) => {
  await deafen(page);
  await page.goto('./?seed=28&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeEnabled();
  await setDeaf(page, true);
  const other = await context.newPage();
  await other.goto(page.url());
  await discardDrawn(other);
  await discardDrawn(other);
  await other.close();
  await setDeaf(page, false);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expectStopped(page);
  expect(await savedMoves(page)).toBe(2);
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(page.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(2);
  await discardDrawn(page);
  expect(await savedMoves(page)).toBe(3);
});

test('a move on a tab that missed being stopped is not made', async ({ page, context }) => {
  await deafen(page);
  await page.goto('./?seed=29&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  const handA = page.getByRole('region', { name: '手牌' });
  await expect(handA.locator('.hand-drawn button')).toBeEnabled();
  await setDeaf(page, true);
  const other = await context.newPage();
  await other.goto(page.url());
  await discardDrawn(other);
  await discardDrawn(other);
  await other.close();

  await handA.locator('.hand-drawn button').click();
  await expectStopped(page);
  await expect(handA.locator('.discard-river')).toHaveCount(0);
  expect(await savedMoves(page)).toBe(2);
});

test('a tab stopped while it loads shows the dialog, and can take the session back', async ({ page, context }) => {
  await page.goto('./?seed=30&turns=18');
  await discardDrawn(page);
  const url = page.url();
  // B's engine is slow to load.
  const other = await context.newPage();
  let release = () => {};
  const loaded = new Promise<void>((r) => (release = r));
  await other.route('**/mhj-dojo.wasm*', async (route) => {
    await loaded;
    await route.continue();
  });
  await other.goto(url);
  await expectStopped(page);

  // A takes it back before B has shown anything: B stops, with no state.
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(page.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(1);
  await expectStopped(other);
  release();
  await expect(stoppedDialog(other).getByRole('button', { name: 'このタブで続ける' })).toBeEnabled();
  await expect(other.getByRole('region', { name: '手牌' })).toHaveCount(0);
  await discardDrawn(page);

  await stoppedDialog(other).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(other.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(2);
  await expectStopped(page);
  expect(await savedMoves(other)).toBe(2);
});

// The claims themselves, sent from another page of the site: of two claims
// with the same time the tab id decides, and a tab holding the newer claim
// answers an older one with its own.
test('crossing claims: the newer wins, the tab id breaking a tie', async ({ page, context }) => {
  await page.goto('./?seed=31&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeEnabled();
  const key = `/api/sessions/${encodeURIComponent(new URL(page.url()).searchParams.get('session')!)}`;
  type Claim = { key: string; tab: string; at: number; stopped?: true };
  const mine = await page.evaluate((k) => (JSON.parse(localStorage.getItem('mhj-dojo.tabs')!) as Record<string, Claim>)[k], key);
  expect(mine.tab).toBeTruthy();

  const helper = await context.newPage();
  await helper.goto('./icon.svg');
  const post = (m: Claim) =>
    helper.evaluate(
      (m) =>
        new Promise<Claim[]>((resolve) => {
          const ch = new BroadcastChannel('mhj-dojo.tabs');
          const got: Claim[] = [];
          ch.onmessage = (e) => got.push(e.data as Claim);
          ch.postMessage(m);
          setTimeout(() => {
            ch.close();
            resolve(got);
          }, 300);
        }),
      m,
    );

  // Older (the same time, a lower tab id): A answers with its own claim.
  expect(await post({ key, tab: '', at: mine.at })).toEqual([mine]);
  await expect(stoppedDialog(page)).toHaveCount(0);
  // Newer (the same time, a higher tab id): A stops, and says so.
  expect(await post({ key, tab: '~', at: mine.at })).toEqual([{ ...mine, stopped: true }]);
  await expectStopped(page);
});

// Seed 2's best-advice line: eleven discards, then tsumo on the twelfth draw.
const TSUMO_LINE = ['6z', '7z', '1m', '2s', '9p', '2z', '9m', '2z', '7z', '8s', '5s'];
const tsumoMoves = [...TSUMO_LINE.map((tile, i) => ({ parent: i, tile })), { parent: TSUMO_LINE.length }];

type SavedMove = { parent: number; tile?: string };

async function seedStorage(page: Page, id: string, current: number, moves: SavedMove[] = tsumoMoves) {
  const saved = { v: 2, sessions: { [id]: { seed: 2, max_turns: 18, moves, current, used: 1 } } };
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('mhj-dojo.site.practice', s);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(saved));
}

test('a saved tsumo node is rebuilt with its win', async ({ page }) => {
  await openTree(page);
  await seedStorage(page, 'e2etsumo', tsumoMoves.length);
  await page.goto('./?session=e2etsumo&seed=2&turns=18');
  await expect(page.getByRole('region', { name: '和了' })).toBeVisible();
  const nodes = page.getByRole('region', { name: '履歴ツリー' }).locator('.tree-node-btn');
  await expect(nodes).toHaveCount(tsumoMoves.length + 1);
  await expect(nodes.last()).toHaveAttribute('aria-current', 'true');
  await expect(page).toHaveURL(/[?&]session=e2etsumo(&|$)/);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// Rows at 聴牌 (or 和了) are light red, taking over from the yellow of the
// closest rows; the rest stay plain. Seed 2 reaches 聴牌 after 8 discards
// (一般形, 断么九, 平和 and the 断么九＋平和 combo).
test('yaku rows at tenpai are marked', async ({ page }) => {
  await seedStorage(page, 'e2etenpai', 8);
  await page.goto('./?session=e2etenpai&seed=2&turns=18');
  const table = page.locator('.yaku-table');
  await expect(table.locator('tbody tr').first()).toBeVisible();
  const tenpai = table.locator('tr.row-tenpai');
  await expect(tenpai).toHaveCount(3);
  for (const row of await tenpai.all()) await expect(row.locator('.shanten-cell')).toContainText('聴牌');
  await expect(table.locator('tr.row-best')).toHaveCount(0);
  await expect(page.locator('.combo-table tr.row-tenpai')).toHaveCount(1);
  const bg = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(await bg('.yaku-table tr.row-tenpai')).not.toBe(await bg('.yaku-table tbody tr:not(.row-tenpai)'));
});

test('a saved session resumes at an inner node', async ({ page }) => {
  await openTree(page);
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

test('after the engine exits, the next move restarts it and rebuilds the session', async ({ page }) => {
  await openTree(page);
  await page.goto('./?seed=4&turns=18');
  await discardDrawn(page);
  await page.reload(); // the session now lives under a new engine id
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  const url = page.url();

  // What worker.js reports when the Go program exits.
  expect(page.workers()).toHaveLength(1);
  await page.workers()[0].evaluate(() => self.postMessage({ type: 'failed', error: 'test exit' }));
  await discardDrawn(page);
  await expect(page.getByRole('region', { name: '履歴ツリー' }).locator('.tree-node-btn')).toHaveCount(3);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(page.url()).toBe(url);
});

test('an engine failure while rebuilding keeps the save for the next reload', async ({ page }) => {
  await page.goto('./?seed=6&turns=18');
  await discardDrawn(page);
  const url = page.url();

  // The next worker answers the rebuild with a 500, as a broken engine would.
  // Its wasm is held back so the override is in place before any request.
  await page.route('**/mhj-dojo.wasm*', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.continue();
  });
  page.once('worker', (w) =>
    w.evaluate(async () => {
      while (!self.onmessage) await new Promise((r) => setTimeout(r, 5));
      const orig = self.onmessage;
      self.onmessage = (e: MessageEvent) =>
        e.data.fn === 'restore'
          ? self.postMessage({ id: e.data.id, status: 500, body: '{"error":"boom"}' })
          : orig.call(self, e);
    }),
  );
  await page.reload();
  await expect(page.locator('.error-banner')).toContainText('boom');
  const id = new URL(url).searchParams.get('session')!;
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mhj-dojo.site.practice')!));
  expect(saved.sessions[id].moves).toHaveLength(1);

  await page.unroute('**/mhj-dojo.wasm*');
  await page.reload();
  await expect(page.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(1);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  expect(page.url()).toBe(url);
});

test('an engine that fails to load shows an error, and a new game retries', async ({ page }) => {
  await page.route('**/mhj-dojo.wasm*', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await page.goto('./?seed=1&turns=18');
  await expect(page.locator('.error-banner')).toContainText('計算エンジン');
  await page.unroute('**/mhj-dojo.wasm*');
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
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.practice')!);
    const id = new URL(location.href).searchParams.get('session')!;
    s.sessions[id].moves[0].tile = '9z'; // not a tile that can be discarded
    localStorage.setItem('mhj-dojo.site.practice', JSON.stringify(s));
  });
  await page.reload();
  await expect(hand.locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(hand.locator('.discard-river .tile')).toHaveCount(0);
  expect(await labels(page, '.hand-tiles')).toEqual(start);
  // The unusable save is dropped; the fresh session is saved instead.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mhj-dojo.site.practice')!));
  const id = new URL(page.url()).searchParams.get('session')!;
  expect(saved.sessions[id].moves).toEqual([]);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// The engine (cmd/mhj-dojo-wasm) keeps only a handful of sessions in memory
// (maxSessions there) to bound the wasm heap in a browser tab; anything
// beyond that is evicted and rebuilt from localStorage on its next request
// (web/src/wasm.ts's "not found: session" path), same as after a reload.
// Talking to the worker's own mhjDojoRequest directly (like worker.js does)
// creates sessions the page's wasm.ts never learns about, so it still
// treats session A as live and sends its next move straight to the engine
// -- which is exactly what exercises the eviction, without reloading the
// tab (a reload would start a fresh, empty engine and always rebuild,
// masking whether the cap itself did anything).
const ENGINE_CAP = 4; // cmd/mhj-dojo-wasm/main.go's maxSessions; keep in sync

/** Fills the live engine past its cap, evicting every session it already knows. */
async function evictEverything(page: Page, seedFrom: number) {
  const worker = page.workers()[0];
  for (let i = 0; i <= ENGINE_CAP; i++) {
    const res = (await worker.evaluate(
      (seed) => mhjDojoRequest('POST', '/api/sessions', JSON.stringify({ seed })),
      seedFrom + i,
    )) as { status: number };
    expect(res.status).toBe(200);
  }
}

test('a session evicted by the engine cap is rebuilt from its save, no reload', async ({ page }) => {
  await openTree(page);
  await page.goto('./?seed=50&turns=18');
  await discardDrawn(page);
  await discardDrawn(page);
  const url = page.url();
  const tree = page.getByRole('region', { name: '履歴ツリー' });
  const nodes = tree.locator('.tree-node-btn');
  await expect(nodes).toHaveCount(3);

  await evictEverything(page, 1000);

  // A goto on the evicted session (not a new move) rebuilds it too, landing
  // exactly on the requested node rather than wherever the save left it.
  await nodes.nth(1).click();
  expect(page.url()).toBe(url);
  await expect(nodes.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: '手牌' }).locator('.discard-river .tile')).toHaveCount(1);
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // Branching from the rebuilt node still works.
  await page.getByRole('region', { name: '手牌' }).locator('.hand-tiles button').first().click();
  await expect(nodes).toHaveCount(4);
  expect(page.url()).toBe(url);
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // Evict again, then a plain move (not a goto) rebuilds it the same way.
  await evictEverything(page, 2000);
  await discardDrawn(page);
  expect(page.url()).toBe(url);
  await expect(nodes).toHaveCount(5);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// Seed 2's TSUMO_LINE (below) reaches tsumo on the 12th draw. Rather than
// clicking through 11 real discards, the session is seeded with just those
// 11 moves (a real Restore replay on load, exactly like "a saved session
// resumes at an inner node") so it starts already positioned at the winning
// draw, still playing -- then the test evicts it and declares tsumo for
// real, exercising the engine's own win-detection on a session that only
// exists because wasm.ts rebuilt it.
test('an evicted session declares tsumo after rebuilding, no reload', async ({ page }) => {
  await openTree(page);
  const discardsOnly = TSUMO_LINE.map((tile, i) => ({ parent: i, tile }));
  await seedStorage(page, 'e2etsumolive', TSUMO_LINE.length, discardsOnly);
  await page.goto('./?session=e2etsumolive&seed=2&turns=18');
  const url = page.url();
  const tree = page.getByRole('region', { name: '履歴ツリー' });
  await expect(tree.locator('.tree-node-btn')).toHaveCount(TSUMO_LINE.length + 1);
  await expect(page.getByRole('region', { name: '和了' })).toHaveCount(0);

  await evictEverything(page, 3000);

  await page.getByRole('button', { name: 'ツモ' }).click();
  await expect(page.getByRole('region', { name: '和了' })).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(tree.locator('.tree-node-btn')).toHaveCount(TSUMO_LINE.length + 2);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// On a phone (390px wide): no sideways page scroll, the hand on one row, the
// minimized panels in a bar along the bottom, and the yaku table in the width.
test('a 390px-wide phone: one-row hand, bottom dock, nothing wider than the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?seed=1&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand.locator('.hand-drawn button')).toBeVisible();
  const tops = await hand
    .locator('.hand-row button.tile')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(tops).toHaveLength(14);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // The advice starts minimized: its tab is in the bottom bar.
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  const bar = await dock.boundingBox();
  expect(bar!.y + bar!.height).toBeCloseTo(844, 0);
  expect(bar!.width).toBeCloseTo(390, 0);
  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yaku).toBeVisible();
  const panel = await yaku.boundingBox();
  const table = await yaku.locator('.yaku-table').boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(panel!.x + panel!.width);
});

/** The page's saved moves (localStorage), for the session in its URL. */
function savedMoveList(page: Page) {
  return page.evaluate(() => {
    const id = new URL(location.href).searchParams.get('session')!;
    const all = JSON.parse(localStorage.getItem('mhj-dojo.site.practice') ?? '{}') as {
      sessions?: Record<string, { moves: { parent: number; tile?: string }[] }>;
    };
    return all.sessions?.[id]?.moves ?? null;
  });
}

// Responses carry only the tree nodes the page lacks (?tree_from=), so the
// save adds each new move to the ones it already holds: it stays whole
// across moves, gotos, a branch, an eviction rebuild and a reload.
test('the save keeps every move while responses carry only the new nodes', async ({ page }) => {
  await openTree(page);
  await page.goto('./?seed=8&turns=18');
  const nodes = page.getByRole('region', { name: '履歴ツリー' }).locator('.tree-node-btn');
  const hand = page.getByRole('region', { name: '手牌' });
  await discardDrawn(page);
  const second = await discardDrawn(page);
  await expect(nodes).toHaveCount(3);
  await nodes.nth(1).click();
  await expect(nodes.nth(1)).toHaveAttribute('aria-current', 'true');
  const labelsAt1 = await labels(page, '.hand-tiles');
  const other = labelsAt1.findIndex((l) => l !== second);
  await hand.locator('.hand-tiles button').nth(other).click();
  await expect(nodes).toHaveCount(4);
  let moves = await savedMoveList(page);
  expect(moves).toHaveLength(3);
  expect(moves!.map((m) => m.parent)).toEqual([0, 1, 1]);

  await evictEverything(page, 4000);
  await discardDrawn(page); // rebuilt from the save, then one more node
  await expect(nodes).toHaveCount(5);
  moves = await savedMoveList(page);
  expect(moves!.map((m) => m.parent)).toEqual([0, 1, 1, 3]);

  const before = await nodes.evaluateAll((els) => els.map((e) => e.textContent));
  await page.reload();
  await expect(nodes).toHaveCount(5);
  expect(await nodes.evaluateAll((els) => els.map((e) => e.textContent))).toEqual(before);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

// The advice panel starts minimized, so the discards leave their reviews
// pending; after a reload (a rebuild from the moves) opening the panel fills
// in the advice and the review, the same as a session that had them all along.
test('advice opened after discards and a reload: the review is the one computed all along', async ({ page }) => {
  await page.goto('./?seed=9&turns=18');
  const hand = page.getByRole('region', { name: '手牌' });
  await discardDrawn(page);
  await discardDrawn(page);
  await page.reload();
  await expect(hand.locator('.discard-river .tile')).toHaveCount(2);

  // The same moves on a session with the advice all along, in the engine.
  const river = await page.evaluate(() => {
    const id = new URL(location.href).searchParams.get('session')!;
    const all = JSON.parse(localStorage.getItem('mhj-dojo.site.practice')!) as {
      sessions: Record<string, { moves: { tile?: string }[] }>;
    };
    return all.sessions[id].moves.map((m) => m.tile!);
  });
  const want = (await page.workers()[0].evaluate((tiles) => {
    const call = (method: string, path: string, body: unknown) =>
      JSON.parse(mhjDojoRequest(method, path, JSON.stringify(body)).body) as { session_id: string; discard_review: { text: string } };
    let st = call('POST', '/api/sessions', { seed: 9, max_turns: 18 });
    for (const tile of tiles) st = call('POST', `/api/sessions/${st.session_id}/discard`, { tile });
    return st.discard_review.text;
  }, river)) as string;

  const panel = page.getByRole('region', { name: 'アドバイス' });
  await page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' }).click();
  await expect(panel.locator('.advice-candidate')).toHaveCount(3);
  await expect(panel.locator('.advice-review')).toHaveText(want);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
