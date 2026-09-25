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

  // Discard the drawn tile: the simplest legal move from any seeded hand.
  const drawn = handPanel.locator('.hand-drawn button');
  await expect(drawn).toBeVisible();
  const drawnTile = await drawn.getAttribute('aria-label');
  expect(drawnTile).toBeTruthy();
  await drawn.click();

  // The table now shows one discard in the river, holding that tile.
  await expect(handPanel.locator('.discard-river .tile')).toHaveCount(1);
  await expect(handPanel.locator(`.discard-river [aria-label="${drawnTile}"]`)).toBeVisible();

  // The analysis table is still populated, for the new node.
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);
});
