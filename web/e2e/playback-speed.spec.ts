import { expect, test } from '@playwright/test';
import { GAME_URL, handPanel, openSettings, playOneStep, settingsChoice, slowEngine, waitForPlayback } from './helpers';

// The CPU game's 設定 form picks how fast the CPU moves are replayed, kept in
// this browser.

test('the playback speed is saved, and なし shows the CPU moves at once', async ({ page }) => {
  slowEngine();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(GAME_URL);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);

  await openSettings(page);
  const speed = settingsChoice(page, '再生速度');
  await expect(speed.nth(1)).toBeChecked();
  await speed.nth(3).check();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => localStorage.getItem('mhj-dojo.playback-speed.v1'))).toBe('none');

  // Record every change of the table's data-playing flag from now on.
  await page.evaluate(() => {
    const w = window as unknown as { playingSeen: string[] };
    w.playingSeen = [];
    const table = document.querySelector('.game-table')!;
    new MutationObserver(() => w.playingSeen.push(table.getAttribute('data-playing') ?? '')).observe(table, {
      attributes: true,
      attributeFilter: ['data-playing'],
    });
  });
  await playOneStep(page);
  await waitForPlayback(page);
  expect(await page.evaluate(() => (window as unknown as { playingSeen: string[] }).playingSeen)).not.toContain('true');

  await page.reload();
  await expect(handPanel(page)).toBeVisible();
  await openSettings(page);
  await expect(settingsChoice(page, '再生速度').nth(3)).toBeChecked();
});

test('a slow speed paces the CPU moves at least 600ms apart', async ({ page }) => {
  slowEngine();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(GAME_URL);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await openSettings(page);
  await settingsChoice(page, '再生速度').nth(0).check();
  await page.keyboard.press('Escape');
  // Time each change of the log of moves while the next move is played.
  await page.evaluate(() => {
    const w = window as unknown as { logTimes: number[] };
    w.logTimes = [];
    const log = document.querySelector('[aria-label="この局の動き"]')!;
    new MutationObserver(() => w.logTimes.push(performance.now())).observe(log, { childList: true, subtree: true });
  });
  await playOneStep(page);
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'true');
  await waitForPlayback(page);
  const times = await page.evaluate(() => (window as unknown as { logTimes: number[] }).logTimes);
  // times[0] is the human's own move; the rest are paced CPU moves.
  const gaps = times.slice(1).map((t, i) => t - times[i]).slice(1);
  expect(gaps.length, 'at least two CPU moves were paced').toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(600);
});
