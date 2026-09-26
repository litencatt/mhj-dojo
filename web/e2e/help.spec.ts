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
  await expect(dialog.getByRole('row', { name: /1z〜7z/ })).toContainText('東・南・西・北・白・發・中');

  // Esc closes it and focus goes back to the button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(helpButton).toBeFocused();

  // So does the close button.
  dialog = await openHelp(page);
  await dialog.getByRole('button', { name: 'ヘルプを閉じる' }).click();
  await expect(dialog).toBeHidden();

  // The 用語表 link brings the glossary back from the dock.
  const glossary = page.getByRole('region', { name: '用語表' });
  await glossary.getByRole('button', { name: '用語表を最小化' }).click();
  await expect(glossary).toBeHidden();
  dialog = await openHelp(page);
  await dialog.getByRole('button', { name: '用語表', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(glossary).toBeVisible();
  await expect(glossary.getByRole('searchbox', { name: '用語を検索' })).toBeFocused();
});

test('game mode: the header shows the version and the help', async ({ page }) => {
  await page.goto('/?mode=game&seed=1');
  await expect(page.locator('.app-header .version-tag')).toHaveText(VERSION);
  const dialog = await openHelp(page);
  await expect(dialog.getByRole('heading', { name: 'CPU対戦', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the help fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=1&turns=18');
  const dialog = await openHelp(page);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // The page behind scrolls no wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
