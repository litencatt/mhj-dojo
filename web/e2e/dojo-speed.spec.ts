import { expect, test } from '@playwright/test';
import { SEED, newDojoGame } from './helpers';

// The dojo's playback speed: 遅い and 普通 from the start, 速い and なし once
// bought, kept apart from the CPU game's own setting.

const DOJO_KEY = 'mhj-dojo.dojo.playback-speed.v1';
const GAME_KEY = 'mhj-dojo.playback-speed.v1';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('a new dojo offers 遅い and 普通 only, and keeps the choice apart from the CPU game', async ({ page }) => {
  await newDojoGame(page, SEED);
  const speed = page.getByLabel('再生速度');
  await expect(speed).toHaveValue('normal');
  await expect(speed.locator('option')).toHaveText(['遅い', '普通']);
  await speed.selectOption({ label: '遅い' });
  expect(await page.evaluate((k) => localStorage.getItem(k), DOJO_KEY)).toBe('slow');
  expect(await page.evaluate((k) => localStorage.getItem(k), GAME_KEY)).toBeNull();
});

test('a bought 速い and なし are offered and saved', async ({ page }) => {
  await newDojoGame(page, SEED, { ownedItems: ['assist:speed-fast', 'assist:speed-instant'] });
  const speed = page.getByLabel('再生速度');
  await expect(speed.locator('option')).toHaveText(['遅い', '普通', '速い', 'なし']);
  await speed.selectOption({ label: 'なし' });
  expect(await page.evaluate((k) => localStorage.getItem(k), DOJO_KEY)).toBe('none');
  await page.reload();
  await expect(page.getByLabel('再生速度')).toHaveValue('none');
});

test('a speed not owned that was saved goes back to 普通', async ({ page }) => {
  await page.addInitScript(([k]) => localStorage.setItem(k, 'none'), [DOJO_KEY]);
  await newDojoGame(page, SEED, { ownedItems: ['assist:speed-fast'] });
  const speed = page.getByLabel('再生速度');
  await expect(speed).toHaveValue('normal');
  await expect(speed.locator('option')).toHaveText(['遅い', '普通', '速い']);
});

test('the CPU game ignores the dojo speed', async ({ page }) => {
  await page.addInitScript(([k]) => localStorage.setItem(k, 'slow'), [DOJO_KEY]);
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(page.getByLabel('再生速度')).toHaveValue('normal');
  await expect(page.getByLabel('再生速度').locator('option')).toHaveCount(4);
});
