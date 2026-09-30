import { expect, test } from '@playwright/test';
import { versionPattern } from '../helpers';

// The header's version on the local server only, from its GET /api/version
// (e2e/shared/help.spec.ts has the rest, on both builds).

test('the server reports its version, and the header shows it', async ({ page }) => {
  const version = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/version');
  await page.goto('/?seed=1&turns=18');
  const res = await version;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { version: string };
  // The E2E server runs under `go run`, which stamps no commit.
  expect(body.version).toBe('dev');
  await expect(page.locator('.app-header .version-tag')).toHaveText(versionPattern());
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
