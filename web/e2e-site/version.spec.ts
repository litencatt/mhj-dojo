import { expect, test, type Page } from '@playwright/test';

// The static site's version: the header shows it, the help opens, and a
// banner offers a reload once version.json names another build.

type Build = { version: string; built: string };

// The build being served, as its version.json says.
async function servedBuild(page: Page): Promise<Build> {
  const res = await page.request.get('./version.json');
  expect(res.ok()).toBe(true);
  return (await res.json()) as Build;
}

// Answers version.json with build, and counts the checks.
async function routeVersion(page: Page, build: () => Build) {
  const seen: string[] = [];
  await page.route('**/version.json*', (route) => {
    seen.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(build()) });
  });
  return seen;
}

test('the header shows the version and the help opens', async ({ page }) => {
  const served = await servedBuild(page);
  expect(served.version).toMatch(/^(dev|[0-9a-f]{7})$/);
  expect(Number.isNaN(Date.parse(served.built))).toBe(false);
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(page.locator('.app-header .version-tag')).toHaveText(/^(dev|[0-9a-f]{7}) · \d{4}-\d{2}-\d{2}$/);

  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
  await expect(dialog.getByRole('heading', { name: '公開版の保存', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('no banner while version.json names the running build', async ({ page }) => {
  const served = await servedBuild(page);
  const seen = await routeVersion(page, () => served);
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  // Fetched past every cache.
  expect(new URL(seen[0]).searchParams.get('t')).toMatch(/^\d+$/);
  await expect(page.locator('.update-banner')).toHaveCount(0);
});

test('a banner offers a reload once a newer build is deployed', async ({ page }) => {
  const served = await servedBuild(page);
  let current = served;
  const seen = await routeVersion(page, () => current);
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect.poll(() => seen.length).toBeGreaterThan(0);
  await expect(page.locator('.update-banner')).toHaveCount(0);

  // A deploy while the page is open: the next check (here, the tab coming
  // back into view) notices it.
  current = { version: 'fffffff', built: '2099-01-01T00:00:00.000Z' };
  const checks = seen.length;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => seen.length).toBeGreaterThan(checks);
  const banner = page.getByRole('status').filter({ hasText: '新しいバージョンがあります' });
  await expect(banner).toBeVisible();

  // 再読み込み reloads the page.
  await Promise.all([page.waitForEvent('load'), banner.getByRole('button', { name: '再読み込み' }).click()]);
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
});

test('a failing version.json shows nothing', async ({ page }) => {
  let failed = 0;
  await page.route('**/version.json*', (route) => {
    failed++;
    return route.abort();
  });
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect.poll(() => failed).toBeGreaterThan(0);
  await expect(page.locator('.update-banner')).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
