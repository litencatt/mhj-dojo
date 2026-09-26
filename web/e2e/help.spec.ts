import { expect, test, type Page } from '@playwright/test';

// The header's version and the help dialog, in both modes.

const VERSION = /^(dev|[0-9a-f]{7})( · \d{4}-\d{2}-\d{2})?$/;

async function openHelp(page: Page) {
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('practice: the header shows the version and the help opens, closes and links to the glossary', async ({ page }) => {
  const version = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/version');
  await page.goto('/?seed=1&turns=18');
  const res = await version;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { version: string };
  // The E2E server runs under `go run`, which stamps no commit.
  expect(body.version).toBe('dev');
  await expect(page.locator('.app-header .version-tag')).toHaveText(VERSION);
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();

  const helpButton = page.getByRole('button', { name: 'ヘルプ', exact: true });
  let dialog = await openHelp(page);
  for (const h of [
    'このアプリについて',
    '練習モード',
    '役別向聴の表の見方',
    '複合役',
    '面子表示',
    'アドバイス',
    'CPU対戦',
    '牌の表記',
    '公開版の保存',
    'バージョン表示',
  ]) {
    await expect(dialog.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
  await expect(dialog.getByRole('row', { name: /1筒〜9筒/ })).toContainText('筒子（ピンズ）');
  await expect(dialog.getByRole('row', { name: /東・南・西・北・白・發・中/ })).toContainText('字牌');

  // Esc closes it and focus goes back to the button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(helpButton).toBeFocused();

  // So does the close button.
  dialog = await openHelp(page);
  await dialog.getByRole('button', { name: 'ヘルプを閉じる' }).click();
  await expect(dialog).toBeHidden();

  // The 用語表 link brings the glossary back from the dock (where it starts).
  const glossary = page.getByRole('region', { name: '用語表' });
  await expect(glossary).toBeHidden();
  dialog = await openHelp(page);
  await dialog.getByRole('button', { name: '用語表', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(glossary).toBeVisible();
  await expect(glossary.getByRole('searchbox', { name: '用語を検索' })).toBeFocused();
});

test('a click on the backdrop closes the help, a drag that ends there does not', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();

  // Selecting text inside and letting go over the backdrop.
  const dialog = await openHelp(page);
  const text = await dialog.getByText('日本式リーチ麻雀の練習アプリです', { exact: false }).boundingBox();
  expect(text).not.toBeNull();
  await page.mouse.move(text!.x + 5, text!.y + text!.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, 10, { steps: 5 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  // A plain click outside it.
  await page.mouse.click(10, 10);
  await expect(dialog).toBeHidden();
});

test('game mode: the header shows the version, and the help links to the glossary', async ({ page }) => {
  await page.goto('/?mode=game&seed=1');
  await expect(page.locator('.app-header .version-tag')).toHaveText(VERSION);
  // The glossary starts in the dock.
  const glossary = page.getByRole('region', { name: '用語表' });
  await expect(glossary).toBeHidden();

  const dialog = await openHelp(page);
  await expect(dialog.getByRole('heading', { name: 'CPU対戦', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '用語表', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(glossary).toBeVisible();
  await expect(glossary.getByRole('searchbox', { name: '用語を検索' })).toBeFocused();
});

test('the help fits a phone screen and scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=1&turns=18');
  const dialog = await openHelp(page);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // Its bottom edge is on screen, and the content scrolls inside it.
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(await dialog.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true);
  const last = dialog.getByRole('heading', { name: 'バージョン表示', exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  // The close button stays reachable at the top.
  await expect(dialog.getByRole('button', { name: 'ヘルプを閉じる' })).toBeInViewport();
  // The page behind scrolls no wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// The commit time is UTC (Go's build info); the header shows the viewer's
// local date, so a commit at 07:57 JST reads as that day, not the UTC one.
test.describe('in Tokyo', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  test('the version date is the local one', async ({ page }) => {
    await page.route('**/api/version', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: 'c0123d1', revision: 'c0123d1', time: '2026-09-26T22:57:20Z', modified: false }),
      }),
    );
    await page.goto('/?seed=1&turns=18');
    const tag = page.locator('.app-header .version-tag');
    await expect(tag).toHaveText('c0123d1 · 2026-09-27');
    await expect(tag).toHaveAttribute('title', /エンジン: c0123d1（2026-09-27 07:57）/);
  });
});
