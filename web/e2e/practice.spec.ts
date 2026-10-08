import { expect, test, type Page } from '@playwright/test';
import { PHONE, discardDrawn, discardsSent, engineCalls, expectStopped, handPanel, labels, openSettings, savedMoves, stoppedDialog } from './helpers';

// Solo practice mode (the root page).

// Load a fixed seed and discard once, checking that both the table (discard
// river) and the analysis (yaku table) update from the engine's answer.
test('practice mode loads and a discard updates the table and analysis', async ({ page }) => {
  const calls = await engineCalls(page);
  await page.goto('./?seed=1&turns=18');

  const hand = handPanel(page);
  await expect(hand).toBeVisible();

  const yakuPanel = page.getByRole('region', { name: '役別向聴テーブル' });
  await expect(yakuPanel).toBeVisible();
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);
  // The 複合役 section lists up to five yaku combinations, named with ＋.
  const comboRows = yakuPanel.locator('.combo-table tbody tr');
  await expect(comboRows).not.toHaveCount(0);
  expect(await comboRows.count()).toBeLessThanOrEqual(5);
  await expect(comboRows.first().locator('th')).toContainText('＋');

  // 13 hand tiles + 1 drawn tile, nothing discarded yet.
  await expect(hand.locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(hand.locator('.discard-river')).toHaveCount(0);

  // Capture the analysis before discarding, to prove it actually changes
  // (not just "still has rows") once the new node's analysis comes back.
  const analysisBody = yakuPanel.locator('.yaku-table tbody');
  const analysisBefore = await analysisBody.innerText();

  // Discard the drawn tile: the simplest legal move from any seeded hand.
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeVisible();
  const drawnTile = await drawn.getAttribute('aria-label');
  expect(drawnTile).toBeTruthy();
  await drawn.click();

  // The table now shows one discard in the river, holding that tile, from
  // the one discard sent.
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  expect(await discardsSent(calls)).toBe(1);
  await expect(hand.locator(`.discard-river [aria-label="${drawnTile}"]`)).toBeVisible();

  // The analysis table is repopulated for the new node, and its content
  // actually changed (a different 13-tile hand has different shanten rows).
  await expect(yakuPanel.locator('.yaku-table tbody tr')).not.toHaveCount(0);
  await expect(analysisBody).not.toHaveText(analysisBefore);
});

test('a second tab on the same session stops the first, until taken back', async ({ page, context }) => {
  const calls = await engineCalls(page);
  await page.goto('./?seed=21&turns=18');
  await discardDrawn(page);
  await expect(page).toHaveURL(/[?&]session=/);
  const other = await context.newPage();
  await other.goto(page.url());
  const handA = handPanel(page);
  await expect(handPanel(other).locator('.discard-river .tile')).toHaveCount(1);

  // A stops: the dialog covers it, and it asks its engine nothing more.
  await expectStopped(page);
  await expect(stoppedDialog(other)).toHaveCount(0);
  await calls();

  // B plays on, and saves.
  await discardDrawn(other);
  await discardDrawn(other);
  expect(await calls()).toEqual([]);
  await expect.poll(() => savedMoves(other)).toBe(3);

  // A takes it back, from where B left it; now B stops.
  await stoppedDialog(page).getByRole('button', { name: 'このタブで続ける' }).click();
  await expect(stoppedDialog(page)).toHaveCount(0);
  await expect(handA.locator('.discard-river .tile')).toHaveCount(3);
  expect(await labels(page, '.discard-river')).toEqual(await labels(other, '.discard-river'));
  expect(await labels(page, '.hand-tiles')).toEqual(await labels(other, '.hand-tiles'));
  await expectStopped(other);
  await discardDrawn(page);
  await expect.poll(() => savedMoves(page)).toBe(4);
  await expect(page.locator('.error-banner')).toHaveCount(0);

  // 閉じる: a tab the page did not open stays open, with a hint.
  await stoppedDialog(other).getByRole('button', { name: '閉じる' }).click();
  await expect(stoppedDialog(other)).toContainText('このタブはそのまま閉じてかまいません');
  expect(other.isClosed()).toBe(false);
});

test('tabs on different sessions both play, and a new session lets go of the one before', async ({
  page,
  context,
}) => {
  await page.goto('./?seed=31&turns=18');
  await expect(page).toHaveURL(/[?&]session=/);
  const first = page.url();
  const settings = await openSettings(page);
  await settings.getByRole('spinbutton', { name: 'シード' }).fill('32');
  await settings.getByRole('button', { name: '新しい練習' }).click();
  await expect(page).not.toHaveURL(first);
  await expect(page).toHaveURL(/[?&]seed=32(&|$)/);

  const other = await context.newPage();
  await other.goto(first);
  await discardDrawn(other);
  await discardDrawn(page);
  await discardDrawn(other);
  for (const p of [page, other]) {
    await expect(stoppedDialog(p)).toHaveCount(0);
    await expect(p.locator('.error-banner')).toHaveCount(0);
  }
});

// The 面子表示 toggle regroups the hand under labelled brackets without
// asking the engine, keeps every tile, restores the plain order when turned
// off, and is remembered across a reload.
test('hand groups toggle: brackets, the same tiles, restore and reload', async ({ page }) => {
  const calls = await engineCalls(page);
  await page.goto('./?seed=1&turns=18');
  const hand = handPanel(page);
  const tiles = hand.locator('.hand-tiles .tile');
  await expect(tiles).toHaveCount(13);
  const toggle = hand.getByRole('button', { name: '面子表示' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false'); // off by default
  const tileLabels = () => tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const plain = await tileLabels();

  await calls();
  await toggle.click();
  const groups = hand.locator('.hand-group');
  await expect(groups.first()).toBeVisible();
  await expect(tiles).toHaveCount(13);
  expect([...(await tileLabels())].sort()).toEqual([...plain].sort());
  const names = await hand.locator('.hand-group-label').allInnerTexts();
  expect(names.length).toBe(await groups.count());
  for (const n of names) expect(['順子', '刻子', '雀頭', '両面', '嵌張', '辺張', '対子', '浮き']).toContain(n);
  expect(await calls(), 'the toggle asks the engine nothing').toEqual([]);

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(groups.first()).toBeVisible();

  await toggle.click();
  await expect(groups).toHaveCount(0);
  expect(await tileLabels()).toEqual(plain);
});

// The advice panel starts minimized in the right-edge dock (so the answer
// isn't shown before the player has thought), opens from its dock tab, lists
// three candidates, highlights a hovered candidate in the hand, stays open
// across a reload, minimizes back to the dock, and after a discard reviews it
// against the best one.
test('advice panel: docked by default, three candidates, remembered, review after a discard', async ({ page }) => {
  await page.goto('./?seed=1&turns=18');
  const panel = page.getByRole('region', { name: 'アドバイス' });
  const dockTab = page.getByRole('navigation', { name: '最小化したパネル' }).getByRole('button', { name: 'アドバイス' });
  await expect(panel).toBeHidden();
  await expect(dockTab).toBeVisible();
  const candidates = panel.locator('.advice-candidate');

  await dockTab.click();
  await expect(panel).toBeVisible();
  await expect(dockTab).toBeHidden();
  await expect(candidates).toHaveCount(3);
  await expect(panel.locator('.advice-outlook')).toContainText('1巡目');

  // Hovering a candidate marks that tile in the hand.
  const best = await candidates.first().locator('.tile').getAttribute('aria-label');
  expect(best).toBeTruthy();
  await candidates.first().hover();
  const hand = handPanel(page);
  await expect(hand.locator('.tile-advice').first()).toHaveAttribute('aria-label', best!);

  await page.reload();
  await expect(panel).toBeVisible();
  await expect(candidates).toHaveCount(3);

  // Discard the recommended tile: the next node reviews it as the best.
  const tile = hand.locator(`.hand-tiles [aria-label="${best}"], .hand-drawn [aria-label="${best}"]`).first();
  await tile.click();
  await expect(hand.locator('.discard-river .tile')).toHaveCount(1);
  await expect(panel.locator('.advice-review')).toHaveText(/^前巡の打 .+: 最善/);
  await expect(candidates).toHaveCount(3);

  // The – button sends it back to the dock.
  await panel.getByRole('button', { name: 'アドバイスを最小化' }).click();
  await expect(panel).toBeHidden();
  await expect(dockTab).toBeVisible();
});

test('hand groups fit a 390px-wide viewport', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('./?seed=1&turns=18');
  const hand = handPanel(page);
  await hand.getByRole('button', { name: '面子表示' }).click();
  await expect(hand.locator('.hand-group').first()).toBeVisible();
  await expect(hand.locator('.hand-tiles .tile')).toHaveCount(13);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

/** Opens practice mode with every panel open (the layout is kept in localStorage; a reload keeps its own). */
async function openAllPanels(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-minimized')) return;
    localStorage.setItem('mhj-dojo.minimized.v2', '[]');
    sessionStorage.setItem('e2e-minimized', '1');
  });
  await page.goto('./?seed=1&turns=18');
  await expect(page.getByRole('region', { name: '時系列チャート' })).toBeVisible();
}

// The panels are memoized, so their – buttons keep the callback of an
// earlier render: each must still act on the latest set of minimized panels
// (a stale one would bring back a panel minimized since).
test('minimize and restore: each panel goes to the dock and back, the others stay put', async ({ page }) => {
  await openAllPanels(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  const panels = [
    { region: '時系列チャート', button: '時系列チャートを最小化', tab: '時系列チャート' },
    { region: '履歴ツリー', button: '履歴ツリーを最小化', tab: '履歴ツリー' },
    { region: '役別向聴テーブル', button: '役別向聴を最小化', tab: '役別向聴' },
    { region: 'アドバイス', button: 'アドバイスを最小化', tab: 'アドバイス' },
    { region: '用語表', button: '用語表を最小化', tab: '用語表' },
  ];
  await expect(dock).toHaveCount(0);

  // One at a time, with a new node (new data for the panels) in between.
  for (const [i, p] of panels.entries()) {
    await page.getByRole('region', { name: p.region }).getByRole('button', { name: p.button }).click();
    await expect(page.getByRole('region', { name: p.region })).toBeHidden();
    await expect(dock.getByRole('button')).toHaveText(panels.slice(0, i + 1).map((q) => new RegExp(q.tab)));
    if (i < 2) await discardDrawn(page);
  }
  // A minimized panel draws nothing, but its place is kept.
  await expect(page.locator('.area-chart')).toBeAttached();
  await expect(page.locator('.area-chart > *')).toHaveCount(0);

  // Back from the dock in another order, each leaving the rest docked.
  for (const [i, p] of [...panels].reverse().entries()) {
    await dock.getByRole('button', { name: p.tab }).click();
    await expect(page.getByRole('region', { name: p.region })).toBeVisible();
    await expect(dock.getByRole('button')).toHaveCount(panels.length - i - 1);
  }
  await expect(page.locator('.yaku-table tbody tr')).not.toHaveCount(0);

  // Two in one go (before the page renders again), and then the layout survives a reload.
  await page.evaluate(() => {
    for (const name of ['時系列チャートを最小化', '用語表を最小化']) {
      document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click();
    }
  });
  await expect(dock.getByRole('button')).toHaveText([/時系列チャート/, /用語表/]);
  await page.reload();
  await expect(page.getByRole('region', { name: '履歴ツリー' })).toBeVisible();
  await expect(dock.getByRole('button')).toHaveText([/時系列チャート/, /用語表/]);
});

// A minimized panel stays mounted: its own state (the chart's legend, the
// glossary's search) is there again when it comes back, even after new data
// arrived while it was in the dock, which it then shows.
test('minimize and restore keep the chart legend and the glossary search', async ({ page }) => {
  await openAllPanels(page);
  const dock = page.getByRole('navigation', { name: '最小化したパネル' });
  const chart = page.getByRole('region', { name: '時系列チャート' });
  const glossary = page.getByRole('region', { name: '用語表' });

  const legend = chart.locator('.legend-item');
  const off = chart.locator('.legend-item[aria-pressed="false"]').first();
  const name = (await off.textContent())!;
  await off.click();
  const item = legend.filter({ hasText: name });
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  const onBefore = await chart.locator('.legend-item[aria-pressed="true"]').count();
  const search = glossary.getByRole('searchbox', { name: '用語を検索' });
  await search.fill('リャンメン');
  await expect(glossary.locator('.glossary-item')).toHaveCount(1);

  await chart.getByRole('button', { name: '時系列チャートを最小化' }).click();
  await glossary.getByRole('button', { name: '用語表を最小化' }).click();
  await expect(chart).toBeHidden();
  await expect(glossary).toBeHidden();
  await discardDrawn(page);
  await expect(handPanel(page).locator('.discard-river .tile')).toHaveCount(1);

  await dock.getByRole('button', { name: '時系列チャート' }).click();
  await dock.getByRole('button', { name: '用語表' }).click();
  await expect(item).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('.legend-item[aria-pressed="true"]')).toHaveCount(onBefore);
  // The chart shows the node discarded to while it was docked: two turns.
  await expect(chart.locator('.chart-axis-label[text-anchor="middle"]')).toHaveCount(2);
  await expect(search).toHaveValue('リャンメン');
  await expect(glossary.locator('.glossary-item')).toHaveCount(1);
});

// On a wider screen the yaku filter bar starts open; 絞り込み folds it away
// but for the count (mobile.spec.ts has the phone's side).
test('the yaku filter bar starts open on a desktop and folds away', async ({ page }) => {
  await page.goto('./?seed=1&turns=18');
  const yaku = page.getByRole('region', { name: '役別向聴テーブル' });
  const toggle = yaku.getByRole('button', { name: '絞り込み', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(yaku.getByRole('searchbox', { name: '役名で検索' })).toBeVisible();
  await expect(yaku.getByRole('combobox')).toHaveCount(2);
  await expect(yaku.getByRole('button', { name: '役満' })).toBeVisible();
  const height = (await yaku.locator('.yaku-filter').boundingBox())!.height;

  await yaku.getByRole('searchbox', { name: '役名で検索' }).fill('ピンフ');
  await expect(yaku.locator('.yaku-filter-count')).toHaveText(/^1 \/ \d+役を表示中$/);
  // 条件をクリア joins the count's row: the bar is no taller.
  await expect(yaku.getByRole('button', { name: '条件をクリア' })).toBeVisible();
  expect(Math.abs((await yaku.locator('.yaku-filter').boundingBox())!.height - height)).toBeLessThanOrEqual(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(yaku.getByRole('searchbox')).toHaveCount(0);
  await expect(yaku.getByRole('button', { name: '役満' })).toHaveCount(0);
  // Folding keeps the search: one row, and the count and 条件をクリア say so.
  await expect(yaku.locator('.yaku-filter-count')).toHaveText(/^1 \/ \d+役を表示中$/);
  await expect(yaku.getByRole('button', { name: '条件をクリア' })).toBeVisible();
  // 条件をクリア from the keyboard goes away and leaves focus on 絞り込み.
  await yaku.getByRole('button', { name: '条件をクリア' }).focus();
  await page.keyboard.press('Enter');
  await expect(yaku.getByRole('button', { name: '条件をクリア' })).toHaveCount(0);
  await expect(toggle).toBeFocused();
});
