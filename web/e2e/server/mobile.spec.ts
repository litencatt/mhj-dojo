import { expect, test } from '@playwright/test';

// A touch screen on the local server only: the CPU game's responses patched
// to offer riichi (e2e/shared/mobile.spec.ts has the rest, on both builds).

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  // A pick made before リーチ is toggled must not declare riichi with one tap.
  // The server rarely offers riichi early, so its responses are patched to
  // offer it on the tile the test selects (no riichi is ever sent).
  test('toggling riichi drops a tap selection', async ({ page }) => {
    await page.route('**/api/games**', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      if (body?.legal && body.phase === 'discard' && body.actor === body.you && body.legal.discards.length > 0) {
        const me = body.seats[body.you];
        body.legal.riichi = [me.drawn ?? body.legal.discards[0]];
      }
      await route.fulfill({ response: res, json: body });
    });
    await page.goto('/?mode=game&seed=12&first_dealer=you');
    await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
    const hand = page.getByRole('region', { name: '手牌' });
    const drawn = hand.locator('.hand-drawn button');
    await expect(drawn).toBeVisible();
    let actions = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/action')) actions++;
    });

    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    await page.locator('.action-bar').getByRole('button', { name: 'リーチ' }).tap();
    await expect(page.locator('.action-bar').getByRole('button', { name: 'リーチ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(hand.locator('.tile-picked')).toHaveCount(0);
    // One tap only selects the riichi tile again: nothing is sent.
    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    expect(actions).toBe(0);
  });
});
