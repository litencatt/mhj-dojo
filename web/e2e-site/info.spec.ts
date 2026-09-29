import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The 更新情報 page (info/), which the site build renders from CHANGELOG.md:
// the releases newest first, without the authors or the repository's own
// changes, with links back to the app.

const CHANGELOG = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const NEWEST = /^## \[(v[^\]]+)\]/m.exec(CHANGELOG)![1];
// The newest pull request shown: the first item outside the hidden
// categories and the E2E-only changes.
const SHOWN = (() => {
  let hidden = false;
  for (const line of CHANGELOG.split('\n')) {
    if (line.startsWith('### ')) hidden = ['CI・リポジトリ', '依存関係'].includes(line.slice(4));
    const m = /^- (.+) by @\S+ in \S+\/pull\/(\d+)$/.exec(line);
    if (m && !hidden && !m[1].includes('E2E')) return { title: m[1], number: m[2] };
  }
  throw new Error('no item in CHANGELOG.md');
})();

test('info/ lists the releases, newest first, for users', async ({ page }) => {
  const res = await page.goto('./info/');
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle('更新情報 - mhj-dojo 麻雀道場');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('更新情報');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', /\/info\/$/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og-image\.png$/);

  const main = page.getByRole('main');
  await expect(main.locator('.release').first().locator('.release-version')).toHaveText(NEWEST);
  const item = main.getByRole('listitem').filter({ hasText: SHOWN.title });
  await expect(item).toHaveCount(1);
  await expect(item.getByRole('link', { name: `#${SHOWN.number}` })).toHaveAttribute('href', `https://github.com/litencatt/mhj-dojo/pull/${SHOWN.number}`);
  expect(await main.textContent()).not.toContain('by @');

  // The repository's own changes are left out, and a release with nothing
  // else says so.
  for (const h of ['CI・リポジトリ', '依存関係']) await expect(main.getByRole('heading', { name: h })).toHaveCount(0);
  await expect(main).not.toContainText('dependabot の対象に web の npm パッケージを追加');
  await expect(main).not.toContainText('Bump vite');
  await expect(main).not.toContainText('E2E');
  await expect(page.locator('#v2026\\.0927\\.1')).toContainText('内部の改善のみ');
});

test('info/ links back to practice and the CPU game', async ({ page }) => {
  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: '練習' }).click();
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page.locator('.app-header h1')).toContainText('麻雀道場');

  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: 'CPU対戦' }).click();
  await expect(page).toHaveURL(/\?mode=game$/);
  await expect(page.locator('.app-header h1')).toContainText('CPU対戦');
});

test('the help and the header version open info/', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
  await dialog.getByRole('region', { name: 'このアプリについて' }).getByRole('link', { name: '更新情報' }).click();
  await expect(page).toHaveURL(/\/info\/$/);
  await expect(page.locator('.release').first().locator('.release-version')).toHaveText(NEWEST);

  await page.goto('./?mode=game');
  await page.locator('.app-header .version-tag').click();
  await expect(page).toHaveURL(/\/info\/$/);
});

test('info/ fits a phone: no sideways scroll at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./info/');
  await expect(page.locator('.release').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
