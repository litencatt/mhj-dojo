import { expect, test, type Page } from '@playwright/test';
import { loaded } from './helpers';

// The build's version: the header shows it, the help opens, and a
// banner offers a reload once version.json names another build.

// release: the tag the Release site workflow built it for (MHJDOJO_RELEASE), else null.
type Build = { version: string; release?: string | null; id: string; built: string };

const NEWER: Build = { version: 'fffffff', id: 'ffffffffffffffff', built: '2099-01-01T00:00:00.000Z' };

// The build being served, as its version.json says.
async function servedBuild(page: Page): Promise<Build> {
  const res = await page.request.get('./version.json');
  expect(res.ok()).toBe(true);
  return (await res.json()) as Build;
}

// Answers version.json with build(), and records the checks.
async function routeVersion(page: Page, build: () => Build) {
  const seen: string[] = [];
  await page.route('**/version.json*', (route) => {
    seen.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(build()) });
  });
  return seen;
}

// A check the page makes on its own schedule: past the one-a-minute limit,
// when the tab comes back into view.
async function recheck(page: Page) {
  await page.clock.fastForward('01:01');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test('the header shows the version and the help opens', async ({ page }) => {
  const served = await servedBuild(page);
  expect(served.version).toMatch(/^(dev|[0-9a-f]{7})$/);
  expect(served.id).toMatch(/^[0-9a-f]{16}$/);
  expect(Number.isNaN(Date.parse(served.built))).toBe(false);
  // CI's release-build run says which release the server was built with.
  if (process.env.MHJDOJO_EXPECT_RELEASE) expect(served.release).toBe(process.env.MHJDOJO_EXPECT_RELEASE);
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  // A release shows its tag; any other build its commit and date.
  const tag = page.locator('.app-header .version-tag');
  if (served.release) {
    expect(served.release).toMatch(/^v\d{4}\.\d{4}\.\d+$/);
    await expect(tag).toHaveText(served.release);
    // The title opens with the link's purpose, then the release (VersionTag).
    await expect(tag).toHaveAttribute('title', new RegExp(`^更新情報を開く\\nリリース: ${served.release.replaceAll('.', '\\.')}\\n`));
  } else {
    await expect(tag).toHaveText(/^(dev|[0-9a-f]{7})( · \d{4}-\d{2}-\d{2})?$/);
  }

  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
  await expect(dialog.getByRole('heading', { name: '保存', exact: true })).toBeVisible();
  // The third-party licenses the site ships are linked and served.
  const licenses = dialog.getByRole('link', { name: 'THIRD_PARTY_LICENSES.txt' });
  const res = await page.request.get(new URL((await licenses.getAttribute('href'))!, page.url()).href);
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain('Preact');
  expect(text).toContain('The Go Authors');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

/** An ISO 8601 time as a clock in timeZone shows it: "2026-09-27 07:57". */
function localTime(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// The build time is UTC; the header shows the viewer's local date and its
// title the local time. Two zones 25 hours apart always see different dates.
for (const timeZone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
  test.describe(`in ${timeZone}`, () => {
    test.use({ timezoneId: timeZone });
    test('the version date is the local one', async ({ page }) => {
      const served = await servedBuild(page);
      const local = localTime(served.built, timeZone);
      expect(local.slice(0, 10)).not.toBe(localTime(served.built, timeZone === 'Pacific/Kiritimati' ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati').slice(0, 10));
      await page.goto('./?seed=1&turns=18');
      await loaded(page);
      const tag = page.locator('.app-header .version-tag');
      await expect(tag).toHaveAttribute('title', new RegExp(`\\nビルド: ${served.version}（${local}、${served.id}）`));
      // A release shows its tag instead of the date.
      if (!served.release) await expect(tag).toHaveText(`${served.version} · ${local.slice(0, 10)}`);
    });
  });
}

test('no banner for the running build, even redeployed at another time', async ({ page }) => {
  const served = await servedBuild(page);
  await page.clock.install();
  let current = served;
  const seen = await routeVersion(page, () => current);
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  await expect.poll(() => seen.length).toBe(1);
  // Fetched past every cache.
  expect(new URL(seen[0]).searchParams.get('t')).toMatch(/^\d+$/);

  // The same sources deployed again: another build time only.
  current = { ...served, built: '2099-01-01T00:00:00.000Z' };
  await recheck(page);
  await expect.poll(() => seen.length).toBe(2);
  await expect(page.locator('.update-banner')).toHaveCount(0);

  // At most one check a minute.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  expect(seen.length).toBe(2);
});

test('no checks while the tab is hidden', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  const served = await servedBuild(page);
  const seen = await routeVersion(page, () => served);
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  await page.waitForTimeout(300);
  expect(seen).toHaveLength(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => seen.length).toBe(1);
});

test('a newer build: banner, reload past the cache, and no loop if the old page comes back', async ({ page }) => {
  const served = await servedBuild(page);
  await page.clock.install();
  let current = served;
  const seen = await routeVersion(page, () => current);
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  await expect.poll(() => seen.length).toBe(1);
  await expect(page.locator('.update-banner')).toHaveCount(0);

  // A deploy while the page is open: the next check notices it.
  current = NEWER;
  await recheck(page);
  const banner = page.getByRole('status').locator('.update-banner').filter({ hasText: '新しいバージョンがあります' });
  await expect(banner).toBeVisible();
  const reload = banner.getByRole('button', { name: '再読み込み' });
  await expect(reload).toBeVisible();
  await expect(banner.getByRole('link', { name: '変更点' })).toHaveAttribute('href', 'info/');

  // Checking stops once a newer build is found.
  const checks = seen.length;
  await page.clock.fastForward('11:00');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  expect(seen.length).toBe(checks);

  // 再読み込み loads the same page (its session and seed kept) with the new
  // id added, which the cached index.html doesn't answer.
  const session = new URL(page.url()).searchParams.get('session');
  expect(session).toBeTruthy();
  const nav = page.waitForRequest((req) => req.isNavigationRequest());
  await reload.click();
  const url = new URL((await nav).url());
  expect(url.searchParams.get('_v')).toBe(NEWER.id);
  expect(url.searchParams.get('seed')).toBe('1');
  expect(url.searchParams.get('session')).toBe(session);
  await loaded(page);
  // The parameter doesn't stay in the address bar; the rest does.
  await expect.poll(() => new URL(page.url()).searchParams.has('_v')).toBe(false);
  expect(new URL(page.url()).searchParams.get('session')).toBe(session);

  // The CDN still served the old page (this test serves the same build
  // again): say that it can take a while, without offering the reload again.
  await expect(page.getByRole('status').locator('.update-banner').filter({ hasText: '更新の反映まで時間がかかることがあります' })).toBeVisible();
  await expect(page.getByRole('button', { name: '再読み込み' })).toHaveCount(0);
});

test('the banner can be dismissed', async ({ page }) => {
  await routeVersion(page, () => NEWER);
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  const banner = page.locator('.update-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: '閉じる' }).click();
  await expect(banner).toHaveCount(0);
  // The status region stays, empty, for the next announcement.
  await expect(page.locator('.update-status')).toHaveCount(1);
});

test('a failing version.json shows nothing', async ({ page }) => {
  let failed = 0;
  await page.route('**/version.json*', (route) => {
    failed++;
    return route.abort();
  });
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  await expect.poll(() => failed).toBeGreaterThan(0);
  await expect(page.locator('.update-banner')).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
