import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { forUsersOnly, parseChangelog } from '../src/changelog';
import { PHONE } from './helpers';

// The 更新情報 page (info/), which the build renders from CHANGELOG.md: the
// releases newest first, without the authors or the repository's own
// changes, and the ways there from the app and back.

const RELEASES = forUsersOnly(parseChangelog(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')));
const NEWEST = RELEASES[0].version;
// The newest pull request shown.
const SHOWN = RELEASES.flatMap((r) => r.sections.flatMap((s) => s.items))[0];
const FIRST = RELEASES.at(-1)!.version;

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
  // The page is for the app's users: nothing links to GitHub.
  await expect(main.getByRole('link')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('GitHub');
  expect(await main.textContent()).not.toContain('by @');

  // The repository's own changes are left out, and a release with nothing
  // else says so.
  for (const h of ['CI・リポジトリ', '依存関係']) await expect(main.getByRole('heading', { name: h })).toHaveCount(0);
  await expect(main).not.toContainText('dependabot の対象に web の npm パッケージを追加');
  await expect(main).not.toContainText('Bump vite');
  await expect(main).not.toContainText('E2E');
  await expect(page.locator('#v2026\\.0927\\.1')).toContainText('内部の改善のみ');

  // The first release is only named, not its whole history.
  const first = main.locator('.release').last();
  await expect(first.locator('.release-version')).toHaveText(FIRST);
  await expect(first).toContainText('最初の公開');
  await expect(main).not.toContainText('Add CI workflow');
});

test('the new-version banner links to info/ and stays one line on a phone', async ({ page }) => {
  await page.route('**/version.json*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'fffffff', id: 'ffffffffffffffff', built: '2099-01-01T00:00:00.000Z' }) }),
  );
  await page.setViewportSize(PHONE);
  await page.goto('./?seed=1&turns=18');
  const banner = page.locator('.update-banner');
  await expect(banner).toContainText('新しいバージョンがあります');
  const b = (await banner.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(390);
  expect(b.height).toBeLessThan(56);
  await banner.getByRole('link', { name: '変更点' }).click();
  await expect(page).toHaveURL(/\/info\/$/);
});

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

test('info/ links back to practice, the CPU game and the dojo', async ({ page }) => {
  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: '練習' }).click();
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page.locator('.app-header h1')).toContainText('練習');

  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: 'CPU対戦' }).click();
  await expect(page).toHaveURL(/\/\?mode=game$/);
  await expect(page.locator('.app-header h1')).toContainText('CPU対戦');

  await page.goto('./info/');
  await page.getByRole('navigation').getByRole('link', { name: '道場' }).click();
  await expect(page).toHaveURL(/\/\?mode=dojo$/);
  await expect(page.locator('.app-header h1')).toContainText('道場');
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
  await page.setViewportSize(PHONE);
  await page.goto('./info/');
  await expect(page.locator('.release').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
