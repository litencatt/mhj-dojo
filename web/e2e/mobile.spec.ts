import { expect, test, type Locator, type Page } from '@playwright/test';

// Practice mode on phone-sized screens (320 to 390px wide): no sideways page
// scroll, the 14 hand tiles on one row, the minimized panels as a tab bar
// along the bottom that never covers the page, the yaku tables fitting the
// width, and a tap selecting a tile before a second tap discards it.

const MINIMIZED_KEY = 'mhj-dojo.minimized.v2';
const ALL_PANELS = ['chart', 'tree', 'yaku', 'advice', 'gloss'];

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, 'element should be rendered').not.toBeNull();
  return b!;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function pageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** How many rows the hand's tiles (hand tiles and the drawn tile) take: a
 * tile starting below the previous row's middle starts a new row. */
async function handRows(page: Page) {
  const rects = await page
    .getByRole('region', { name: '手牌' })
    .locator('.hand-row button.tile')
    .evaluateAll((els) => els.map((e) => ({ top: e.getBoundingClientRect().top, height: e.getBoundingClientRect().height })));
  expect(rects.length).toBe(14);
  let rows = 0;
  let rowMid = -Infinity;
  for (const r of rects.sort((a, b) => a.top - b.top)) {
    if (r.top > rowMid) {
      rows++;
      rowMid = r.top + r.height / 2;
    }
  }
  return rows;
}

/** Starts with the given panels minimized (the setting is kept in localStorage). */
async function openPractice(page: Page, minimized: string[]) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('e2e-minimized')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('e2e-minimized', '1');
      }
    },
    [MINIMIZED_KEY, JSON.stringify(minimized)],
  );
  await page.goto('/?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' }).locator('.hand-drawn button')).toBeVisible();
}

for (const width of [320, 360, 390]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('the hand fits one row and the dock is a bottom bar clear of the page', async ({ page }) => {
      await openPractice(page, ALL_PANELS);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      expect(await handRows(page)).toBe(1);
      // Tiles stay big enough to see and tap.
      const tile = await box(page.locator('.hand-tiles button.tile').first());
      expect(tile.width).toBeGreaterThanOrEqual(16);
      // (The tap area reaches 8px above and below the tile.)
      expect(tile.height).toBeGreaterThanOrEqual(21);

      // Five tabs in one compact row along the bottom edge, still easy to tap
      // (34px tall, and wide), their short names unclipped.
      const dock = page.getByRole('navigation', { name: '最小化したパネル' });
      const dockBox = await box(dock);
      expect(dockBox.y + dockBox.height).toBeCloseTo(800, 0);
      expect(dockBox.height).toBeLessThanOrEqual(44);
      expect(dockBox.width).toBeCloseTo(width, 0);
      const tabs = dock.getByRole('button');
      await expect(tabs).toHaveCount(5);
      for (const t of await tabs.all()) {
        const b = await box(t);
        expect(b.height).toBeGreaterThanOrEqual(34);
        expect(b.width).toBeGreaterThanOrEqual(48);
        expect(b.y).toBeGreaterThanOrEqual(dockBox.y);
        const short = t.locator('.dock-tab-short');
        expect(await short.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      }
      // Nothing on the page sits under it, even scrolled to the very end.
      for (const section of await page.locator('.app-header, section').filter({ visible: true }).all()) {
        expect(overlaps(await box(section), dockBox)).toBe(false);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = await box(page.locator('.app section').filter({ visible: true }).last());
      expect(last.y + last.height).toBeLessThanOrEqual((await box(dock)).y);

      // A tab brings its panel back, full width and scrolled into view.
      await dock.getByRole('button', { name: '役別向聴' }).click();
      const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
      await expect(yaku).toBeInViewport();
      await expect(tabs).toHaveCount(4);
    });

    test('with every panel open, the page and the yaku tables fit the width', async ({ page }) => {
      await openPractice(page, []);
      await expect(page.getByRole('navigation', { name: '最小化したパネル' })).toHaveCount(0);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      expect(await handRows(page)).toBe(1);

      const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
      const panel = await box(yaku);
      // A phone has no 複合役 and no name search, but keeps the rest of the filter bar.
      await expect(yaku.locator('.combo-table')).toHaveCount(0);
      await expect(yaku.locator('.yaku-filter')).toBeVisible();
      await expect(yaku.locator('.yaku-filter-search')).toHaveCount(0);
      const t = yaku.locator('.yaku-table');
      await expect(t.locator('tbody tr').first()).toBeVisible();
      // No cell is cut off: every cell of the first rows, including the
      // effective tiles and the 合計枚数, lies inside the panel.
      for (const cell of await t.locator('tbody tr').first().locator('th, td').all()) {
        const b = await box(cell);
        expect(b.x).toBeGreaterThanOrEqual(panel.x);
        expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
      }
      const scroll = yaku.locator('.yaku-table-scroll');
      expect(await scroll.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
      // The chart is drawn at the panel's width, not scaled down from 720px.
      const chart = page.locator('.shanten-chart');
      const viewBoxWidth = Number((await chart.getAttribute('viewBox'))!.split(' ')[2]);
      expect(viewBoxWidth).toBeLessThan(width);
    });
  });
}

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a tap selects and previews a tile, a second tap discards it', async ({ page }) => {
    await openPractice(page, ['chart', 'tree', 'advice', 'gloss']);
    const hand = page.getByRole('region', { name: '手牌' });
    const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
    let discards = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/discard')) discards++;
    });

    const tile = hand.locator('.hand-tiles button.tile').first();
    const name = await tile.getAttribute('aria-label');
    await tile.tap();
    await expect(tile).toHaveClass(/tile-picked/);
    await expect(yaku.locator('.preview-note')).toContainText(`${name} を打牌した場合のプレビュー`);
    expect(discards).toBe(0);

    // Another tile moves the selection; the first stays in the hand.
    const other = hand.locator('.hand-drawn button');
    const otherName = await other.getAttribute('aria-label');
    await other.tap();
    await expect(other).toHaveClass(/tile-picked/);
    await expect(tile).not.toHaveClass(/tile-picked/);
    await expect(yaku.locator('.preview-note')).toContainText(`${otherName} を打牌した場合のプレビュー`);
    expect(discards).toBe(0);

    // The second tap on it discards it.
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
      other.tap(),
    ]);
    await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
    await expect(hand.locator(`.discard-river [aria-label="${otherName}"]`)).toBeVisible();
    await expect(hand.locator('.tile-picked')).toHaveCount(0);
  });

  test('the selection is announced, and a tap outside the hand drops it', async ({ page }) => {
    await openPractice(page, ['chart', 'tree', 'advice', 'gloss']);
    const hand = page.getByRole('region', { name: '手牌' });
    const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
    const tile = hand.locator('.hand-tiles button.tile').first();
    const name = await tile.getAttribute('aria-label');
    await tile.tap();
    await expect(hand.getByRole('status')).toHaveText(`選択中：${name}（もう一度タップで打牌）`);
    await page.locator('.app-header h1').tap();
    await expect(hand.locator('.tile-picked')).toHaveCount(0);
    await expect(hand.getByRole('status')).toHaveText('');
    await expect(yaku.locator('.preview-note')).toHaveCount(0);
  });

  test('after a tap selected a tile, the keyboard still discards on the first Enter', async ({ page }) => {
    await openPractice(page, ['chart', 'tree', 'advice', 'gloss']);
    const hand = page.getByRole('region', { name: '手牌' });
    const drawn = hand.locator('.hand-drawn button');
    const name = await drawn.getAttribute('aria-label');
    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    const tile = hand.locator('.hand-tiles button.tile').first();
    const tileName = await tile.getAttribute('aria-label');
    await tile.focus();
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
      page.keyboard.press('Enter'),
    ]);
    await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
    await expect(hand.locator(`.discard-river [aria-label="${tileName}"]`)).toBeVisible();
    expect(name).toBeTruthy();
  });

  // A pick made before リーチ is toggled must not declare riichi with one tap.
  // The server rarely offers riichi early, so its responses are patched to
  // offer it on the tile the test selects (no riichi is ever sent).
  test('toggling riichi drops a tap selection', async ({ page }) => {
    await page.route('**/api/games**', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body?.legal && body.phase === 'discard' && body.actor === body.you && body.legal.discards.length > 0) {
        const me = body.seats[body.you];
        body.legal.riichi = [me.drawn ?? body.legal.discards[0]];
      }
      await route.fulfill({ response: res, json: body });
    });
    await page.goto('/?mode=game&seed=12&first_dealer=you');
    await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
    const hand = page.getByRole('region', { name: '手牌' });
    const drawn = hand.locator('.hand-drawn button');
    await expect(drawn).toBeVisible();
    let actions = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/action')) actions++;
    });

    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    await page.locator('.action-bar').getByRole('button', { name: 'リーチ' }).tap();
    await expect(page.locator('.action-bar').getByRole('button', { name: 'リーチ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(hand.locator('.tile-picked')).toHaveCount(0);
    // One tap only selects the riichi tile again: nothing is sent.
    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    expect(actions).toBe(0);
  });
});

test('a phone hides the name search, and 条件をクリア keeps its saved text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // A search saved on a wide screen (it matches no yaku here, so it would empty the table).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-filter')) {
      localStorage.setItem('mhj-dojo.yakuFilter', JSON.stringify({ query: 'zzz', maxShanten: null, categories: ['1', '2', '3', 'yakuman'], sort: 'shanten' }));
      sessionStorage.setItem('e2e-filter', '1');
    }
  });
  await openPractice(page, []);
  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yaku.locator('.yaku-filter-search')).toHaveCount(0);
  // The hidden search is ignored on the phone: the yaku are listed.
  await expect(yaku.locator('.yaku-table tbody tr').nth(1)).toBeVisible();

  // The filter bar starts folded on a phone; 条件をクリア stays out.
  await yaku.getByRole('button', { name: '条件をクリア' }).click();
  await yaku.getByRole('button', { name: /絞り込み/ }).click();
  await expect(yaku.getByRole('combobox').nth(1)).toHaveValue('default');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mhj-dojo.yakuFilter') ?? '{}'));
  expect(saved.query).toBe('zzz');
  expect(saved.sort).toBe('default');
});

test('a mouse click at phone width discards at once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPractice(page, ALL_PANELS);
  const hand = page.getByRole('region', { name: '手牌' });
  const drawn = hand.locator('.hand-drawn button');
  const name = await drawn.getAttribute('aria-label');
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
    drawn.click(),
  ]);
  await expect(hand.locator(`.discard-river [aria-label="${name}"]`)).toBeVisible();
  await expect(hand.locator('.tile-picked')).toHaveCount(0);
});

// Without a saved layout only the header, the hand (and in the CPU game the
// table) and the 役別向聴 table are open; every other panel starts in the dock.
for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['390px', { width: 390, height: 844 }],
] as const) {
  test.describe(`default panels (${label})`, () => {
    test.use({ viewport });

    test('practice: only the header, the hand and 役別向聴 are open', async ({ page }) => {
      await page.goto('/?seed=1&turns=18');
      await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
      await expect(page.locator('.app-header')).toBeVisible();
      await expect(page.getByRole('region', { name: '役別向聴テーブル' })).toBeVisible();
      for (const name of ['時系列チャート', '履歴ツリー', 'アドバイス', '用語表']) {
        await expect(page.getByRole('region', { name })).toBeHidden();
      }
      const tabs = page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button');
      await expect(tabs).toHaveText([/時系列チャート|チャート/, /履歴ツリー|履歴/, /アドバイス/, /用語表/]);
      await expect(page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: '役別向聴' })).toHaveCount(0);
    });

    test('CPU game: only the header, the table, the hand and 役別向聴 are open', async ({ page }) => {
      await page.goto('/?mode=game&seed=12');
      await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
      await expect(page.getByRole('region', { name: '卓' })).toBeVisible();
      await expect(page.getByRole('region', { name: '役別向聴テーブル' })).toBeVisible();
      for (const name of ['時系列チャート', '用語表']) {
        await expect(page.getByRole('region', { name })).toBeHidden();
      }
      const dock = page.getByRole('navigation', { name: '最小化したパネル' });
      await expect(dock.getByRole('button')).toHaveCount(2);
      await expect(dock.getByRole('button', { name: '時系列チャート' })).toBeVisible();
      await expect(dock.getByRole('button', { name: '用語表' })).toBeVisible();
    });
  });
}

// A phone on its side is short: the dock stays on the right edge as on a
// desktop (not a bottom bar), with the short names so all tabs fit.
test('a phone on its side keeps the dock on the right edge, with short names', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await openPractice(page, ALL_PANELS);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  const tab = dock.getByRole('button', { name: 'アドバイス' });
  const b = await box(tab);
  expect(b.x + b.width).toBeCloseTo(667, 0);
  expect(b.height).toBeGreaterThan(b.width); // vertical text
  await expect(dock.getByRole('button', { name: '時系列チャート' }).locator('.dock-tab-short')).toBeVisible();
  const d = await box(dock);
  expect(d.y).toBeGreaterThanOrEqual(0);
  expect(d.y + d.height).toBeLessThanOrEqual(375);
});

test('the desktop layout keeps the dock on the right edge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPractice(page, ['advice']);
  const tab = page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' });
  const b = await box(tab);
  expect(b.x + b.width).toBeCloseTo(1280, 0);
  expect(b.height).toBeGreaterThan(b.width); // vertical text
  await expect(tab.locator('.dock-tab-short')).toBeHidden();
});

// With 面子表示 on, the brackets above the tiles must not lift the drawn tile:
// it lines up with the hand tiles (as it does with 面子表示 off).
for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['390px', { width: 390, height: 844 }],
] as const) {
  test(`the drawn tile lines up with the grouped hand (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?seed=1&turns=18');
    const hand = page.getByRole('region', { name: '手牌' });
    const drawn = hand.locator('.hand-drawn button.tile');
    await expect(drawn).toBeVisible();
    const lineUp = async () => {
      const d = await box(drawn);
      const t = await box(hand.locator('.hand-tiles button.tile').last());
      expect(Math.abs(d.y - t.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(d.y + d.height - (t.y + t.height))).toBeLessThanOrEqual(2);
    };
    await lineUp();
    await hand.getByRole('button', { name: '面子表示' }).click();
    await expect(hand.locator('.hand-group').first()).toBeVisible();
    await lineUp();
  });
}

// The filter bar folds away behind 絞り込み: folded on a phone, upright or on
// its side, open on a wider screen (practice.spec.ts), and the player's
// choice is kept. Folded, the count (and 条件をクリア) stays above the table.
test.describe('the yaku filter bar on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('starts folded, opens to filter, and keeps the choice over a reload', async ({ page }) => {
    await openPractice(page, ['chart', 'tree', 'advice', 'gloss']);
    const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
    const toggle = yaku.getByRole('button', { name: /絞り込み/ });
    const count = yaku.locator('.yaku-filter-count');
    const firstRow = yaku.locator('.yaku-table tbody tr').first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(yaku.getByRole('combobox')).toHaveCount(0);
    await expect(yaku.getByRole('button', { name: '役満' })).toHaveCount(0);
    await expect(count).toBeVisible();
    await expect(count).toHaveText(/^(\d+) \/ \1役を表示中$/);
    await expect(yaku.getByRole('button', { name: '条件をクリア' })).toHaveCount(0);
    const folded = (await box(firstRow)).y;

    // The table scrolls in its own panel; its header still sticks to the top.
    const panel = page.locator('.yaku-table-panel');
    await panel.evaluate((p) => (p.scrollTop = 400));
    expect(Math.abs((await box(yaku.locator('.yaku-table thead'))).y - (await box(panel)).y)).toBeLessThanOrEqual(1);
    await panel.evaluate((p) => (p.scrollTop = 0));

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(yaku.getByRole('combobox')).toHaveCount(2);
    // Opened, the table starts lower.
    expect((await box(firstRow)).y).toBeGreaterThan(folded + 20);
    const before = await count.innerText();
    await yaku.getByRole('button', { name: '1翻' }).click();
    await expect(yaku.getByRole('button', { name: '1翻' })).toHaveAttribute('aria-pressed', 'false');
    await expect(count).not.toHaveText(before);
    await expect(yaku.getByRole('button', { name: '条件をクリア' })).toBeVisible();

    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(yaku.getByRole('button', { name: '1翻' })).toHaveAttribute('aria-pressed', 'false');
    // Folding keeps the filter.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(count).not.toHaveText(before);
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(yaku.getByRole('combobox')).toHaveCount(0);
  });

  test('folded, 条件をクリア shows while a condition is set and clears it', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-filter')) {
        localStorage.setItem('mhj-dojo.yakuFilter', JSON.stringify({ query: '', maxShanten: null, categories: ['1'], sort: 'default' }));
        sessionStorage.setItem('e2e-filter', '1');
      }
    });
    await openPractice(page, ['chart', 'tree', 'advice', 'gloss']);
    const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
    await expect(yaku.getByRole('button', { name: /絞り込み/ })).toHaveAttribute('aria-expanded', 'false');
    const count = yaku.locator('.yaku-filter-count');
    await expect(count).not.toHaveText(/^(\d+) \/ \1役を表示中$/);
    const rows = await yaku.locator('.yaku-table tbody tr').count();

    await yaku.getByRole('button', { name: '条件をクリア' }).click();
    await expect(count).toHaveText(/^(\d+) \/ \1役を表示中$/);
    await expect(yaku.getByRole('button', { name: '条件をクリア' })).toHaveCount(0);
    expect(await yaku.locator('.yaku-table tbody tr').count()).toBeGreaterThan(rows);
    await expect(yaku.getByRole('button', { name: /絞り込み/ })).toHaveAttribute('aria-expanded', 'false');
  });

  for (const [mode, viewport] of [
    ['a CPU game', { width: 390, height: 844 }],
    ['a CPU game on its side', { width: 844, height: 390 }],
  ] as const) {
    test(`${mode} starts folded too`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/?mode=game&seed=1&length=tonpuu');
      const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
      await expect(yaku.locator('.yaku-table tbody tr').first()).toBeAttached();
      await expect(yaku.getByRole('button', { name: /絞り込み/ })).toHaveAttribute('aria-expanded', 'false');
      await expect(yaku.getByRole('combobox')).toHaveCount(0);
      await expect(yaku.locator('.yaku-filter-count')).toBeAttached();
    });
  }
});
