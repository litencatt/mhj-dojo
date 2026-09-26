import { expect, test, type Locator, type Page } from '@playwright/test';

// Practice mode on phone-sized screens (360 and 390px wide): no sideways page
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

for (const width of [360, 390]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('the hand fits one row and the dock is a bottom bar clear of the page', async ({ page }) => {
      await openPractice(page, ALL_PANELS);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      expect(await handRows(page)).toBe(1);
      // Tiles stay big enough to see and tap.
      const tile = await box(page.locator('.hand-tiles button.tile').first());
      expect(tile.width).toBeGreaterThanOrEqual(18);
      expect(tile.height).toBeGreaterThanOrEqual(24);

      // Five tabs in one row along the bottom edge, each easy to tap.
      const dock = page.getByRole('navigation', { name: '最小化したパネル' });
      const dockBox = await box(dock);
      expect(dockBox.y + dockBox.height).toBeCloseTo(800, 0);
      expect(dockBox.width).toBeCloseTo(width, 0);
      const tabs = dock.getByRole('button');
      await expect(tabs).toHaveCount(5);
      for (const t of await tabs.all()) {
        const b = await box(t);
        expect(b.height).toBeGreaterThanOrEqual(40);
        expect(b.y).toBeGreaterThanOrEqual(dockBox.y);
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
      for (const table of ['.yaku-table', '.combo-table']) {
        const t = yaku.locator(table);
        await expect(t.locator('tbody tr').first()).toBeVisible();
        // No cell is cut off: every cell of the first rows, including the
        // effective tiles and the 合計枚数, lies inside the panel.
        for (const cell of await t.locator('tbody tr').first().locator('th, td').all()) {
          const b = await box(cell);
          expect(b.x).toBeGreaterThanOrEqual(panel.x);
          expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5);
        }
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
