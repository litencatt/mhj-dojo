import { expect, test, type Page } from '@playwright/test';
import { dojoProgress, loaded, openSettings } from './helpers';
import { initialProgress, STORAGE_KEY, type DojoProgress } from '../src/dojo/progress.ts';

// The looks chosen in the dojo (dojo/looks.tsx) show in practice and CPU games
// too, and their 設定 choose them again for every mode.

const htmlAttr = (page: Page, name: string) => page.evaluate((n) => document.documentElement.getAttribute(n), name);

/** Stores the dojo's progress (over the initial one) before the page loads, while the browser has none yet. */
async function seedDojo(page: Page, progress: Partial<DojoProgress>) {
  const stored = JSON.stringify({ ...initialProgress(), ...progress });
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, stored],
  );
}

const OWNED: Partial<DojoProgress> = {
  ownedItems: ['theme:wafuu', 'back:shima', 'effect:kamifubuki'],
  activeTheme: 'theme:wafuu',
  activeBack: 'back:shima',
  activeEffect: 'effect:kamifubuki',
};

for (const { name, url } of [
  { name: 'practice', url: './?seed=1' },
  { name: 'a CPU game', url: './?mode=game&seed=1' },
]) {
  test(`${name} shows the dojo's looks, and its 設定 chooses them again for the dojo`, async ({ page }) => {
    await seedDojo(page, OWNED);
    await page.goto(url);
    await loaded(page);
    await expect.poll(() => htmlAttr(page, 'data-tile-theme')).toBe('wafuu');
    expect(await htmlAttr(page, 'data-tile-back')).toBe('shima');
    expect(await htmlAttr(page, 'data-win-effect')).toBe('kamifubuki');
    // A reload keeps them.
    await page.reload();
    await loaded(page);
    await expect.poll(() => htmlAttr(page, 'data-tile-theme')).toBe('wafuu');

    // 設定 offers the default and what is owned, and stores the choice in the dojo's progress.
    const settings = await openSettings(page);
    const themes = settings.getByRole('group', { name: '牌テーマ' });
    await expect(themes.getByRole('radio')).toHaveCount(2); // 標準 and 和風
    await expect(themes.getByRole('radio', { name: '和風' })).toBeChecked();
    await expect(settings.getByRole('group', { name: '裏柄' }).getByRole('radio')).toHaveCount(2); // 無地 and 縞
    await expect(settings.getByRole('group', { name: '卓布' }).getByRole('radio')).toHaveCount(1); // 標準 only
    await themes.getByRole('radio', { name: '標準' }).check();
    await expect.poll(() => htmlAttr(page, 'data-tile-theme')).toBe(null);
    await settings.getByRole('group', { name: '裏柄' }).getByRole('radio', { name: '無地' }).check();
    await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe(null);
    expect(await dojoProgress(page)).toMatchObject({ activeTheme: 'default', activeBack: 'default', activeEffect: 'effect:kamifubuki' });

    // The dojo shows the choice made here.
    await page.goto('./?mode=dojo');
    await expect(page.getByTestId('dojo-level')).toBeVisible();
    await page.getByRole('button', { name: '設定' }).click();
    await expect(page.getByRole('dialog', { name: '設定' }).getByRole('group', { name: '牌テーマ' }).getByRole('radio', { name: '標準' })).toBeChecked();
    expect(await htmlAttr(page, 'data-tile-theme')).toBe(null);
  });

  test(`${name} without a dojo keeps the default looks and offers none in 設定`, async ({ page }) => {
    await page.goto(url);
    await loaded(page);
    for (const attr of ['data-tile-theme', 'data-tile-back', 'data-table-cloth', 'data-riichi-stick', 'data-win-effect']) {
      expect(await htmlAttr(page, attr)).toBe(null);
    }
    const settings = await openSettings(page);
    await expect(settings.getByRole('group', { name: '牌テーマ' })).toHaveCount(0);
    await expect(settings.getByLabel('見本')).toHaveCount(0);
  });
}

test('a change of the looks in another tab shows on an open practice', async ({ page, context }) => {
  await seedDojo(page, OWNED);
  await page.goto('./?seed=1');
  await loaded(page);
  await expect.poll(() => htmlAttr(page, 'data-tile-theme')).toBe('wafuu');

  const other = await context.newPage();
  await other.goto('./?mode=dojo');
  await other.getByRole('button', { name: '設定' }).click();
  await other.getByRole('dialog', { name: '設定' }).getByRole('group', { name: '裏柄' }).getByRole('radio', { name: '無地' }).check();
  await expect.poll(() => htmlAttr(page, 'data-tile-back')).toBe(null);
  expect(await htmlAttr(page, 'data-tile-theme')).toBe('wafuu');
});

test("practice's tsumo panel plays the win effect at 跳満 or above, unless motion is reduced", async ({ page }) => {
  await seedDojo(page, OWNED);
  await page.goto('./?seed=1');
  await loaded(page);
  await expect.poll(() => htmlAttr(page, 'data-win-effect')).toBe('kamifubuki');
  // A win effect in a practice's win panel (as WinPanel adds it at 6 han or more).
  const display = () =>
    page.evaluate(() => {
      const box = document.createElement('section');
      box.className = 'win-panel';
      const el = document.createElement('div');
      el.className = 'win-effect';
      box.append(el);
      document.body.append(box);
      const v = getComputedStyle(el).display;
      box.remove();
      return v;
    });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await display()).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await display()).toBe('block');
});
