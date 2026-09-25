import { expect, test } from '@playwright/test';

// Solo practice mode (the root page): load a fixed seed and discard once,
// checking that both the table (discard river) and the analysis (yaku
// table) update from the server response.
test('practice mode loads and a discard updates the table and analysis', async ({ page }) => {
  await page.goto('/?seed=1&turns=18');

  const handPanel = page.getByRole('region', { name: '手牌' });
  await expect(handPanel).toBeVisible();

  const yakuPanel = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yakuPanel).toBeVisible();
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);

  // 13 hand tiles + 1 drawn tile, nothing discarded yet.
  await expect(handPanel.locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(handPanel.locator('.discard-river')).toHaveCount(0);

  // Capture the analysis before discarding, to prove it actually changes
  // (not just "still has rows") once the new node's analysis comes back.
  const analysisBody = yakuPanel.locator('.yaku-table tbody');
  const analysisBefore = await analysisBody.innerText();

  // Discard the drawn tile: the simplest legal move from any seeded hand.
  const drawn = handPanel.locator('.hand-drawn button');
  await expect(drawn).toBeVisible();
  const drawnTile = await drawn.getAttribute('aria-label');
  expect(drawnTile).toBeTruthy();
  await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/discard')),
    drawn.click(),
  ]);

  // The table now shows one discard in the river, holding that tile.
  await expect(handPanel.locator('.discard-river .tile')).toHaveCount(1);
  await expect(handPanel.locator(`.discard-river [aria-label="${drawnTile}"]`)).toBeVisible();

  // The analysis table is repopulated for the new node, and its content
  // actually changed (a different 13-tile hand has different shanten rows).
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);
  await expect(analysisBody).not.toHaveText(analysisBefore);
});
