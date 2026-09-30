import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The 更新情報 page in the local build: the server serves it at /info/ (and
// /info), and the page renders the server's CHANGELOG.md (GET /api/changelog).

const NEWEST = /^## \[(v[^\]]+)\]/m.exec(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'))![1];

for (const path of ['/info/', '/info']) {
  test(`${path} shows the changelog`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/info\/$/);
    await expect(page).toHaveTitle('更新情報 - mhj-dojo 麻雀道場');
    const first = page.getByRole('main').locator('.release').first();
    await expect(first.locator('.release-version')).toHaveText(NEWEST);
    // The newest release may have only internal changes; some release lists one.
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('GitHub');
    expect(await page.getByRole('main').textContent()).not.toContain('by @');
    await expect(page.getByRole('main').getByRole('heading', { name: 'CI・リポジトリ' })).toHaveCount(0);
  });
}

test('the help opens /info/ and it links back to the app', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  await page.getByRole('dialog', { name: 'ヘルプ' }).getByRole('region', { name: 'バージョン表示' }).getByRole('link', { name: '更新情報' }).click();
  await expect(page).toHaveURL(/\/info\/$/);
  await expect(page.locator('.release').first()).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'CPU対戦' }).click();
  await expect(page).toHaveURL(/\/\?mode=game$/);
  await expect(page.locator('.app-header h1')).toContainText('CPU対戦');
});

test('練習 goes back to the practice session the page came from', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page).toHaveURL(/session=/);
  const practice = page.url();
  await page.locator('.app-header .version-tag').click();
  await expect(page).toHaveURL(/\/info\/$/);
  await expect(page.locator('.release').first()).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: '練習' }).click();
  await expect(page).toHaveURL(practice);
});
