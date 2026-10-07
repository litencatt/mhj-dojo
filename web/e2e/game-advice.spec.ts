import { expect, test } from '@playwright/test';
import { SEED, engineCalls, handPanel, playOneStep, waitForPlayback } from './helpers';

// The CPU game's advice panel and the danger marks on your hand.

// A CPU declares riichi within 3 of your tsumogiri moves. Guarded by
// TestE2ESeedCPURiichi in internal/apicall/e2e_seeds_test.go.
const RIICHI_SEED = 1;

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

test('after the CPU replay, a visible summary sums up the riichi', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`./?mode=game&seed=${RIICHI_SEED}&length=tonpuu`);
  const status = page.getByTestId('cpu-summary');
  await waitForPlayback(page);
  await expect(status).toHaveText('');
  for (let i = 0; i < 3; i++) {
    await playOneStep(page);
    await waitForPlayback(page);
    if (/がリーチ/.test(await status.innerText())) break;
  }
  await expect(status).toHaveText(/(下家|対面|上家)がリーチ.*。$/);
  await expect(status).toBeVisible();
});

// On a phone the advice panel has no room: the best discard is a chip in the
// action bar, and a tap marks its tile in the hand (issue #230). With the
// advice off the page asks the engine to leave it out (advice=0), and turning
// it on asks again for the state shown.
// SEED is guarded by TestE2ESeedPhoneAdvice (internal/apicall/e2e_seeds_test.go).
test.describe('a phone game', () => {
  test.use({ hasTouch: true });

  test('offers the best discard as a chip that marks its tile, and asks for the advice only while it is on', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = await engineCalls(page);
    await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
    await waitForPlayback(page);
    const chip = page.getByRole('button', { name: /^おすすめ: / });
    await expect(chip).toBeVisible();
    await expect(page.getByRole('region', { name: 'アドバイス' })).toHaveCount(0);
    expect((await calls()).filter((c) => c.includes('/api/games') && c.includes('advice=0'))).toEqual([]);

    // A tap marks the tile in the hand, another unmarks it.
    const marked = handPanel(page).locator('.tile-advice');
    await expect(marked).toHaveCount(0);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(marked).toHaveCount(1);
    await chip.click();
    await expect(marked).toHaveCount(0);

    // Off: the chip goes, and the engine is asked for no advice.
    const settings = page.getByRole('button', { name: /^設定/ });
    await settings.click();
    await page.getByRole('checkbox', { name: 'おすすめ・危険度' }).uncheck();
    await page.keyboard.press('Escape');
    await expect(chip).toHaveCount(0);
    await calls();
    await playOneStep(page);
    await waitForPlayback(page);
    const sent = (await calls()).filter((c) => /^POST \/api\/games\/\S+\/action/.test(c));
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) expect(c).toContain('advice=0');
    await expect(chip).toHaveCount(0);

    // On again: the state shown (asked for without the advice) is asked for again.
    await settings.click();
    await page.getByRole('checkbox', { name: 'おすすめ・危険度' }).check();
    await expect(chip).toBeVisible();
    expect((await calls()).filter((c) => /^GET \/api\/games\/[^?]+$/.test(c)).length).toBeGreaterThan(0);
  });
});

test('the advice lists each candidate with its danger against a riichi', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`./?mode=game&seed=${RIICHI_SEED}&length=tonpuu`);
  const hand = handPanel(page);
  await waitForPlayback(page);
  for (let i = 0; i < 3 && (await hand.locator('.tile-danger').count()) === 0; i++) {
    await playOneStep(page);
    await waitForPlayback(page);
  }
  expect(await hand.locator('.tile-danger').count()).toBeGreaterThan(0);
  await page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' }).click();
  const panel = page.getByRole('region', { name: 'アドバイス' });
  const candidates = panel.getByRole('list', { name: 'おすすめの打牌' }).getByRole('listitem');
  await expect(candidates.first()).toBeVisible();
  const n = await candidates.count();
  await expect(panel.locator('.advice-danger')).toHaveCount(n);
  await expect(candidates.first()).toHaveAttribute('aria-label', /、危険度 [安低中危]（手牌で表示）$/);
  await expect(panel.getByText('順位は他家の手（危険度）を考えません')).toBeVisible();
});
