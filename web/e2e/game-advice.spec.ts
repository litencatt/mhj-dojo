import { expect, test } from '@playwright/test';
import { SEED, handPanel, playOneStep, waitForPlayback } from './helpers';

// The CPU game's advice panel and the danger marks on your hand.

// A CPU declares riichi within 3 of your tsumogiri moves. Guarded by
// TestE2ESeedCPURiichi in internal/apicall/e2e_seeds_test.go.
const RIICHI_SEED = 57;

test('a desktop game offers the advice in the dock, and the option turns it off', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  await dock.getByRole('button', { name: 'アドバイス' }).click();
  const panel = page.getByRole('region', { name: 'アドバイス' });
  const candidates = panel.getByRole('list', { name: 'おすすめの打牌' }).getByRole('listitem');
  await expect(candidates.first()).toBeVisible();
  // A focused candidate marks its tile in the hand.
  await candidates.first().focus();
  await expect(handPanel(page).locator('.tile-advice').first()).toBeVisible();

  const option = page.getByRole('checkbox', { name: 'アドバイス・危険度' });
  await expect(option).toBeChecked();
  await option.uncheck();
  await expect(panel).toHaveCount(0);
  await expect(dock.getByRole('button', { name: 'アドバイス' })).toHaveCount(0);
  await page.reload();
  await waitForPlayback(page);
  await expect(page.getByRole('checkbox', { name: 'アドバイス・危険度' })).not.toBeChecked();
  await expect(page.getByRole('region', { name: 'アドバイス' })).toHaveCount(0);
});

test('a CPU riichi marks the danger of every tile you hold', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`./?mode=game&seed=${RIICHI_SEED}&length=tonpuu`);
  const hand = handPanel(page);
  const marked = hand.locator('.tile-danger');
  await waitForPlayback(page);
  for (let i = 0; i < 3 && (await marked.count()) === 0; i++) {
    await playOneStep(page);
    await waitForPlayback(page);
  }
  const held = await hand.locator('.hand-tiles .tile, .hand-drawn .tile').count();
  await expect(marked).toHaveCount(held);
  await expect(marked.first()).toHaveAttribute('aria-label', /、危険度 [安低中危]（(下家|対面|上家)/);
  await expect(marked.first()).toHaveAttribute('title', /^危険度 /);

  await page.getByRole('checkbox', { name: 'アドバイス・危険度' }).uncheck();
  await expect(marked).toHaveCount(0);
});
