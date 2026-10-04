import { expect, test } from '@playwright/test';
import { SEED, handPanel, playOneStep, slowEngine, waitForPlayback } from './helpers';

// The CPU game's 設定 form picks how fast the CPU moves are replayed, kept in
// this browser.

test('the playback speed is saved, and なし shows the CPU moves at once', async ({ page }) => {
  slowEngine();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);

  const speed = page.getByLabel('CPUの動き');
  await expect(speed).toHaveValue('normal');
  await speed.selectOption({ label: 'なし' });
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
  await expect(page.getByLabel('CPUの動き')).toHaveValue('none');
});

test('a slow speed still replays the moves', async ({ page }) => {
  slowEngine();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await page.getByLabel('CPUの動き').selectOption({ label: '遅い' });
  await playOneStep(page);
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'true');
  await waitForPlayback(page);
});
