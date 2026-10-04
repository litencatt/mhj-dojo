import { expect, test } from '@playwright/test';

// A minimal smoke test against the deployed public site (verify-live.yml's
// post-deploy verification, run after version.json confirms a release is
// live): the page loads, the drawn tile is visible, the header shows the
// expected release, and a discard works.
//
// EXPECT_RELEASE is the release tag verify-live.yml just saw live
// (v2026.0927.0); when unset (a local run against whatever build happens to
// be live), only check that the header's version tag is non-empty. With it
// set, the page load is cache-busted: index.html is cached for 24 hours.
test('practice loads, shows the release, and a discard works', async ({ page }) => {
  await page.goto(`./?seed=1&turns=18${process.env.EXPECT_RELEASE ? `&cb=${Date.now()}` : ''}`);
  const hand = page.getByRole('region', { name: '手牌' });
  await expect(hand).toBeVisible();
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();

  const tag = page.locator('.app-header .version-tag');
  const expected = process.env.EXPECT_RELEASE;
  if (expected) {
    await expect(tag).toHaveText(expected);
  } else {
    await expect(tag).not.toBeEmpty();
  }

  const river = hand.locator('.discard-river .tile');
  const before = await river.count();
  await drawn.click();
  await expect(river).toHaveCount(before + 1);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
