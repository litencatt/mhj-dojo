import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { forUsersOnly, parseChangelog } from '../../src/changelog';

// The 更新情報 page in the local build: the server serves it at /info/ (and
// /info), and the page renders the server's CHANGELOG.md (GET /api/changelog).
// e2e/shared/info.spec.ts has the ways there and back, on both builds.

const RELEASES = forUsersOnly(parseChangelog(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8')));
const NEWEST = RELEASES[0].version;
// A release with only the repository's own changes lists no items.
const NEWEST_HAS_ITEMS = RELEASES[0].sections.length > 0;

for (const path of ['/info/', '/info']) {
  test(`${path} shows the changelog`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/info\/$/);
    await expect(page).toHaveTitle('更新情報 - mhj-dojo 麻雀道場');
    const first = page.getByRole('main').locator('.release').first();
    await expect(first.locator('.release-version')).toHaveText(NEWEST);
    if (NEWEST_HAS_ITEMS) await expect(first.getByRole('listitem').first()).toBeVisible();
    else await expect(first).toContainText('内部の改善のみ');
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('GitHub');
    expect(await page.getByRole('main').textContent()).not.toContain('by @');
    await expect(page.getByRole('main').getByRole('heading', { name: 'CI・リポジトリ' })).toHaveCount(0);
  });
}
