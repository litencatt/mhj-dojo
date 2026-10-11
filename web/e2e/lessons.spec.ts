import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DOJO_NOYAKU_SEED,
  DOJO_WIN_SEED,
  SEED,
  dojoProgress,
  engineSession,
  handPanel,
  onEngineReply,
  playToResult,
  waitForPlayback,
  watchEngine,
} from './helpers';
import { initialProgress, STORAGE_KEY, type DojoProgress } from '../src/dojo/progress.ts';
import { tileName } from '../src/tiles.ts';
import { LESSON_COINS } from '../src/dojo/lessons.ts';

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

const stageOf = (page: Page) => page.getByTestId('lesson-status').locator('.lesson-stage');

const yakuRow = (page: Page, name: string) =>
  page.getByRole('region', { name: '役別向聴テーブル' }).locator('.yaku-table tbody tr', { hasText: name });

// Opens a stage of the curriculum whatever it starts as (clicking its summary would toggle it).
async function openStage(stage: Locator) {
  await stage.evaluate((el) => ((el as HTMLDetailsElement).open = true));
}

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
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'unassisted'); // a lesson without assists has one stage
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

for (const [name, lessons] of [
  ['not open yet', {}],
  ['passed already', { 'shape-win': done, 'ryanmen-tenpai': done, 'riichi-win': done, 'pinfu-win': done }],
] as const) {
  test(`a lesson ${name} deals a game without it`, async ({ page }) => {
    await storeProgress(page, { lessons });
    await page.goto(`./?mode=dojo&play=1&seed=${SEED}&lesson=pinfu-win`);
    await expect(handPanel(page)).toBeVisible();
    await expect(page.getByTestId('lesson-closed')).toBeVisible();
    await expect(page.getByTestId('lesson-status')).toHaveCount(0);
    await expect(yakuRow(page, '平和')).toHaveCount(0);
    await expect.poll(() => savedDojoGame(page)).toMatchObject({ lesson: null });
    expect((await savedDojoGame(page))!.yaku).not.toContain('pinfu');
  });
}

test('a lesson\'s assist is on at its assisted stage, owned or not, and off at the other, owned or not', async ({ page }) => {
  test.setTimeout(90_000);
  // DOJO_NOYAKU_SEED: a closed tenpai at once with no learned yaku's row, which 役なし警告 flags.
  await storeProgress(page, { lessons: { 'shape-win': done } });
  await page.goto(`./?mode=dojo&play=1&seed=${DOJO_NOYAKU_SEED}&lesson=tsumo-win`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'assisted');
  await expect(page.getByTestId('dojo-waits')).toContainText('立直で和了れます'); // not owned, but the lesson's

  const unassisted = await page.context().newPage();
  await unassisted.emulateMedia({ reducedMotion: 'reduce' });
  await unassisted.goto('./?mode=dojo');
  await unassisted.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [STORAGE_KEY, JSON.stringify({ ...initialProgress(), firstGameBonus: true, ownedItems: ['assist:noyaku'], lessons: { 'shape-win': done, 'tsumo-win': { assisted: true, count: 0, done: false, seen: [] } } })],
  );
  await unassisted.goto(`./?mode=dojo&play=1&seed=${DOJO_NOYAKU_SEED}&lesson=tsumo-win`);
  await expect(handPanel(unassisted)).toBeVisible();
  await waitForPlayback(unassisted);
  await expect(stageOf(unassisted)).toHaveAttribute('data-stage', 'unassisted');
  await expect(unassisted.getByTestId('dojo-waits')).toHaveCount(0); // owned, but off for the lesson
});

test('a game lesson is judged as its round ends: passed with the assists, then without', async ({ page }) => {
  test.setTimeout(90_000);
  await storeProgress(page, { lessons: { 'shape-win': done } });
  // DOJO_WIN_SEED: tsumogiri wins the first round by tsumo, 門前清自摸和.
  await page.goto(`./?mode=dojo&play=1&seed=${DOJO_WIN_SEED}&lesson=tsumo-win`);
  await expect(handPanel(page)).toBeVisible();
  const bar = page.getByTestId('lesson-status');
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'assisted');
  await playToResult(page);
  await expect(bar.locator('.lesson-note')).toHaveText('達成！ 次は補助なし');
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'unassisted');
  const key = `game:${new URL(page.url()).searchParams.get('game')}:0`;
  await expect.poll(async () => (await dojoProgress(page))?.lessons['tsumo-win']).toEqual({ assisted: true, count: 0, done: false, seen: [key] });
  // Reloaded on the result: the round, its key seen, is not counted again.
  await page.reload();
  await waitForPlayback(page);
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'unassisted');
  expect((await dojoProgress(page))?.lessons['tsumo-win']).toEqual({ assisted: true, count: 0, done: false, seen: [key] });
  // The next round drops the note.
  await page.getByRole('region', { name: '結果', exact: true }).getByRole('button', { name: '次の局へ' }).click();
  await waitForPlayback(page);
  await expect(bar.locator('.lesson-note')).toHaveCount(0);
});

test('a practice lesson judges each discard and keeps its count in the dojo', async ({ page }) => {
  await storeProgress(page, { lessons: { 'shape-win': done } });
  await page.goto(`./?seed=${SEED}&turns=18&lesson=max-ukeire`);
  await expect(handPanel(page)).toBeVisible();
  const bar = page.getByTestId('lesson-status');
  await expect(bar).toContainText('受け入れの多い方を残す');
  await expect(stageOf(page)).toHaveText('補助あり 0/5');
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'assisted');
  // The assisted stage marks the best discards (有効牌ハイライト).
  const best = handPanel(page).locator('.tile-ukeire-best').first();
  await expect(best).toBeVisible();
  await best.click();
  await expect(stageOf(page)).toHaveText('補助あり 1/5');
  await expect(bar.locator('.lesson-note')).toHaveText('達成！');
  await expect.poll(async () => (await dojoProgress(page))?.lessons['max-ukeire']?.count).toBe(1);
  // A reload keeps the lesson (its URL) and its count.
  await page.reload();
  await expect(stageOf(page)).toHaveText('補助あり 1/5');
});

test('three failures in a row nudge the hint, which opens on demand; the lines stay as tall', async ({ page }) => {
  await storeProgress(page, { lessons: { 'shape-win': done } });
  await page.goto(`./?seed=${SEED}&turns=18&lesson=max-ukeire`);
  await expect(handPanel(page)).toBeVisible();
  const bar = page.getByTestId('lesson-status');
  const height = async () => (await bar.boundingBox())!.height;
  const before = await height();
  const nudge = bar.locator('.lesson-hint-nudge');
  for (let i = 1; i <= 3; i++) {
    await expect(nudge).toHaveCount(0);
    const turn = await page.locator('.game-status').textContent();
    await handPanel(page).locator('.hand-tiles button:not(.tile-ukeire-best)').first().click();
    await expect(page.locator('.game-status')).not.toHaveText(turn!);
  }
  await expect(nudge).toBeVisible();
  expect(await height()).toBe(before);
  await expect(stageOf(page)).toHaveText('補助あり 0/5'); // a failure costs nothing
  await bar.locator('summary').click();
  await expect(bar.locator('.lesson-hint p')).toContainText('有効牌');
});

// Seed 4: discarding the advice's first choice each turn wins by tsumo within the 18 turns.
const SHAPE_WIN_SEED = 4;

test('shape-win: a practice played to a tsumo win passes the lesson and pays it', async ({ page }) => {
  test.setTimeout(60_000);
  await watchEngine(page);
  await storeProgress(page, {});
  await page.goto(`./?seed=${SHAPE_WIN_SEED}&turns=18&lesson=shape-win`);
  await expect(handPanel(page)).toBeVisible();
  const bar = page.getByTestId('lesson-status');
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'unassisted');
  for (let i = 0; i < 18; i++) {
    const st = await engineSession<{ can_tsumo: boolean; advice: { candidates: { tile: string }[] } }>(page);
    if (st.can_tsumo) break;
    const turn = await page.locator('.game-status').textContent();
    await handPanel(page).getByRole('button', { name: tileName(st.advice.candidates[0].tile), exact: true }).last().click();
    await expect(page.locator('.game-status')).not.toHaveText(turn!);
    await expect(bar.locator('.lesson-hint-nudge')).toHaveCount(0); // a discard is not judged
  }
  await page.locator('.tsumo-button').click();
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'done');
  await expect(bar.locator('.lesson-note')).toHaveText(`合格！ ${LESSON_COINS}銭を受け取りました`);
  const p = await dojoProgress(page);
  expect(p?.lessons['shape-win'].done).toBe(true);
  expect(p?.coins).toBe(LESSON_COINS);
});

// ---- The hub's 課程 panel ----

const lessonRow = (page: Page, id: string) => page.getByTestId('dojo-lessons').locator(`[data-lesson="${id}"]`);

test('the hub lists the curriculum by stage, the next lesson marked and opened; a locked one has no start', async ({ page }) => {
  await storeProgress(page, {});
  await page.goto('./?mode=dojo');
  const panel = page.getByTestId('dojo-lessons');
  await expect(panel.getByRole('heading', { name: /課程/ })).toBeVisible();
  const first = lessonRow(page, 'shape-win');
  await expect(first).toHaveAttribute('aria-current', 'step');
  await expect(first).toHaveAttribute('data-state', 'unassisted');
  await expect(first).toContainText('次はこれ');
  await expect(first.getByRole('link', { name: '始める' })).toHaveAttribute('href', /lesson=shape-win/);
  await expect(first.locator('.dojo-lesson-more')).toHaveAttribute('open', '');
  await expect(first.getByRole('group', { name: '例の手' }).locator('.tile')).toHaveCount(14);
  await expect(panel.locator('.dojo-lesson-stage').nth(0)).toHaveAttribute('open', '');
  await expect(panel.locator('.dojo-lesson-stage').nth(1)).not.toHaveAttribute('open', '');
  await expect(panel.locator('[aria-current="step"]')).toHaveCount(1);
  // Locked: no way to start it, and what comes first is named.
  await openStage(panel.locator('.dojo-lesson-stage').nth(1));
  const locked = lessonRow(page, 'ryanmen-tenpai');
  await expect(locked).toHaveAttribute('data-state', 'locked');
  await expect(locked.getByRole('link')).toHaveCount(0);
  await expect(locked.locator('.dojo-lesson-more summary')).toContainText('先に: 和了形を作る');
  // A lesson's yaku has its guide; stage 6 is announced, the 師範戦 locked (master-match.spec.ts).
  await openStage(panel.locator('.dojo-lesson-stage').nth(2));
  await lessonRow(page, 'riichi-win').getByRole('button', { name: '役の解説' }).click();
  await expect(page.getByRole('dialog', { name: '立直' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.locator('.dojo-lesson-later li')).toHaveText([/段6.*準備中/]);
  await expect(page.getByTestId('dojo-master-match')).toHaveAttribute('data-state', 'locked');
});

test('a lesson started from the hub and passed shows so after a reload; its yaku is granted and owned in the shop', async ({ page }) => {
  test.setTimeout(90_000);
  await watchEngine(page);
  // DOJO_WIN_SEED wins the first round by tsumo; the engine's result is given 平和 too, as a win
  // with it would have (no seed of tsumogiri play wins with it).
  onEngineReply(page, (_call, reply) => {
    const r = reply.data?.result;
    if (r && r.winner === reply.data.you && !r.yaku.some((y: { key: string }) => y.key === 'pinfu')) {
      r.yaku.push({ key: 'pinfu', name: '平和', han: 1 });
    }
  });
  await storeProgress(page, { lessons: { 'shape-win': done, 'ryanmen-tenpai': done, 'riichi-win': done } });
  await page.goto(`./?mode=dojo&seed=${DOJO_WIN_SEED}`);
  await openStage(page.getByTestId('dojo-lessons').locator('.dojo-lesson-stage').nth(5));
  const row = lessonRow(page, 'pinfu-win');
  await expect(row).toHaveAttribute('data-state', 'unassisted');
  await row.getByRole('link', { name: '始める' }).click();
  await expect(page).toHaveURL(/lesson=pinfu-win/);
  await expect(handPanel(page)).toBeVisible();
  await playToResult(page);
  const bar = page.getByTestId('lesson-status');
  await expect(stageOf(page)).toHaveAttribute('data-stage', 'done');
  await expect(bar.locator('.lesson-note')).toHaveText('合格！ 平和を授かりました');

  for (const step of ['hub', 'reload']) {
    if (step === 'hub') await page.goto('./?mode=dojo');
    else await page.reload();
    await openStage(page.getByTestId('dojo-lessons').locator('.dojo-lesson-stage').nth(5));
    await expect(row, step).toHaveAttribute('data-state', 'done');
    await expect(row.getByRole('link'), step).toHaveCount(0);
    await expect(row.locator('.shop-owned'), step).toContainText('合格');
    await expect(page.getByTestId('dojo-yaku'), step).toContainText('平和');
    await expect(page.locator('[data-item="pinfu"]'), step).toContainText('所持');
  }
});

test('practice mode offers no lesson without a dojo', async ({ page }) => {
  await page.goto(`./?seed=${SEED}&turns=18&lesson=max-ukeire`);
  await expect(handPanel(page)).toBeVisible();
  await expect(page.getByTestId('lesson-status')).toHaveCount(0);
  expect(await dojoProgress(page)).toBe(null);
});
