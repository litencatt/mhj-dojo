import { expect, test, type Page } from '@playwright/test';
import { PHONE, versionPattern } from './helpers';

// The header's version and the help dialog, in both modes.

async function openHelp(page: Page) {
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('practice: the header shows the version and the help opens, closes and links to the glossary', async ({ page }) => {
  await page.goto('./?seed=1&turns=18');
  await expect(page.locator('.app-header .version-tag')).toHaveText(versionPattern());
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();

  const helpButton = page.getByRole('button', { name: 'ヘルプ', exact: true });
  let dialog = await openHelp(page);
  for (const h of [
    'このアプリについて',
    '画面の用語',
    '練習モード',
    '役別向聴の表の見方',
    '面子表示',
    '牌の表記',
    '保存',
    'バージョン表示',
    'ライセンス',
  ]) {
    await expect(dialog.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
  // Each mode explains itself only: practice's help has no CPU対戦 or 道場 section.
  for (const h of ['CPU対戦', '道場']) await expect(dialog.getByRole('heading', { name: h, exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('row', { name: /1筒〜9筒/ })).toContainText('筒子（ピンズ）');
  // The app's own terms are here, not in the glossary.
  await expect(dialog.getByRole('term').filter({ hasText: /^シード$/ })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /東・南・西・北・白・發・中/ })).toContainText('字牌');

  // Esc closes it and focus goes back to the button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(helpButton).toBeFocused();

  // So does the close button.
  dialog = await openHelp(page);
  await dialog.getByRole('button', { name: 'ヘルプを閉じる' }).click();
  await expect(dialog).toBeHidden();

  // The 用語表 link brings the glossary back from the dock (where it starts).
  const glossary = page.getByRole('region', { name: '用語表' });
  await expect(glossary).toBeHidden();
  dialog = await openHelp(page);
  await dialog.getByRole('button', { name: '用語表', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(glossary).toBeVisible();
  await expect(glossary.getByRole('searchbox', { name: '用語を検索' })).toBeFocused();
  // The glossary holds mahjong terms only: the app's (シード etc.) are in the help.
  await glossary.getByRole('searchbox', { name: '用語を検索' }).fill('シード');
  await expect(glossary).toContainText('該当する用語がありません');
  await glossary.getByRole('searchbox', { name: '用語を検索' }).fill('向聴');
  await expect(glossary).not.toContainText('該当する用語がありません');
});

test('a click on the backdrop closes the help, a drag that ends there does not', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();

  // Selecting text inside and letting go over the backdrop.
  const dialog = await openHelp(page);
  const text = await dialog.getByText('日本式リーチ麻雀の練習アプリです', { exact: false }).boundingBox();
  expect(text).not.toBeNull();
  await page.mouse.move(text!.x + 5, text!.y + text!.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, 10, { steps: 5 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();

  // A plain click outside it.
  await page.mouse.click(10, 10);
  await expect(dialog).toBeHidden();
});

test('game mode: the header shows the version, and the help links to the glossary', async ({ page }) => {
  await page.goto('./?mode=game&seed=1');
  await expect(page.locator('.app-header .version-tag')).toHaveText(versionPattern());
  // The game is dealt (the engine takes a moment to load) before the help opens.
  await expect(page.getByRole('region', { name: '手牌' })).toBeVisible();
  // The glossary starts in the dock.
  const glossary = page.getByRole('region', { name: '用語表' });
  await expect(glossary).toBeHidden();

  const dialog = await openHelp(page);
  await expect(dialog.getByRole('heading', { name: 'CPU対戦', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '練習モード', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '用語表', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(glossary).toBeVisible();
  await expect(glossary.getByRole('searchbox', { name: '用語を検索' })).toBeFocused();
});

// A phone game has no glossary: the help points to practice mode's instead.
test('game mode on a phone: the help points to the glossary in practice mode', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./?mode=game&seed=1');
  const dialog = await openHelp(page);
  await expect(dialog.getByRole('button', { name: '用語表', exact: true })).toHaveCount(0);
  await expect(dialog.locator('.help-lead')).toContainText('麻雀の用語は練習モードの用語表で調べられます。');
});

test('the help fits a phone screen and scrolls', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./?seed=1&turns=18');
  const dialog = await openHelp(page);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // Its bottom edge is on screen, and the content scrolls inside it.
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(await dialog.evaluate((d) => d.scrollHeight > d.clientHeight)).toBe(true);
  const last = dialog.getByRole('heading', { name: 'ライセンス', exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  // The close button stays reachable at the top.
  await expect(dialog.getByRole('button', { name: 'ヘルプを閉じる' })).toBeInViewport();
  // The page behind scrolls no wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('the dojo hub has the same header, and its help explains the dojo', async ({ page }) => {
  await page.goto('./?mode=dojo');
  await expect(page.locator('.app-header .version-tag')).toHaveText(versionPattern());
  await expect(page.locator('.app-header').getByRole('button', { name: '設定', exact: true })).toBeVisible();
  const dialog = await openHelp(page);
  await expect(dialog.getByRole('heading', { name: '道場', exact: true })).toBeVisible();
  for (const h of ['練習モード', 'CPU対戦']) await expect(dialog.getByRole('heading', { name: h, exact: true })).toHaveCount(0);
  // No glossary on the hub: the help points to practice mode's.
  await expect(dialog.locator('.help-lead')).toContainText('練習モードの用語表');
});
