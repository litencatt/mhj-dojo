import { expect, test, type Page } from '@playwright/test';
import { SEED, discardDrawn, handPanel, playOneStep } from './helpers';

// Opened with nothing in the URL (issue #186), the page offers the saves:
// 「続きから」 resumes the most recently used one, the list the others, and
// no new session or game is dealt until the player picks or starts one.

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

function resumePanel(page: Page, noun: string) {
  return page.getByRole('region', { name: `保存した${noun}` });
}

function param(page: Page, key: string) {
  return new URL(page.url()).searchParams.get(key);
}

test('a bare open offers the saved sessions: 続きから and the list', async ({ page }) => {
  await page.goto('./?seed=5&turns=18');
  await discardDrawn(page);
  const first = param(page, 'session');
  await page.goto('./?seed=6&turns=18');
  await discardDrawn(page);
  await discardDrawn(page);
  const second = param(page, 'session');

  await page.goto('./');
  const panel = resumePanel(page, '練習');
  await expect(panel).toBeVisible();
  // Nothing dealt meanwhile.
  await expect(handPanel(page)).toHaveCount(0);
  await expect(panel.locator('.resume-last')).toContainText('シード 6');
  const others = panel.getByRole('listitem');
  await expect(others).toHaveCount(1);
  await expect(others).toContainText('シード 5');

  await panel.getByRole('button', { name: '続きから' }).click();
  await expect(handPanel(page).locator('.discard-river .tile')).toHaveCount(2);
  await expect(panel).toHaveCount(0);
  expect(param(page, 'session')).toBe(second);

  // 続きから is now this one again; the list leads back to the other.
  await page.goto('./');
  await resumePanel(page, '練習').getByRole('listitem').getByRole('button').click();
  await expect(handPanel(page).locator('.discard-river .tile')).toHaveCount(1);
  expect(param(page, 'session')).toBe(first);
  expect(param(page, 'seed')).toBe('5');
});

test('a bare open with a saved session still starts a new one on 新規対局', async ({ page }) => {
  await page.goto('./?seed=5&turns=18');
  await discardDrawn(page);
  const first = param(page, 'session');
  await page.goto('./');
  await expect(resumePanel(page, '練習')).toBeVisible();
  await page.getByRole('button', { name: '新規対局' }).click();
  await expect(handPanel(page).locator('.discard-river .tile')).toHaveCount(0);
  await expect(resumePanel(page, '練習')).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]session=/);
  expect(param(page, 'session')).not.toBe(first);
});

test('a bare open of the CPU game offers its save, and 新規対局 mid-game asks first', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await playOneStep(page);
  const id = param(page, 'game');

  await page.goto('./?mode=game');
  const panel = resumePanel(page, '対局');
  await expect(panel.locator('.resume-last')).toContainText(`東風戦 東1局 シード ${SEED}`);
  await expect(handPanel(page)).toHaveCount(0);
  await panel.getByRole('button', { name: '続きから' }).click();
  await expect(handPanel(page)).toBeVisible();
  expect(param(page, 'game')).toBe(id);

  // Declined: the game stays.
  const asked: string[] = [];
  page.once('dialog', (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await page.getByRole('button', { name: '新規対局' }).click();
  await expect.poll(() => asked).toEqual(['対局中です。新しい対局を始めますか？']);
  await expect(handPanel(page)).toBeVisible();
  expect(param(page, 'game')).toBe(id);

  // Accepted: a new game.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '新規対局' }).click();
  await expect.poll(() => param(page, 'game')).not.toBe(id);
});

type SavedGames = Record<string, { save: string; used?: number; round?: { over: boolean } } | null>;

test('old-format and unreadable saves: listed as far as they can be, never a crash', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await playOneStep(page);
  const id = param(page, 'game');
  // A save from before rounds were kept, with no used either, among broken ones.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.games')!) as { games: SavedGames };
    for (const g of Object.values(s.games)) {
      delete g!.round;
      delete g!.used;
    }
    s.games.broken = null;
    s.games.unreadable = { save: 'not json', used: 1 };
    localStorage.setItem('mhj-dojo.site.games', JSON.stringify(s));
    localStorage.setItem('mhj-dojo.site.practice', JSON.stringify({ v: 2, sessions: { broken: null, odd: { seed: 'x' } } }));
  });

  await page.goto('./?mode=game');
  const panel = resumePanel(page, '対局');
  await expect(panel.locator('#resume-last-desc')).toHaveText(`東風戦 シード ${SEED}`);
  await expect(panel.getByRole('listitem')).toHaveCount(0);
  await panel.getByRole('button', { name: '続きから' }).click();
  await expect(handPanel(page)).toBeVisible();
  expect(param(page, 'game')).toBe(id);

  // Nothing readable to offer in practice: a new session at once.
  await page.goto('./');
  await expect(handPanel(page).locator('.hand-tiles .tile')).toHaveCount(13);
  await expect(resumePanel(page, '練習')).toHaveCount(0);
});

test('続きから skips a finished game, which stays in the list', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=tonpuu`);
  await playOneStep(page);
  const unfinished = param(page, 'game');
  await page.goto(`./?mode=game&seed=${SEED + 1}&length=tonpuu`);
  await expect(handPanel(page)).toBeVisible();
  // The newer one, marked as ended.
  await page.evaluate((finished) => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.games')!) as { games: SavedGames };
    s.games[finished]!.round!.over = true;
    localStorage.setItem('mhj-dojo.site.games', JSON.stringify(s));
  }, param(page, 'game')!);

  await page.goto('./?mode=game');
  const panel = resumePanel(page, '対局');
  await expect(panel.getByRole('listitem')).toHaveText([new RegExp(`終局 シード ${SEED + 1}`)]);
  await panel.getByRole('button', { name: '続きから' }).click();
  await expect(handPanel(page)).toBeVisible();
  expect(param(page, 'game')).toBe(unfinished);
});

test('a save the engine rejects deals the same game again from its seed and options', async ({ page }) => {
  await page.goto(`./?mode=game&seed=${SEED}&length=hanchan&first_dealer=you&cpu=weak`);
  await playOneStep(page);
  const id = param(page, 'game');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mhj-dojo.site.games')!) as { games: SavedGames };
    for (const g of Object.values(s.games)) {
      const save = JSON.parse(g!.save) as { actions: unknown[] };
      save.actions = [{ type: 'bogus' }];
      g!.save = JSON.stringify(save);
    }
    localStorage.setItem('mhj-dojo.site.games', JSON.stringify(s));
  });

  await page.goto('./?mode=game');
  await resumePanel(page, '対局').getByRole('button', { name: '続きから' }).click();
  await expect(handPanel(page)).toBeVisible();
  await expect(page.locator('.game-status')).toContainText(String(SEED));
  await expect(page.locator('.game-status')).toContainText('半荘戦');
  await expect(page.locator('.game-status')).toContainText('弱い');
  expect(param(page, 'first_dealer')).toBe('you');
  expect(param(page, 'game')).not.toBe(id);
});
