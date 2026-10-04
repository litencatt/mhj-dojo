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
