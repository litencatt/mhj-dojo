import { expect, test, type Page } from '@playwright/test';
import { loaded } from './helpers';

// The Service Worker (src/sw.template.js; issue #192): the files it
// precaches, the site offline after a first load, and a new build's page
// taking over from an older build's worker.

test.use({ serviceWorkers: 'allow' });

// Waits for the page's worker to be active (it registers after load).
async function swReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

async function activeWorker(page: Page) {
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? null);
}

test('sw.js precaches this build: its pages, assets and engine', async ({ page }) => {
  const res = await page.request.get('./sw.js');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toMatch(/javascript/);
  expect(res.headers()['cache-control']).toBe('no-cache');
  const sw = await res.text();
  const build = /^const BUILD = (".*");$/m.exec(sw);
  const list = /^const PRECACHE = (\[[^\]]*\]);$/m.exec(sw);
  expect(build).not.toBeNull();
  expect(list).not.toBeNull();
  const id = JSON.parse(build![1]) as string;
  const precache = JSON.parse(list![1]) as string[];

  // The build version.json names.
  const version = (await (await page.request.get('./version.json')).json()) as { id: string };
  expect(id).toBe(version.id);

  // The pages and every asset they reference.
  expect(precache).toEqual(expect.arrayContaining(['./', 'info/', 'manifest.webmanifest', 'icon.svg']));
  for (const html of ['./', 'info/']) {
    const text = await (await page.request.get(html)).text();
    const assets = [...text.matchAll(/(?:src|href)="(?:\.\.?\/)?(assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    expect(precache).toEqual(expect.arrayContaining(assets));
  }

  // The engine's files, at the ?v= the page loads them by.
  const worker = page.waitForRequest(/\/worker\.js\?v=/);
  await page.goto('./?seed=1&turns=18');
  const v = new URL((await worker).url()).searchParams.get('v');
  expect(v).toMatch(/^[0-9a-f]{12}$/);
  expect(precache).toEqual(expect.arrayContaining([`worker.js?v=${v}`, `wasm_exec.js?v=${v}`, `mhj-dojo.wasm?v=${v}`]));

  // Never version.json (the update check), the worker itself or og-image.png.
  for (const f of ['version.json', 'sw.js', 'og-image.png']) expect(precache).not.toContain(f);
  for (const f of precache) expect((await page.request.get(f)).status(), f).toBe(200);
});

test('works offline after the first load', async ({ page, context }) => {
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  await swReady(page);

  await context.setOffline(true);
  const res = await page.reload();
  expect(res?.fromServiceWorker()).toBe(true);
  await loaded(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // The CPU game and the 更新情報 page too.
  await page.goto('./?mode=game&seed=1');
  await expect(page.getByRole('region', { name: '手牌' }).first()).toBeVisible();
  await page.goto('./info/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Their other addresses.
  await page.goto('./info');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('./index.html?seed=1&turns=18');
  await loaded(page);
});

test("a new build's page takes over from an older build's worker, also via 再読み込み", async ({ page }) => {
  const served = (await (await page.request.get('./version.json')).json()) as { id: string };
  const NEWER = { version: 'fffffff', id: 'ffffffffffffffff', built: '2099-01-01T00:00:00.000Z' };
  await page.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(NEWER) }));
  await page.goto('./?seed=1&turns=18');
  await loaded(page);
  await swReady(page);
  expect(await activeWorker(page)).toContain(`sw.js?v=${served.id}`);

  // An older build's worker in control: the same script at another URL.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('sw.js?v=older', { scope: './' });
    const w = (reg.installing ?? reg.waiting)!;
    await new Promise<void>((resolve) => {
      w.addEventListener('statechange', () => w.state === 'activated' && resolve());
      if (w.state === 'installed') w.postMessage('SKIP_WAITING');
      else w.addEventListener('statechange', () => w.state === 'installed' && w.postMessage('SKIP_WAITING'));
    });
  });
  expect(await activeWorker(page)).toContain('sw.js?v=older');

  // 再読み込み loads the page from the network, past the older worker's
  // cache, and that page's own worker takes over.
  const banner = page.locator('.update-banner').filter({ hasText: '新しいバージョンがあります' });
  const nav = page.waitForRequest((req) => req.isNavigationRequest());
  await banner.getByRole('button', { name: '再読み込み' }).click();
  expect(new URL((await nav).url()).searchParams.get('_v')).toBe(NEWER.id);
  await loaded(page);
  await expect.poll(() => activeWorker(page)).toContain(`sw.js?v=${served.id}`);
});
