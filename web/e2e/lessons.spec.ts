import { expect, test, type Page } from '@playwright/test';
import { DOJO_WIN_SEED, SEED, dojoProgress, handPanel, playToResult, waitForPlayback } from './helpers';
import { initialProgress, STORAGE_KEY, type DojoProgress } from '../src/dojo/progress.ts';

// The curriculum's lessons played (dojo/lessons.ts): a game lesson in a dojo
// game (?mode=dojo&play=1&lesson=), a practice lesson in practice mode
// (?seed=&lesson=), each judged as it goes and kept in the dojo's progress.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const done = { assisted: true, count: 0, done: true, seen: [] };

/** Stores a progress before the page loads, unless one is stored already (a reload keeps the page's). */
async function storeProgress(page: Page, p: Partial<DojoProgress>) {
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify({ ...initialProgress(), firstGameBonus: true, ...p })],
  );
}

/** The saved dojo game of the URL: its lesson and the yaku the engine counts in it. */
function savedDojoGame(page: Page) {
  return page.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.dojo-games') ?? 'null') as {
      games: Record<string, { save: string; lesson?: string }>;
    } | null;
    const g = s?.games[id!];
    return g && { lesson: g.lesson ?? null, yaku: (JSON.parse(g.save) as { dojo: { yaku: string[] } }).dojo.yaku };
  }, new URL(page.url()).searchParams.get('game'));
}

const yakuRow = (page: Page, name: string) =>
  page.getByRole('region', { name: '役別向聴テーブル' }).locator('.yaku-table tbody tr', { hasText: name });

test('a lesson\'s yaku count in its game only, a resumed one included; its game has no automations', async ({ page }) => {
  test.setTimeout(90_000);
  // 平和 not owned, its lesson open; 自動和了 owned.
  await storeProgress(page, {
    ownedItems: ['assist:autowin'],
    lessons: { 'shape-win': done, 'ryanmen-tenpai': done, 'riichi-win': done },
  });
  await page.goto(`./?mode=dojo&play=1&seed=${SEED}&lesson=pinfu-win`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  const bar = page.getByTestId('lesson-status');
  await expect(bar).toContainText('平和で和了する');
  await expect(bar).toContainText('補助なし'); // a lesson without assists has one stage
  await expect(yakuRow(page, '平和')).toHaveCount(1);
  await expect(page.getByRole('group', { name: '自動' })).toHaveCount(0);
  await expect.poll(() => savedDojoGame(page)).toMatchObject({ lesson: 'pinfu-win' });
  expect((await savedDojoGame(page))!.yaku).toContain('pinfu');

  // Resumed: the same game, the same lesson and yaku.
  const id = new URL(page.url()).searchParams.get('game');
  await page.goto(`./?mode=dojo&game=${id}`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(bar).toContainText('平和で和了する');
  await expect(yakuRow(page, '平和')).toHaveCount(1);
  await expect(page.getByRole('group', { name: '自動' })).toHaveCount(0);

  // A game of the hub's: no lesson, no 平和, the automations back.
  await page.goto(`./?mode=dojo&play=1&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(page).not.toHaveURL(new RegExp(`game=${id}`));
  await expect(bar).toHaveCount(0);
  await expect(yakuRow(page, '平和')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '自動' })).toBeVisible();
  const plain = await savedDojoGame(page);
  expect(plain!.lesson).toBe(null);
  expect(plain!.yaku).not.toContain('pinfu');
});

test('a lesson not open yet deals a game without it', async ({ page }) => {
  await storeProgress(page, {});
  await page.goto(`./?mode=dojo&play=1&seed=${SEED}&lesson=pinfu-win`);
  await expect(handPanel(page)).toBeVisible();
  await expect(page.getByTestId('lesson-closed')).toBeVisible();
  await expect(page.getByTestId('lesson-status')).toHaveCount(0);
  await expect(yakuRow(page, '平和')).toHaveCount(0);
});

test('a game lesson is judged as its round ends: passed with the assists, then without', async ({ page }) => {
  test.setTimeout(90_000);
  await storeProgress(page, { lessons: { 'shape-win': done } });
  // DOJO_WIN_SEED: tsumogiri wins the first round by tsumo, 門前清自摸和.
  await page.goto(`./?mode=dojo&play=1&seed=${DOJO_WIN_SEED}&lesson=tsumo-win`);
  await expect(handPanel(page)).toBeVisible();
  const bar = page.getByTestId('lesson-status');
  await expect(bar).toContainText('補助あり');
  await playToResult(page);
  await expect(bar).toContainText('補助ありで達成！ 次は補助なしで');
  await expect(bar).toContainText('補助なし');
  await expect.poll(async () => (await dojoProgress(page))?.lessons['tsumo-win']).toMatchObject({ assisted: true, count: 0, done: false });
  // Reloaded on the result: the round is not counted again.
  await page.reload();
  await waitForPlayback(page);
  await expect(bar).toContainText('補助なし');
  expect((await dojoProgress(page))?.lessons['tsumo-win'].assisted).toBe(true);
});

test('a practice lesson judges each discard and keeps its count in the dojo', async ({ page }) => {
  await storeProgress(page, { lessons: { 'shape-win': done } });
  await page.goto(`./?seed=${SEED}&turns=18&lesson=max-ukeire`);
  await expect(handPanel(page)).toBeVisible();
  const bar = page.getByTestId('lesson-status');
  await expect(bar).toContainText('受け入れの多い方を残す');
  await expect(bar).toContainText('補助あり 0/5');
  // The assisted stage marks the best discards (有効牌ハイライト).
  const best = handPanel(page).locator('.tile-ukeire-best').first();
  await expect(best).toBeVisible();
  await best.click();
  await expect(bar).toContainText('補助あり 1/5');
  await expect(bar).toContainText('達成！');
  await expect.poll(async () => (await dojoProgress(page))?.lessons['max-ukeire']?.count).toBe(1);
  // A reload keeps the lesson (its URL) and its count.
  await page.reload();
  await expect(bar).toContainText('補助あり 1/5');
});

test('practice mode offers no lesson without a dojo', async ({ page }) => {
  await page.goto(`./?seed=${SEED}&turns=18&lesson=max-ukeire`);
  await expect(handPanel(page)).toBeVisible();
  await expect(page.getByTestId('lesson-status')).toHaveCount(0);
  expect(await dojoProgress(page)).toBe(null);
});
