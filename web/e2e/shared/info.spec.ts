import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { forUsersOnly, parseChangelog } from '../../src/changelog';

// The 更新情報 page (info/): the ways there from the app and back. Its
// content, rendered in at build time, is tested in e2e/site/info.spec.ts.

const NEWEST = forUsersOnly(parseChangelog(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')))[0].version;

test('the help and the header version open info/', async ({ page }) => {
  // The help links to it about the app and about the version.
  for (const section of ['このアプリについて', 'バージョン表示']) {
    await page.goto('./?seed=1&turns=18');
    await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
    await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
    await dialog.getByRole('region', { name: section }).getByRole('link', { name: '更新情報' }).click();
    await expect(page).toHaveURL(/\/info\/$/);
    await expect(page.locator('.release').first().locator('.release-version')).toHaveText(NEWEST);
  }

  await page.goto('./?mode=game');
  await page.locator('.app-header .version-tag').click();
  await expect(page).toHaveURL(/\/info\/$/);
});

test('info/ links back to practice and the CPU game', async ({ page }) => {
  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: '練習' }).click();
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page.locator('.app-header h1')).toContainText('麻雀道場');

  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: 'CPU対戦' }).click();
  await expect(page).toHaveURL(/\/\?mode=game$/);
  await expect(page.locator('.app-header h1')).toContainText('CPU対戦');
});

test('練習 goes back to the practice session the page came from', async ({ page }) => {
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page).toHaveURL(/session=/);
  const practice = page.url();
  await page.locator('.app-header .version-tag').click();
  await expect(page).toHaveURL(/\/info\/$/);
  await expect(page.locator('.release').first()).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: '練習' }).click();
  await expect(page).toHaveURL(practice);
});

test('info/ fits a phone: no sideways scroll at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./info/');
  await expect(page.locator('.release').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
