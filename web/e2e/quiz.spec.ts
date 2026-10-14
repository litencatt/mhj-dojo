import { expect, test, type Page } from '@playwright/test';
import { PHONE, handPanel, loaded, pageOverflowX } from './helpers';

// The practice problems' page (?mode=quiz, issue #239): a 何切る problem
// from the URL's level and seed, answered from the hand, graded by the
// engine.

// Level 1 on seed 1: the hand's first tile (5萬) is not among the best, so
// answering it is wrong. Problems are generated from the seed
// (internal/problem): should generation change and make it right, pick a
// seed whose first hand tile is still wrong.
const QUIZ_URL = './?mode=quiz&level=1&seed=1';

const result = (page: Page) => page.locator('.quiz-result');
const handTiles = (page: Page) => handPanel(page).locator('button.tile');

/** The tiles named correct by the grading (正解：), as their labels. */
function bestLabels(page: Page) {
  return result(page).locator('.quiz-best .tile').evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label') ?? ''));
}

test('a wrong answer is 不正解, with the best marked in the hand and every choice ranked; the best is 正解', async ({ page }) => {
  await page.goto(QUIZ_URL);
  await loaded(page);
  await expect(page).toHaveTitle('mhj-dojo - 何切る');
  await expect(page.getByRole('heading', { name: '何切る', level: 2 })).toBeVisible();
  await expect(page.getByText('何を切る？')).toBeVisible();
  // The header: 問題 marked among the modes, then the problem's state.
  const modes = page.locator('.app-header h1').getByRole('link');
  await expect(modes).toHaveText(['練習', 'CPU対戦', '道場', '問題']);
  await expect(modes.nth(3)).toHaveAttribute('aria-current', 'page');
  const status = page.locator('.header-status');
  await expect(status.locator('.game-status')).toContainText('1向聴');
  await expect(status.locator('.game-status')).toContainText(/\d+巡目/);
  await expect(status.locator('.game-status')).toContainText('場風');
  await expect(page.getByTestId('quiz-score')).toHaveText('0 / 0');
  await expect(status.locator('.dora-box .tile').first()).toBeVisible();
  // The hand: 13 tiles and the drawn one apart.
  await expect(handPanel(page).locator('.hand-tiles button.tile')).toHaveCount(13);
  await expect(handPanel(page).locator('.hand-drawn button.tile')).toHaveCount(1);
  await expect(result(page)).toHaveCount(0);

  const first = handTiles(page).first();
  const answered = (await first.getAttribute('aria-label'))!;
  await first.click();
  await expect(page.getByRole('heading', { name: '不正解' })).toBeVisible();
  await expect(page.getByTestId('quiz-score')).toHaveText('0 / 1');
  // The answer outlined red, the best raised; the hand takes no more answers.
  await expect(first).toHaveClass(/tile-quiz-wrong/);
  const best = await bestLabels(page);
  expect(best.length).toBeGreaterThan(0);
  expect(best).not.toContain(answered);
  for (const b of best) await expect(handPanel(page).locator(`button.tile[aria-label="${b}、正解"]`).first()).toHaveClass(/tile-advice/);
  await expect(handTiles(page).first()).toHaveAttribute('aria-disabled', 'true');
  // The ranking: best first, the answer's row marked and below rank 1.
  const rows = result(page).locator('.quiz-ranking tbody tr');
  expect(await rows.count()).toBeGreaterThan(2);
  await expect(rows.first()).toContainText('1位');
  await expect(rows.first()).toHaveClass(/quiz-rank-best/);
  const mine = result(page).locator('.quiz-rank-answer');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('あなた');
  await expect(mine).not.toContainText(/^1位/);
  await expect(result(page).locator('.advice-review')).toContainText('守備と打点は考えません');
  await expect(page.getByRole('button', { name: '次の問題' })).toBeFocused();

  // The same URL is the same problem: the best, chosen from the keyboard, is 正解.
  await page.reload();
  await loaded(page);
  await expect(page.getByTestId('quiz-score')).toHaveText('0 / 0');
  const bestTile = handPanel(page).locator(`button.tile[aria-label="${best[0]}"]`).first();
  await bestTile.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '正解', exact: true })).toBeVisible();
  await expect(page.getByTestId('quiz-score')).toHaveText('1 / 1');
  await expect(result(page).locator('.quiz-rank-answer')).toHaveClass(/quiz-rank-best/);
  await expect(result(page).locator('.advice-review-best')).toBeVisible();
  await expect(handPanel(page).locator('.tile-quiz-wrong')).toHaveCount(0);
});

test('次の問題 is the next seed at the same level, and the count goes on', async ({ page }) => {
  await page.goto(QUIZ_URL);
  await loaded(page);
  const before = await handTiles(page).evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')).join());
  await handTiles(page).first().click();
  await expect(result(page)).toBeVisible();
  await page.getByRole('button', { name: '次の問題' }).click();
  await expect(page).toHaveURL(/[?&]seed=2(&|$)/);
  await expect(page).toHaveURL(/[?&]level=1(&|$)/);
  await expect(page).toHaveURL(/[?&]kind=nanikiru(&|$)/);
  await expect(result(page)).toHaveCount(0);
  await expect(handTiles(page).first()).not.toHaveAttribute('aria-disabled', 'true');
  // 次の問題 went with the result: the focus goes on to the new hand.
  await expect(handTiles(page).first()).toBeFocused();
  expect(await handTiles(page).evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')).join())).not.toBe(before);
  await expect(page.getByTestId('quiz-score')).toHaveText('0 / 1');
  await handTiles(page).first().click();
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('quiz-score')).toHaveText(/ \/ 2$/);
});

test('without a seed the engine picks one, and the URL keeps it for a reload', async ({ page }) => {
  await page.goto('./?mode=quiz');
  await loaded(page);
  await expect(page).toHaveURL(/[?&]seed=\d+(&|$)/);
  await expect(page).toHaveURL(/[?&]level=1(&|$)/);
  const seed = new URL(page.url()).searchParams.get('seed');
  const hand = await handTiles(page).evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')).join());
  await page.reload();
  await loaded(page);
  expect(new URL(page.url()).searchParams.get('seed')).toBe(seed);
  expect(await handTiles(page).evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')).join())).toBe(hand);
});

test('a level chosen in 設定 starts its problem at once, on the same seed', async ({ page }) => {
  await page.goto(QUIZ_URL);
  await loaded(page);
  await page.getByRole('button', { name: '設定' }).click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  const levels = dialog.getByRole('group', { name: '難易度' });
  await expect(levels.getByRole('radio')).toHaveCount(3);
  await expect(levels.getByRole('radio', { name: '1向聴' })).toBeChecked();
  // The dialog opens on the first group's choice: the kind.
  await expect(dialog.getByRole('group', { name: '種類' }).getByRole('radio', { name: '何切る' })).toBeFocused();
  await levels.getByRole('radio', { name: '2向聴' }).click(); // the dialog closes and the problem loads; the radio follows once it has come
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/[?&]level=2(&|$)/);
  await expect(page).toHaveURL(/[?&]seed=1(&|$)/);
  await expect(page.locator('.header-status .game-status')).toContainText('2向聴');
  // The problem is a 2-shanten one: its best leaves the hand 2 away.
  await handTiles(page).first().click();
  await expect(result(page).locator('.quiz-ranking tbody tr').first()).toContainText('2向聴');
});

test('an unknown level or seed falls back: level 1, a seed the engine picks', async ({ page }) => {
  await page.goto('./?mode=quiz&level=9&seed=-4');
  await loaded(page);
  await expect(page).toHaveURL(/[?&]level=1(&|$)/);
  await expect(page).toHaveURL(/[?&]seed=\d+(&|$)/);
});

test('the help explains the problems', async ({ page }) => {
  await page.goto(QUIZ_URL);
  await loaded(page);
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ヘルプ' });
  await expect(dialog.getByRole('heading', { name: '問題（何切る・待ち当て・押し引き）', exact: true })).toBeVisible();
  for (const h of ['練習モード', 'CPU対戦', '道場']) await expect(dialog.getByRole('heading', { name: h, exact: true })).toHaveCount(0);
});

test.describe('touch', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('a tap selects a tile and a second tap on it answers', async ({ page }) => {
    await page.goto(QUIZ_URL);
    await loaded(page);
    const tile = handTiles(page).first();
    await tile.tap();
    await expect(tile).toHaveClass(/tile-picked/);
    await expect(result(page)).toHaveCount(0);
    // Another tile only moves the selection.
    const other = handTiles(page).nth(1);
    await other.tap();
    await expect(other).toHaveClass(/tile-picked/);
    await expect(tile).not.toHaveClass(/tile-picked/);
    await expect(result(page)).toHaveCount(0);
    await other.tap();
    await expect(result(page)).toBeVisible();
  });
});

for (const [width, height] of [[320, 640], [PHONE.width, PHONE.height]]) {
  test(`a ${width}px-wide phone fits the problem and its grading without a sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(QUIZ_URL);
    await loaded(page);
    // The hand on one row: the drawn tile level with the hand's tiles.
    const firstBox = (await handTiles(page).first().boundingBox())!;
    const drawnBox = (await handPanel(page).locator('.hand-drawn button.tile').boundingBox())!;
    expect(Math.abs(drawnBox.y - firstBox.y)).toBeLessThan(4);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    // The title row's mode links never run under 設定 and ?.
    const title = (await page.locator('.app-header h1').boundingBox())!;
    const meta = (await page.locator('.header-meta').boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(meta.x);
    await handTiles(page).first().click();
    await expect(result(page)).toBeVisible();
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    const next = page.getByRole('button', { name: '次の問題' });
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    const table = (await result(page).locator('.quiz-ranking').boundingBox())!;
    expect(table.x + table.width).toBeLessThanOrEqual(width);
  });
}

// 待ち当て (machi, #242): the waits picked under the hand, sent by 答える.
// Level 3 is a 清一色 hand: 東 is never among its waits.
const MACHI_URL = './?mode=quiz&kind=machi&level=3&seed=1';
const picker = (page: Page) => page.locator('.quiz-picker');
const pick = (page: Page, label: string) => picker(page).locator(`button.tile[aria-label="${label}"]`);

test('待ち当て: a wait left out is 不正解 with the waits shown; every wait picked is 正解', async ({ page }) => {
  await page.goto(MACHI_URL);
  await loaded(page);
  await expect(page).toHaveTitle('mhj-dojo - 待ち当て');
  await expect(page.getByRole('heading', { name: '待ち当て', level: 2 })).toBeVisible();
  await expect(page.getByText('待ちの牌をすべて選ぶ')).toBeVisible();
  // The hand's shape only: 13 tiles, no drawn tile, no turn, winds or dora; the hand takes no answer.
  await expect(handPanel(page).locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(handPanel(page).locator('.hand-drawn .tile')).toHaveCount(0);
  await expect(page.locator('.header-status .game-status')).toContainText('清一色');
  await expect(page.locator('.header-status .game-status')).not.toContainText('巡目');
  await expect(page.locator('.header-status .dora-box')).toHaveCount(0);
  await expect(handTiles(page).first()).toHaveAttribute('aria-disabled', 'true');
  // The picker: every tile kind; 答える waits for a pick, and a second press takes it out.
  await expect(picker(page).locator('button.tile')).toHaveCount(34);
  const answer = page.getByRole('button', { name: '答える' });
  await expect(answer).toBeDisabled();
  await pick(page, '東').click();
  await expect(pick(page, '東')).toHaveAttribute('aria-pressed', 'true');
  await expect(picker(page)).toContainText('1種を選択');
  await pick(page, '南').click();
  await pick(page, '南').click();
  await expect(pick(page, '南')).toHaveAttribute('aria-pressed', 'false');
  await answer.click();

  await expect(page.getByRole('heading', { name: '不正解' })).toBeVisible();
  await expect(page.getByTestId('quiz-score')).toHaveText('0 / 1');
  const best = await bestLabels(page);
  expect(best.length).toBeGreaterThanOrEqual(3);
  // 東 outlined red; every wait raised and said to be left out; the picker takes no more.
  await expect(picker(page).locator('button.tile[aria-label="東、あなたの答え"]')).toHaveClass(/tile-quiz-wrong/);
  for (const b of best) await expect(pick(page, `${b}、正解、見逃し`)).toHaveClass(/tile-advice/);
  await expect(page.getByRole('button', { name: '答える' })).toHaveCount(0);
  await expect(picker(page).locator('button.tile').first()).toHaveAttribute('aria-disabled', 'true');
  const rows = result(page).locator('.quiz-ranking tbody tr');
  await expect(rows).toHaveCount(best.length);
  await expect(rows.first()).toContainText('見逃し');
  await expect(result(page).locator('.advice-review')).toContainText('待ちは');
  await expect(page.getByRole('button', { name: '次の問題' })).toBeFocused();

  // The same problem again, every wait picked: 正解.
  await page.reload();
  await loaded(page);
  for (const b of best) await pick(page, b).click();
  await page.getByRole('button', { name: '答える' }).click();
  await expect(page.getByRole('heading', { name: '正解', exact: true })).toBeVisible();
  for (const b of best) await expect(pick(page, `${b}、正解、あなたの答え`)).toHaveClass(/tile-advice/);
  await expect(result(page).locator('.quiz-rank-answer')).toHaveCount(best.length);
  await expect(result(page).locator('.quiz-ranking')).not.toContainText('見逃し');
  // 次の問題: a fresh picker, its first tile focused.
  await page.getByRole('button', { name: '次の問題' }).click();
  await expect(page).toHaveURL(/[?&]seed=2(&|$)/);
  await expect(picker(page).locator('button.tile').first()).toBeFocused();
  await expect(picker(page).locator('button.tile[aria-pressed="true"]')).toHaveCount(0);
});

test('the kind chosen in 設定 starts its problem at once, at its first level, on the same seed', async ({ page }) => {
  await page.goto(QUIZ_URL);
  await loaded(page);
  await page.getByRole('button', { name: '設定' }).click();
  const dialog = page.getByRole('dialog', { name: '設定' });
  await dialog.getByRole('group', { name: '種類' }).getByRole('radio', { name: '待ち当て' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/[?&]kind=machi(&|$)/);
  await expect(page).toHaveURL(/[?&]level=1(&|$)/);
  await expect(page).toHaveURL(/[?&]seed=1(&|$)/);
  await expect(page.getByRole('heading', { name: '待ち当て', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: '設定' }).click();
  await expect(dialog.getByRole('group', { name: '難易度' }).getByRole('radio', { name: '基本形' })).toBeChecked();
});

for (const [width, height] of [[320, 640], [PHONE.width, PHONE.height]]) {
  test(`待ち当て: a ${width}px-wide phone fits the picker and its grading without a sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(MACHI_URL);
    await loaded(page);
    // A suit's nine on one row.
    const row = picker(page).locator('.quiz-picker-row').first().locator('.tile');
    const y0 = (await row.first().boundingBox())!.y;
    expect(Math.abs((await row.last().boundingBox())!.y - y0)).toBeLessThan(2);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
    await pick(page, '東').click();
    await page.getByRole('button', { name: '答える' }).click();
    await expect(result(page)).toBeVisible();
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  });
}

// 押し引き (oshihiki, #241): the other seats' rivers with a riichi, answered
// from the hand like 何切る, graded by danger.
const OSHIHIKI_URL = './?mode=quiz&kind=oshihiki&level=1&seed=1';

test('押し引き: the rivers and the riichi are shown; the safest tile is 正解 with its reason, a dangerous one is not', async ({ page }) => {
  await page.goto(OSHIHIKI_URL);
  await loaded(page);
  await expect(page).toHaveTitle('mhj-dojo - 押し引き');
  await expect(page.getByText('リーチに対して、いちばん安全な牌は？')).toBeVisible();
  await expect(page.locator('.header-status .game-status')).toContainText('現物あり');
  const table = page.getByRole('group', { name: '他家の河' });
  await expect(table.locator('.quiz-seat')).toHaveCount(3);
  await expect(table.locator('.quiz-seat-name')).toHaveText([/^下家/, /^対面/, /^上家/]);
  await expect(table.getByText('リーチ', { exact: true })).toHaveCount(1);
  await expect(table.locator('.river-riichi')).toHaveCount(1);
  await expect(handPanel(page).locator('.hand-drawn button.tile')).toHaveCount(1);

  // The last tile of the hand first: graded, then the safest from the ranking.
  await handTiles(page).last().click();
  await expect(result(page)).toBeVisible();
  const rows = result(page).locator('.quiz-ranking tbody tr');
  await expect(rows.first()).toContainText('1位');
  await expect(rows.first()).toContainText(/現物|リーチ後に通った牌/);
  await expect(rows.first().locator('td').last()).toHaveText('0');
  await expect(result(page).locator('.advice-review')).toContainText('押すか降りるか');
  const best = await bestLabels(page);
  await page.reload();
  await loaded(page);
  await handPanel(page).locator(`button.tile[aria-label="${best[0]}"]`).first().click();
  await expect(page.getByRole('heading', { name: '正解', exact: true })).toBeVisible();
  await expect(result(page).locator('.quiz-rank-answer')).toHaveClass(/quiz-rank-best/);
  // A dangerous tile: the last row of the ranking.
  await page.getByRole('button', { name: '次の問題' }).click();
  await expect(result(page)).toHaveCount(0);
  await handTiles(page).first().click();
  await expect(result(page)).toBeVisible();
  const last = result(page).locator('.quiz-ranking tbody tr').last();
  await expect(last.locator('td').last()).not.toHaveText('0');
});

test('押し引き: a 320px-wide phone fits the rivers and the grading without a sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  // Two riichi: the longest reasons (per seat).
  await page.goto('./?mode=quiz&kind=oshihiki&level=3&seed=5');
  await loaded(page);
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  await handTiles(page).first().click();
  await expect(result(page)).toBeVisible();
  await expect(result(page).locator('.quiz-reason').first()).toContainText('、');
  expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  const table = (await result(page).locator('.quiz-ranking').boundingBox())!;
  expect(table.x + table.width).toBeLessThanOrEqual(320);
});
