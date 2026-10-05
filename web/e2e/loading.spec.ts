import { expect, test } from '@playwright/test';

// The wait for the engine (issue #192): a status with a spinner while the
// wasm downloads, and a manifest that installs and opens modes properly.

test('engine loading is announced while the wasm downloads, then goes away', async ({ context, page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await context.route('**/mhj-dojo.wasm*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('./');
  const status = page.getByRole('status').filter({ hasText: '計算エンジンを読み込んでいます' });
  await expect(status).toBeVisible();
  await expect(status.locator('.spinner')).toBeVisible();
  release();
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  await expect(status).toHaveCount(0);
});

test('the manifest has a scope, a maskable icon and shortcuts', async ({ page }) => {
  const res = await page.request.get('./manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = (await res.json()) as {
    scope: string;
    theme_color: string;
    icons: { src: string; purpose?: string }[];
    shortcuts: { name: string; url: string }[];
  };
  expect(m.scope).toBe('./');
  const maskable = m.icons.find((i) => i.purpose === 'maskable');
  expect(maskable).toBeTruthy();
  expect((await page.request.get(`./${maskable!.src}`)).ok()).toBe(true);
  expect(m.shortcuts.map((s) => s.url)).toEqual(['./', './?mode=game']);
  await page.goto('./');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', m.theme_color);
});
