import type { Page } from '@playwright/test';

// Two tabs of one browser on the same session or game. A tab in view picks
// up the other's saves by itself ('storage' events); one switched away from
// catches up when shown again, or refuses a move made on its old screen.

/** Makes page report itself as a tab switched away from, on every load, until showTab. */
export async function hideTab(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { tabHidden: boolean };
    w.tabHidden = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (w.tabHidden ? 'hidden' : 'visible'),
    });
  });
}

/** Switches back to a tab hidden by hideTab: the browser fires visibilitychange. */
export async function showTab(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { tabHidden: boolean }).tabHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
