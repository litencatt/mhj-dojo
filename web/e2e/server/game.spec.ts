import { expect, test, type Page } from '@playwright/test';
import type { GameResult, GameState } from '../../src/api';
import { SEED, clickAndWait, handPanel, pageOverflowX, playOneStep, playUntilPonOffered, waitForPlayback } from '../helpers';

// The CPU game on the local server only: its HTTP API (responses patched
// to set up a table, the playback checked against them, a failing request)
// and two browsers on one game (e2e/shared has the rest, on both builds).

const WIND: Record<string, string> = { '1z': '東', '2z': '南', '3z': '西', '4z': '北' };

// On an upright phone your seat leaves the table for the hand panel: its
// wind (red for the dealer), points, rank and riichi on one line beside
// 手牌, 面子表示 still in view, and its river (the riichi tile sideways)
// under the hand. Called melds sit on a row of their own from the hand's
// left edge, in the hand's tile size, so four fit on one row. The response
// is patched with a riichi and four melds, whatever the seed deals.
test('an upright phone shows your seat in the hand panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  for (let i = 0; i < 4; i++) await playOneStep(page);
  await waitForPlayback(page);
  let st: GameState | null = null;
  await page.route('**/api/games/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const s = (await response.json()) as GameState;
    const me = s.seats[s.you];
    me.riichi = true;
    me.river[1].riichi = true;
    me.melds = [
      { type: 'pon', tiles: ['5z', '5z', '5z'], from: (s.you + 1) % 4, added: false },
      { type: 'chii', tiles: ['2s', '3s', '1s'], from: (s.you + 3) % 4, added: false },
      { type: 'kan', tiles: ['7p', '7p', '7p', '7p'], from: (s.you + 2) % 4, added: true },
      { type: 'ankan', tiles: ['9m', '9m', '9m', '9m'], from: -1, added: false },
    ];
    me.hand = me.hand!.slice(12);
    st = s;
    await route.fulfill({ response, json: s });
  });
  await page.reload();
  await waitForPlayback(page);
  const state = st!;
  const me = state.seats[state.you];
  const hand = handPanel(page);
  await expect(page.locator('.seat-bottom')).toBeHidden();
  const river = hand.locator('[aria-label="自分の捨て牌"]');
  await expect(river.locator('.tile')).toHaveCount(me.river.length);
  await expect(river.locator('.river-riichi')).toHaveCount(1);
  const status = hand.locator('.hand-status');
  await expect(status.locator('.seat-wind')).toHaveText(WIND[me.wind]);
  expect(await status.locator('.seat-wind').evaluate((e) => e.classList.contains('seat-dealer'))).toBe(
    state.dealer === state.you,
  );
  await expect(status.locator('.seat-points')).toHaveText(me.points.toLocaleString());
  await expect(status.locator('.seat-rank')).toHaveText(`${state.standings[state.you].rank}位`);
  await expect(status.locator('.seat-riichi')).toHaveText('リーチ');

  for (const [width, height] of [[390, 844], [360, 800], [320, 640]]) {
    await page.setViewportSize({ width, height });
    const heading = (await hand.locator('.hand-heading').boundingBox())!;
    const s = (await status.boundingBox())!;
    const toggle = (await hand.getByRole('button', { name: '面子表示' }).boundingBox())!;
    expect(s.height, `${width}px`).toBeLessThanOrEqual(24);
    expect(s.x + s.width).toBeLessThanOrEqual(toggle.x);
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(heading.x + heading.width + 0.5);
    expect(await status.evaluate((e) => e.scrollWidth <= e.clientWidth), `${width}px: the status is not clipped`).toBe(true);
    // The melds: one row, from the hand's left edge, in its tile size.
    const melds = hand.locator('.hand-row > .melds');
    const bottoms = await melds
      .locator('.meld')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().bottom)));
    expect(bottoms).toHaveLength(4);
    expect(new Set(bottoms).size, `${width}px: four melds on one row`).toBe(1);
    const first = (await hand.locator('.hand-tiles').boundingBox())!;
    expect(Math.abs((await melds.boundingBox())!.x - first.x)).toBeLessThanOrEqual(1);
    const handTile = (await hand.locator('.hand-tiles .tile').first().boundingBox())!;
    const meldTile = (await melds.locator('.meld > .tile').first().boundingBox())!;
    expect(Math.abs(meldTile.width - handTile.width)).toBeLessThanOrEqual(0.5);
    expect(await pageOverflowX(page)).toBeLessThanOrEqual(0);
  }
});

// 設定 comes right before its options in the focus order: Tab goes from it
// into them. Escape folds them away, and so does a new game once it is on,
// focus going back to 設定 either way; a new game that fails keeps them
// open, as chosen.
test('a phone\'s 設定: Tab into the options, Escape and a new game fold them back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  await waitForPlayback(page);
  const toggle = page.getByRole('button', { name: /^設定/ });
  const form = page.locator('.new-game-form');
  const length = form.getByRole('combobox').first();

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(form).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(length).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();

  // A failed request keeps the options, as chosen.
  await page.keyboard.press('Enter');
  await length.selectOption('hanchan');
  await page.route('**/api/games', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 500, body: 'boom' }) : route.continue(),
  );
  await form.getByRole('button', { name: '新規対局' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.error-banner')).toBeVisible();
  await expect(form).toBeVisible();
  await expect(length).toHaveValue('hanchan');

  // A new game folds them away, focus back on 設定.
  await page.unroute('**/api/games');
  await form.getByRole('button', { name: '新規対局' }).focus();
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/games')),
    page.keyboard.press('Enter'),
  ]);
  await expect(form).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator('.game-status')).toContainText('半荘戦');
});

// Two browsers on the same game (two tabs of one browser would stop each
// other, see e2e/shared).
test('a stale browser: acting after another browser moved the game on shows a notice, not an error', async ({
  page,
  browser,
}) => {
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const hand = handPanel(page);
  await expect(hand).toBeVisible();

  // Get page A to a pon offer, but don't resolve it yet.
  await playUntilPonOffered(page);
  const actionBarA = page.locator('.action-bar');
  const ponButtonA = actionBarA.getByRole('button', { name: 'ポン', exact: true });
  await expect(ponButtonA).toBeVisible();

  // Page B: the same game, fetched fresh - it sees the same offer.
  const gameId = new URL(page.url()).searchParams.get('game');
  expect(gameId, 'the URL should carry the server-assigned game id').toBeTruthy();
  const pageB = await (await browser.newContext()).newPage();
  await pageB.goto(`/?mode=game&game=${gameId}`);
  const actionBarB = pageB.locator('.action-bar');
  const ponButtonB = actionBarB.getByRole('button', { name: 'ポン', exact: true });
  await expect(ponButtonB).toBeVisible();

  // Page A skips the call: the offer's window is now closed for every seat,
  // including the human's, whichever tab acts.
  const skipButtonA = actionBarA.getByRole('button', { name: /^(見逃す|スキップ)$/ });
  await clickAndWait(page, skipButtonA);
  await waitForPlayback(page);

  // Page B, unaware, calls pon on its now-stale offer: the server rejects
  // it (409, the offer is gone), the client re-fetches, sees the game
  // really did move on (a different phase/actor/event count), and shows a
  // notice instead of the raw error.
  await Promise.all([
    pageB.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    ponButtonB.click(),
  ]);
  await expect(pageB.locator('.notice-banner')).toBeVisible({ timeout: 15_000 });
  await expect(pageB.locator('.error-banner')).toBeHidden();
  await waitForPlayback(pageB);
  await pageB.context().close();
});

// While the CPU moves replay, the table's numbers follow the step shown, not
// the response's final values: the wall after each move (its
// wall_remaining), a riichi's stick leaving the seat's points for the
// deposit, a kan dora turned over (new_dora_indicators), and the log of the
// round's moves growing by one. The playback clock is Playwright's, so each
// step is looked at in turn; the response is patched with a riichi and a kan
// dora so the steps check those too, whatever the seed deals.
test('the table follows the CPU playback step by step, and スキップ jumps to the end', async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  let patched: GameState | null = null;
  let riichiAt = -1;
  await page.route('**/api/games/*/action', async (route) => {
    const response = await route.fetch();
    const state = (await response.json()) as GameState;
    if (patched === null) {
      // The first CPU discard becomes an accepted riichi, and the last move
      // turns a kan dora over.
      riichiAt = state.events.findIndex((e, i) => i > 0 && e.type === 'discard');
      const e = state.events[riichiAt];
      if (riichiAt > 0 && riichiAt < state.events.length - 1) {
        e.type = 'riichi';
        state.seats[e.seat].riichi = true;
        state.seats[e.seat].points -= 1000;
        state.deposit += 1000;
        state.events[state.events.length - 1].new_dora_indicators = ['1m'];
        state.dora_indicators.push('1m');
        state.dora.push('2m');
      }
      patched = state;
    }
    await route.fulfill({ response, json: state });
  });

  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  // The clock stands still: skip the CPU turns before your first, if any.
  if ((await table.getAttribute('data-playing')) === 'true') {
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  const log = page.locator('.event-log li');
  const earlier = await log.count();

  // From here the page's time only moves with runFor: effects (run on an
  // animation frame) and each playback step.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await clickAndWait(page, hand.locator('.hand-drawn button'));
  await page.clock.runFor(50);
  const st = patched as GameState | null;
  expect(st, 'the action response').not.toBeNull();
  const { events } = st!;
  expect(riichiAt, `a CPU discard before the last move (seed ${SEED})`).toBeGreaterThan(0);
  expect(riichiAt).toBeLessThan(events.length - 1);
  expect(st!.events_from, 'the log so far is the round before this response').toBe(earlier);

  const seatClass = ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'];
  const riichiSeat = events[riichiAt].seat;
  const riichiPoints = page.locator(`${seatClass[(riichiSeat - st!.you + 4) % 4]} .seat-points`);
  const deposit = page.locator('.table-deposit');
  const doraTiles = page.locator('.dora-box dd').first().locator('.tile');
  const finalDora = st!.dora_indicators.length;
  const sticks = (d: number) => (d > 0 ? `供託 ${d / 1000}本` : null);

  // Your own discard shows at once; each CPU move follows PLAYBACK_STEP_MS later.
  for (let step = 1; step < events.length; step++) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    await expect(log).toHaveCount(earlier + step);
    await expect(page.locator('.table-remaining')).toHaveText(`残り ${events[step - 1].wall_remaining}`);
    const accepted = step > riichiAt;
    const points = st!.seats[riichiSeat].points + (accepted ? 0 : 1000);
    await expect(riichiPoints).toHaveText(points.toLocaleString());
    const d = sticks(st!.deposit - (accepted ? 0 : 1000));
    if (d) await expect(deposit).toHaveText(d);
    else await expect(deposit).toHaveCount(0);
    await expect(doraTiles).toHaveCount(2 * (finalDora - 1));
    await page.clock.runFor(350);
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(log).toHaveCount(earlier + events.length);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${st!.wall_remaining}`);
  await expect(riichiPoints).toHaveText(st!.seats[riichiSeat].points.toLocaleString());
  await expect(deposit).toHaveText(sticks(st!.deposit)!);
  await expect(doraTiles).toHaveCount(2 * finalDora);

  // The next response: スキップ right away shows its final values.
  const move =
    st!.phase === 'discard'
      ? hand.locator('.hand-drawn button, .hand-tiles button').last()
      : page.locator('.action-bar').getByRole('button', { name: /^(見逃す|スキップ)$/ });
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    move.click(),
  ]);
  const next = (await response.json()) as GameState;
  await page.clock.runFor(50);
  if (next.events.length > 1) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    // After skipping a call the CPUs move first: the wall before them.
    const lead = next.events[0].seat === next.you ? next.events[0].wall_remaining : next.events_wall_remaining;
    await expect(page.locator('.table-remaining')).toHaveText(`残り ${lead}`);
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${next.wall_remaining}`);
  await expect(log).toHaveCount(next.events_from + next.events.length);
});

// A hidden tab has nobody to show the steps to: the playback jumps to the end.
test('the playback jumps to the end when the tab is hidden', async ({ page }) => {
  await page.clock.install();
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  if ((await table.getAttribute('data-playing')) === 'true') {
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();

  // The clock stands still, so the playback stays at its first step until the tab hides.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    hand.locator('.hand-drawn button').click(),
  ]);
  const st = (await response.json()) as GameState;
  expect(st.events.length, `CPU moves after your discard (seed ${SEED})`).toBeGreaterThan(1);
  await page.clock.runFor(50);
  await expect(table).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + 1);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + st.events.length);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${st.wall_remaining}`);
});

// A tab hidden before the response lands never starts the steps at all.
test('the playback starts at its end when the tab is already hidden', async ({ page }) => {
  await page.clock.install();
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  if ((await table.getAttribute('data-playing')) === 'true') {
    await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();

  // The clock stands still: only the hidden tab can end the playback.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/action')),
    hand.locator('.hand-drawn button').click(),
  ]);
  const st = (await response.json()) as GameState;
  expect(st.events.length, `CPU moves after your discard (seed ${SEED})`).toBeGreaterThan(1);
  await page.clock.runFor(50);
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + st.events.length);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${st.wall_remaining}`);
});

// A game whose first dealer is a CPU opens with the CPU turns before yours:
// before the first of them lands, the wall is the one they started from.
const CPU_DEALS = 13; // a seed whose first dealer is not you
test('the wall before the first CPU move of a round', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  const created = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/games',
  );
  await page.goto(`/?mode=game&seed=${CPU_DEALS}&first_dealer=random&length=tonpuu`);
  // Effects run on an animation frame: step the paused clock a frame at a
  // time until the game is dealt and the table is up, well short of the
  // first playback step.
  const table = page.locator('.game-table');
  await expect
    .poll(async () => {
      await page.clock.runFor(16);
      return table.count();
    })
    .toBe(1);
  const first = (await (await created).json()) as GameState;
  if (first.events.length === 0 || first.events[0].seat === first.you) {
    throw new Error(`seed ${CPU_DEALS}: you deal first`);
  }
  await expect(table).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.event-log li')).toHaveCount(0);
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${first.events_wall_remaining}`);
  await page.locator('.action-bar').getByRole('button', { name: 'スキップ' }).click();
  await expect(page.locator('.table-remaining')).toHaveText(`残り ${first.wall_remaining}`);
});

// playbackState works the table out backwards from a response's final
// state: the round result's deltas come off first (the settlement shows only
// once the playback ends), then each accepted riichi still to play gives its
// stick back. These tests patch your first action's response (your discard,
// then three CPU discards) into a round that ends in it, then check each
// step's points, deposit and ranks, and the final values once it is over.
const SEAT_BOXES = ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'];
const START = [25000, 25000, 25000, 25000];

/** Ranks by points, ties to the seat nearer the first dealer. */
function ranksOf(points: number[], firstDealer: number): number[] {
  const near = (s: number) => (s - firstDealer + 4) % 4;
  const order = [0, 1, 2, 3].sort((a, b) => points[b] - points[a] || near(a) - near(b));
  return [0, 1, 2, 3].map((s) => order.indexOf(s) + 1);
}

interface RoundEnd {
  // Turns the real response into the patched one; `cpus` are the seats of
  // the three CPU discards, in order (events 1-3).
  patch: (st: GameState, cpus: number[]) => void;
  // The points and deposit shown with `step` events played.
  during: (step: number) => { points: number[]; deposit: number };
  ranks?: number[]; // the ranks at every step, if not by ranksOf
}

/** Ends the round in `st`: the result, the final points and deposit. */
function endRound(st: GameState, result: Partial<GameResult>, deltas: number[], deposit: number) {
  const zero = [0, 0, 0, 0];
  st.result = {
    kind: 'ron', winner: -1, from: -1, win_tile: null, yaku: [], han: 0, fu: 0, dora: 0, ura_dora: 0,
    points: { limit: '', multiplier: 0, total: 0 }, deltas, hand_deltas: deltas, honba_deltas: zero,
    stick_deltas: zero, honba: st.honba, tenpai: [false, false, false, false], deposit: 0, pao: [],
    ...result,
  };
  st.phase = 'ended';
  st.actor = -1;
  st.can_next = true;
  st.deposit = deposit;
  for (const s of st.seats) s.points += deltas[s.seat];
}

async function checkRoundEnd(page: Page, end: RoundEnd) {
  await page.clock.install();
  let patched: GameState | null = null;
  // The events of the real response, checked after the click: an expect()
  // failing in here would leave the page waiting, and the test timing out.
  let real: string[] = [];
  await page.route('**/api/games/*/action', async (route) => {
    const response = await route.fetch();
    const st = (await response.json()) as GameState;
    if (patched === null) {
      real = st.events.map((e) => e.type);
      patched = st;
      if (real.join() !== 'discard,discard,discard,discard') {
        await route.fulfill({ response, json: st });
        return;
      }
      end.patch(st, st.events.slice(1).map((e) => e.seat));
      const ranks = end.ranks ?? ranksOf(st.seats.map((s) => s.points), st.first_dealer);
      for (const sd of st.standings) {
        sd.points = st.seats[sd.seat].points;
        sd.rank = ranks[sd.seat];
      }
    }
    await route.fulfill({ response, json: st });
  });
  await page.goto(`/?mode=game&seed=${SEED}&length=tonpuu`);
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled({ timeout: 15_000 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await clickAndWait(page, hand.locator('.hand-drawn button'));
  await page.clock.runFor(50);
  const st = patched as GameState | null;
  expect(real, `your discard, then three CPU discards (seed ${SEED})`).toEqual(Array(4).fill('discard'));

  const table = page.locator('.game-table');
  const result = page.getByRole('region', { name: '結果' });
  const expectTable = async (points: number[], deposit: number) => {
    const ranks = end.ranks ?? ranksOf(points, st!.first_dealer);
    for (let s = 0; s < 4; s++) {
      const box = page.locator(SEAT_BOXES[(s - st!.you + 4) % 4]);
      await expect(box.locator('.seat-points'), `seat ${s} points`).toHaveText(points[s].toLocaleString());
      await expect(box.locator('.seat-rank'), `seat ${s} rank`).toHaveText(`${ranks[s]}位`);
    }
    if (deposit > 0) await expect(page.locator('.table-deposit')).toHaveText(`供託 ${deposit / 1000}本`);
    else await expect(page.locator('.table-deposit')).toHaveCount(0);
  };
  for (let step = 1; step < st!.events.length; step++) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    await expect(result).toHaveCount(0);
    const d = end.during(step);
    await expectTable(d.points, d.deposit);
    await page.clock.runFor(350);
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(result).toBeVisible();
  await expectTable(
    st!.seats.map((s) => s.points),
    st!.deposit,
  );
}

test('playback before a ron with honba and a carried stick: points, stick and ranks as before it', async ({ page }) => {
  // The third CPU discard is ronned by the second CPU: 3900 and 2 honba,
  // and the stick carried on the table goes to the winner.
  await checkRoundEnd(page, {
    patch: (st, [, winner, from]) => {
      st.honba = 2; // a new round key for useRoundLog too: the log starts over, which is fine here
      const hand = [0, 0, 0, 0];
      const honba = [0, 0, 0, 0];
      const sticks = [0, 0, 0, 0];
      [hand[winner], hand[from]] = [3900, -3900];
      [honba[winner], honba[from]] = [600, -600];
      sticks[winner] = 1000;
      st.events.push({ seat: winner, type: 'ron', wall_remaining: st.events[3].wall_remaining });
      const deltas = [0, 1, 2, 3].map((s) => hand[s] + honba[s] + sticks[s]);
      endRound(st, { kind: 'ron', winner, from, hand_deltas: hand, honba_deltas: honba, stick_deltas: sticks }, deltas, 0);
    },
    during: () => ({ points: START, deposit: 1000 }),
  });
});

test('playback before a tsumo by a riichi seat: the stick leaves with the riichi, the win waits', async ({ page }) => {
  // The first CPU discard declares riichi (accepted), and that seat wins by
  // tsumo: 1000/2000 (the dealer pays 2000), its own stick back.
  let riichi = -1;
  await checkRoundEnd(page, {
    patch: (st, [seat]) => {
      riichi = seat;
      st.events[1].type = 'riichi';
      st.seats[seat].riichi = true;
      st.seats[seat].river[st.seats[seat].river.length - 1].riichi = true;
      st.events.push({ seat, type: 'tsumo', wall_remaining: st.events[3].wall_remaining });
      const hand = [0, 1, 2, 3].map((s) => (s === seat ? 4000 : s === st.dealer ? -2000 : -1000));
      // -1000 for its riichi, +1000 from the table: the final points are
      // the start plus the deltas, as the engine settles them.
      const sticks = [0, 0, 0, 0];
      endRound(st, { kind: 'tsumo', winner: seat, hand_deltas: hand, stick_deltas: sticks }, hand, 0);
    },
    during: (step) => ({
      points: START.map((p, s) => (s === riichi && step > 1 ? p - 1000 : p)),
      deposit: step > 1 ? 1000 : 0,
    }),
  });
});

test('playback before an exhaustive draw: the tenpai payments wait for the end', async ({ page }) => {
  await checkRoundEnd(page, {
    patch: (st, [, b]) => {
      const tenpai = [0, 1, 2, 3].map((s) => s === st.you || s === b);
      const hand = tenpai.map((t) => (t ? 1500 : -1500));
      endRound(st, { kind: 'draw', tenpai, hand_deltas: hand }, hand, 0);
    },
    during: () => ({ points: START, deposit: 0 }),
  });
});

test('playback before a ron on a riichi declaration: that riichi never puts a stick down', async ({ page }) => {
  // The third CPU discard declares riichi and is ronned: the riichi does
  // not stand (no badge, no stick) at any step.
  await checkRoundEnd(page, {
    patch: (st, [, winner, from]) => {
      st.events[3].type = 'riichi';
      const hand = [0, 0, 0, 0];
      [hand[winner], hand[from]] = [2000, -2000];
      st.events.push({ seat: winner, type: 'ron', wall_remaining: st.events[3].wall_remaining });
      endRound(st, { kind: 'ron', winner, from, hand_deltas: hand }, hand, 0);
    },
    during: () => ({ points: START, deposit: 0 }),
  });
  await expect(page.locator('.seat-riichi')).toHaveCount(0);
});

test('playback with the points tied: ranks go to the seat nearer the first dealer', async ({ page }) => {
  // Everyone tenpai: no payments, all four on 25,000 before and after. With
  // seat 2 as the first dealer, seats 2, 3, 0, 1 rank 1st to 4th.
  await checkRoundEnd(page, {
    patch: (st) => {
      st.first_dealer = 2;
      endRound(st, { kind: 'draw', tenpai: [true, true, true, true] }, [0, 0, 0, 0], 0);
    },
    during: () => ({ points: START, deposit: 0 }),
    ranks: [3, 4, 1, 2],
  });
});
