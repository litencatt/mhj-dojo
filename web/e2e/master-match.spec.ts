import { expect, test, type Page } from '@playwright/test';
import { SEED, dojoProgress, finishDojoGame, handPanel, onEngineReply, openSettings, waitForPlayback, watchEngine } from './helpers';
import { LESSONS } from '../src/dojo/lessons.ts';
import { initialProgress, STORAGE_KEY, xpForLevel, type DojoProgress } from '../src/dojo/progress.ts';

// The 師範戦 and the 裏道場 (#323): the 師範戦 opens once the curriculum is
// passed (whatever the level), plays three masters without any cheat, and its win
// opens the 裏道場, whose games play three urashihan with the cheats. The
// 表道場's games and CPU games never play either.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

const done = { assisted: true, count: 0, done: true, seen: [] };

/** Every lesson of the curriculum passed (at 6級: the level plays no part). */
const GRADUATED: Partial<DojoProgress> = {
  xp: xpForLevel(5),
  lessons: Object.fromEntries(LESSONS.map((l) => [l.id, done])),
};

/** Stores a progress before the page loads, unless one is stored already (a reload keeps the page's). */
async function storeProgress(page: Page, p: Partial<DojoProgress>) {
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify({ ...initialProgress(), firstGameBonus: true, ...p })],
  );
}

const cpuName = (page: Page) => page.locator('.game-status div', { hasText: 'CPU' }).locator('dd');
const masterRow = (page: Page) => page.getByTestId('dojo-master-match');

/** The page's saved dojo game (the URL's): its save as the engine wrote it. */
function savedGame(page: Page) {
  return page.evaluate((id) => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.dojo-games') ?? 'null') as { games: Record<string, { save: string }> } | null;
    const g = s?.games[id!];
    return g ? (JSON.parse(g.save) as { seed: number; cpu: string; dojo: Record<string, unknown> }) : null;
  }, new URL(page.url()).searchParams.get('game'));
}

test('the 師範戦 opens with the curriculum passed, and plays three masters without any cheat', async ({ page }) => {
  // Cheats bought before the 裏道場 work in the 表道場's games, but not in the 師範戦.
  await storeProgress(page, { ...GRADUATED, ownedItems: ['cheat:peek', 'cheat:redraw'], legacyCheats: ['cheat:peek', 'cheat:redraw'], coins: 200 });
  await page.goto(`./?mode=dojo&seed=${SEED}`);
  await expect(masterRow(page)).toHaveAttribute('data-state', 'open');
  await expect(masterRow(page)).toContainText('挑戦 0回・勝利 0回');
  await masterRow(page).getByRole('link', { name: '師範戦に挑戦する' }).click();
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(cpuName(page)).toHaveText('師範');
  await expect(page.locator('.game-status')).toContainText('半荘戦');
  // A reload deals it again as the 師範戦 should its save be gone.
  await expect(page).toHaveURL(/[?&]match=master/);
  // The engine plays it without any cheat, on a seed of its own (not the hub's), and the try counts at once.
  await expect.poll(() => savedGame(page)).toMatchObject({ cpu: 'master' });
  const save = (await savedGame(page))!;
  expect(save.seed).not.toBe(SEED);
  expect([save.dojo.peek ?? false, save.dojo.redraws_per_round ?? 0, save.dojo.summons_per_round ?? 0, save.dojo.wall_peek ?? 0]).toEqual([false, 0, 0, 0]);
  expect((await dojoProgress(page))?.masterMatch.tries).toBe(1);
  const settings = await openSettings(page);
  await expect(settings.getByRole('checkbox', { name: '透視' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^引き直し/ })).toHaveCount(0);
});

test('the 師範戦 stays locked short of the curriculum, and its URL then deals the hub game', async ({ page }) => {
  // The last lesson of the curriculum (秘伝, after the 師範戦, is not asked).
  const last = LESSONS.filter((l) => l.stage <= 5).at(-1)!;
  const { [last.id]: _, ...short } = GRADUATED.lessons!;
  await storeProgress(page, { ...GRADUATED, xp: 1_000_000, lessons: short });
  await page.goto('./?mode=dojo');
  // Locked: not listed (#374), only what opens it said.
  await expect(masterRow(page)).toHaveCount(0);
  await expect(page.getByTestId('dojo-lessons-rest')).toContainText('奥伝までの課題をすべて習得すると師範戦に挑めます');
  // The cheats are the 裏道場's: no tab for them before it is open, whatever the level (a high one here).
  await expect(page.getByRole('tab', { name: 'イカサマ' })).toHaveCount(0);
  // No 裏道場 yet: no 表道場 / 裏道場 tabs.
  await expect(page.getByRole('tab', { name: '裏道場' })).toHaveCount(0);

  await page.goto(`./?mode=dojo&play=1&match=master&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  await expect(cpuName(page)).toHaveText('弱い');
});

test('winning the 師範戦 opens the 裏道場, whose games play the urashihan with the cheats', async ({ page }) => {
  test.setTimeout(120_000);
  await watchEngine(page);
  // A cheat bought in the 裏道場 (not a legacy one): it works there only.
  await storeProgress(page, { ...GRADUATED, ownedItems: ['cheat:peek'] });
  // The game ends with you first.
  onEngineReply(page, (_call, reply) => {
    const st = reply.data;
    if (reply.status !== 200 || !st?.game_over || !Array.isArray(st.standings)) return;
    type Standing = { seat: number; rank: number; points: number; score: number };
    const mine = st.standings.find((s: Standing) => s.seat === st.you) as Standing;
    const first = st.standings.find((s: Standing) => s.rank === 1) as Standing;
    // Your seat takes the first's rank, points and score, and gives it yours.
    [mine.rank, first.rank] = [first.rank, mine.rank];
    [mine.points, first.points] = [first.points, mine.points];
    [mine.score, first.score] = [first.score, mine.score];
  });
  await page.goto('./?mode=dojo&play=1&match=master');
  await expect(handPanel(page)).toBeVisible();
  await expect(cpuName(page)).toHaveText('師範');
  await finishDojoGame(page);
  await expect(page.getByTestId('dojo-master-result')).toContainText('師範戦に勝ちました');
  await expect(page.getByTestId('dojo-master-result')).toContainText('裏道場が開きました');
  expect((await dojoProgress(page))?.masterMatch).toEqual({ tries: 1, wins: 1, uraOpen: true });

  // The hub, after a reload too: the 表道場 / 裏道場 tabs; the 裏道場 deals a game against the urashihan.
  await page.getByRole('button', { name: '道場へ戻る' }).click();
  await page.reload();
  await expect(masterRow(page)).toContainText('挑戦 1回・勝利 1回');
  await expect(page.getByRole('tab', { name: '表道場' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: '裏道場で対局' })).toHaveCount(0);
  await page.getByRole('tab', { name: '裏道場' }).click();
  await expect(page.getByTestId('dojo-side-note')).toContainText('順位の報酬：半荘・CPU 裏師範 ×4');
  await page.getByRole('link', { name: '裏道場で対局' }).click();
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(cpuName(page)).toHaveText('裏師範');
  await expect((await openSettings(page)).getByRole('checkbox', { name: '透視' })).toHaveCount(1);
  await page.keyboard.press('Escape');

  // The 表道場's game: the cheat bought in the 裏道場 does not work there.
  await page.goto(`./?mode=dojo&play=1&seed=${SEED}`);
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(cpuName(page)).toHaveText('弱い');
  await expect((await openSettings(page)).getByRole('checkbox', { name: '透視' })).toHaveCount(0);
});

test('the 表道場 and CPU games never play the master or the urashihan', async ({ page }) => {
  await storeProgress(page, { ...GRADUATED, xp: 1_000_000, masterMatch: { tries: 1, wins: 1, uraOpen: true } });
  await page.goto('./?mode=dojo');
  const settings = await openSettings(page);
  const cpus = settings.getByRole('group', { name: 'CPU' }).getByRole('radio');
  await expect(cpus).toHaveCount(2);
  await expect(settings.getByRole('group', { name: 'CPU' })).not.toContainText('師範');
  await page.keyboard.press('Escape');

  // A CPU game's URL asking for them deals the normal CPU; its form offers neither.
  for (const cpu of ['master', 'ura']) {
    await page.goto(`./?mode=game&seed=${SEED}&cpu=${cpu}`);
    await expect(handPanel(page)).toBeVisible();
    await expect(cpuName(page)).toHaveText('普通');
  }
  const form = await openSettings(page);
  await expect(form.getByRole('group', { name: 'CPU' })).not.toContainText('師範');
});

test('the 表道場 and the 裏道場 tabs are as tall, and each resumes its own unfinished game', async ({ page }) => {
  test.setTimeout(90_000);
  await storeProgress(page, { ...GRADUATED, masterMatch: { tries: 1, wins: 1, uraOpen: true } });
  await page.goto('./?mode=dojo');
  // 出稽古's panel, whose tabs these are.
  const panel = page.locator('section[aria-labelledby="dojo-play-heading"]');
  const omote = page.getByRole('tab', { name: '表道場' });
  const uraTab = page.getByRole('tab', { name: '裏道場' });
  const heights = async () => {
    await omote.click();
    const a = (await panel.boundingBox())!.height;
    await uraTab.click();
    const b = (await panel.boundingBox())!.height;
    return [a, b];
  };
  const sameHeights = async () => {
    for (const size of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      const [a, b] = await heights();
      expect(b, `${size.width}px`).toBe(a);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };
  await sameHeights();

  // A 師範戦 left unfinished: the 表道場 resumes it, named; the 裏道場 says where it is, and starting there drops it.
  await page.goto('./?mode=dojo&play=1&match=master');
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await page.goto('./?mode=dojo');
  await expect(page.getByRole('link', { name: '続きから（師範戦）' })).toBeVisible();
  await sameHeights(); // the 裏道場's note says where the game is, in the same lines
  await omote.click();
  await expect(page.getByRole('link', { name: '新しく始める' })).toHaveAttribute('title', /中断中の師範戦は破棄/);
  await uraTab.click();
  await expect(page.getByRole('link', { name: /^続きから/ })).toHaveCount(0);
  await expect(page.getByTestId('dojo-side-note')).toContainText('中断中の師範戦は表道場のタブに');
  const start = page.getByRole('link', { name: '裏道場で対局' });
  await expect(start).toHaveAttribute('title', /中断中の師範戦は破棄/);
  await start.click();
  await expect(handPanel(page)).toBeVisible();
  await waitForPlayback(page);
  await expect(cpuName(page)).toHaveText('裏師範');

  // Now the 裏道場 game is the one to resume, on its tab only.
  await page.goto('./?mode=dojo');
  await expect(page.getByRole('link', { name: /^続きから/ })).toHaveCount(0);
  await uraTab.click();
  await expect(page.getByRole('link', { name: '続きから' })).toBeVisible();
});

// The hub has one primary button: 鍛錬's while it leads (a lesson next, the 師範戦 open and not won), then 出稽古's.
for (const [name, p, primary] of [
  ['a lesson is next', {}, '始める'],
  ['the 師範戦 is open, not won', GRADUATED, '師範戦に挑戦する'],
  ['the 師範戦 is won', { ...GRADUATED, masterMatch: { tries: 1, wins: 1, uraOpen: true } }, '対局開始'],
] as const) {
  test(`the hub's one primary button when ${name}`, async ({ page }) => {
    await storeProgress(page, p);
    await page.goto('./?mode=dojo');
    const starts = page.locator('.dojo-home .dojo-start');
    await expect(starts).toHaveCount(1);
    await expect(starts).toHaveAccessibleName(new RegExp(primary));
    if (primary !== '対局開始') await expect(page.getByRole('link', { name: '対局開始' })).toHaveClass(/dojo-restart/);
  });
}
