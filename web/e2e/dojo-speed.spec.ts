import { expect, test } from '@playwright/test';
import { GAME_URL, SEED, handPanel, newDojoGame, openSettings, settingsChoice, settingsDialog } from './helpers';

// The dojo's playback speed: 遅い and 普通 from the start, 速い and なし once
// bought, kept apart from the CPU game's own setting.

const DOJO_KEY = 'mhj-dojo.dojo.playback-speed.v1';
const GAME_KEY = 'mhj-dojo.playback-speed.v1';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('a new dojo offers 遅い and 普通 only, and keeps the choice apart from the CPU game', async ({ page }) => {
  await newDojoGame(page, SEED);
  await openSettings(page);
  const speed = settingsChoice(page, '再生速度');
  await expect(speed.nth(1)).toBeChecked();
  await expect(speed).toHaveCount(2);
  await expect(speed.nth(0)).toHaveAccessibleName('遅い');
  await speed.nth(0).check();
  expect(await page.evaluate((k) => localStorage.getItem(k), DOJO_KEY)).toBe('slow');
  expect(await page.evaluate((k) => localStorage.getItem(k), GAME_KEY)).toBeNull();
});

test('a bought 速い and なし are offered and saved', async ({ page }) => {
  await newDojoGame(page, SEED, { ownedItems: ['assist:speed-fast', 'assist:speed-instant'] });
  await openSettings(page);
  const speed = settingsChoice(page, '再生速度');
  await expect(speed).toHaveCount(4);
  await speed.nth(3).check();
  await expect(speed.nth(3)).toHaveAccessibleName('なし');
  expect(await page.evaluate((k) => localStorage.getItem(k), DOJO_KEY)).toBe('none');
  await page.reload();
  await openSettings(page);
  await expect(settingsChoice(page, '再生速度').nth(3)).toBeChecked();
});

test('a speed not owned that was saved goes back to 普通', async ({ page }) => {
  await page.addInitScript(([k]) => localStorage.setItem(k, 'none'), [DOJO_KEY]);
  await newDojoGame(page, SEED, { ownedItems: ['assist:speed-fast'] });
  await openSettings(page);
  const speed = settingsChoice(page, '再生速度');
  await expect(speed).toHaveCount(3);
  await expect(speed.nth(1)).toBeChecked();
  await expect(speed.nth(1)).toHaveAccessibleName('普通');
});

test('the CPU game ignores the dojo speed', async ({ page }) => {
  await page.addInitScript(([k]) => localStorage.setItem(k, 'slow'), [DOJO_KEY]);
  await page.goto(GAME_URL);
  // Opened before the first game is dealt: the game coming in leaves it open.
  await openSettings(page);
  await expect(handPanel(page)).toBeVisible();
  await expect(settingsDialog(page)).toBeVisible();
  await expect(settingsChoice(page, '再生速度')).toHaveCount(4);
  await expect(settingsChoice(page, '再生速度').nth(1)).toBeChecked();
});
