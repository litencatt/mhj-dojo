import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GameResult, GameState } from '../src/api';
import {
  GAME_URL,
  PHONE,
  SEED,
  engineCalls,
  finishPlayback,
  type EngineCall,
  handPanel,
  isGameAction,
  isRequest,
  nextEngineReply,
  onEngineReply,
  openGame,
  pageOverflowX,
  playOneStep,
  waitForPlayback,
  wallRemaining,
  watchEngine,
} from './helpers';

// The CPU game's table with the engine's answers patched to set it up
// (a riichi, melds, a round's end), or looked at to check the playback
// against them: the site's engine is watched (watchEngine) as a server's
// responses were routed. game.spec.ts has the rest of the game.

const WIND: Record<string, string> = { '1z': '東', '2z': '南', '3z': '西', '4z': '北' };

test.beforeEach(async ({ page }) => {
  await watchEngine(page);
});

/** A state of the game the page asks for: loading it, or rebuilding it from its save after a reload. */
function isGameGet(call: EngineCall) {
  return call.fn === 'restoreGame' || isRequest(call, 'GET', /^\/api\/games\/[^/]+$/);
}

/** Clicks and waits for the engine's answer to the game action it makes, as the page got it. */
async function act(page: Page, locator: Locator): Promise<GameState> {
  const [reply] = await Promise.all([nextEngineReply(page, isGameAction), locator.click()]);
  return reply.data as GameState;
}

// On an upright phone your seat leaves the table for the hand panel: its
// wind (red for the dealer), points, rank and riichi on one line beside
// 手牌, 面子表示 still in view, and its river (the riichi tile sideways)
// under the hand. Called melds sit on a row of their own from the hand's
// left edge, in the hand's tile size, so four fit on one row. The game's
// state is patched with a riichi and four melds, whatever the seed deals.
test('an upright phone shows your seat in the hand panel', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto(GAME_URL);
  for (let i = 0; i < 4; i++) await playOneStep(page);
  await waitForPlayback(page);
  let st: GameState | null = null;
  onEngineReply(page, (call, reply) => {
    if (!isGameGet(call) || reply.status !== 200) return;
    const s = reply.data as GameState;
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
  });
  // The reload rebuilds the game from its save: that answer is patched.
  await page.reload();
  await waitForPlayback(page);
  expect(st, 'the game rebuilt after the reload').not.toBeNull();
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

// 設定 opens its options in a modal dialog, focus on the first. Escape
// closes it, and so does a new game once it is on, focus going back to 設定
// either way; a new game that fails keeps them open, as chosen.
test('a phone\'s 設定: a dialog of the options, closed by Escape and a new game', async ({ page }) => {
  await page.setViewportSize(PHONE);
  // 新規対局 mid-game asks first.
  page.on('dialog', (d) => void d.accept());
  await openGame(page);
  const toggle = page.getByRole('button', { name: /^設定/ });
  const form = page.locator('.new-game-form');
  const length = form.getByRole('radio', { name: '東風戦' });
  const hanchan = form.getByRole('radio', { name: '半荘戦' });

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '設定' })).toBeVisible();
  await expect(length).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  await expect(toggle).toBeFocused();
  // So does a tap outside it (the page's margin, beside the dialog).
  await toggle.click();
  await expect(form).toBeVisible();
  await page.mouse.click(4, 400);
  await expect(form).toBeHidden();
  await toggle.focus();

  // A failed request keeps the options, as chosen.
  await page.keyboard.press('Enter');
  await hanchan.check();
  const isCreate = (call: EngineCall) => isRequest(call, 'POST', /^\/api\/games$/);
  const fail = onEngineReply(page, (call, reply) => {
    if (!isCreate(call)) return;
    reply.status = 500;
    reply.data = { error: 'boom' };
  });
  await form.getByRole('button', { name: '新規対局' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.error-banner')).toBeVisible();
  await expect(form).toBeVisible();
  await expect(hanchan).toBeChecked();

  // A new game folds them away, focus back on 設定.
  fail();
  await form.getByRole('button', { name: '新規対局' }).focus();
  await Promise.all([nextEngineReply(page, isCreate), page.keyboard.press('Enter')]);
  await expect(form).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.locator('.game-status')).toContainText('半荘戦');
});

// While the CPU moves replay, the table's numbers follow the step shown, not
// the answer's final values: the wall after each move (its
// wall_remaining), a riichi's stick leaving the seat's points for the
// deposit, a kan dora turned over (new_dora_indicators), and the log of the
// round's moves growing by one. The playback clock is Playwright's, so each
// step is looked at in turn; the answer is patched with a riichi and a kan
// dora so the steps check those too, whatever the seed deals.
test('the table follows the CPU playback step by step, and ends on the final values', async ({ page }) => {
  await page.clock.install();
  let patched: GameState | null = null;
  let riichiAt = -1;
  onEngineReply(page, (call, reply) => {
    if (!isGameAction(call) || reply.status !== 200 || patched !== null) return;
    const state = reply.data as GameState;
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
  });

  await page.goto(GAME_URL);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  // The clock stands still: let the CPU turns before your first play out, if any.
  if ((await table.getAttribute('data-playing')) === 'true') {
    await finishPlayback(page);
  }
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled();
  const log = page.locator('.event-log li');
  const earlier = await log.count();

  // From here the page's time only moves with runFor: effects (run on an
  // animation frame) and each playback step.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await act(page, hand.locator('.hand-drawn button'));
  await page.clock.runFor(50);
  const st = patched as GameState | null;
  expect(st, 'the action answer').not.toBeNull();
  const { events } = st!;
  expect(riichiAt, `a CPU discard before the last move (seed ${SEED})`).toBeGreaterThan(0);
  expect(riichiAt).toBeLessThan(events.length - 1);
  expect(st!.events_from, 'the log so far is the round before this answer').toBe(earlier);

  const seatClass = ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'];
  const riichiSeat = events[riichiAt].seat;
  const riichiPoints = page.locator(`${seatClass[(riichiSeat - st!.you + 4) % 4]} .seat-points`);
  const deposit = page.locator('.table-deposit');
  const doraTiles = page.locator('.dora-box').filter({ visible: true }).locator('dd').first().locator('.tile');
  const finalDora = st!.dora_indicators.length;
  const sticks = (d: number) => (d > 0 ? `供託 ${d / 1000}本` : null);

  // Your own discard shows at once; each CPU move follows one playback step (350ms, 普通) later.
  for (let step = 1; step < events.length; step++) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    await expect(log).toHaveCount(earlier + step);
    await expect(wallRemaining(page)).toHaveText(String(events[step - 1].wall_remaining));
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
  await expect(wallRemaining(page)).toHaveText(String(st!.wall_remaining));
  await expect(riichiPoints).toHaveText(st!.seats[riichiSeat].points.toLocaleString());
  await expect(deposit).toHaveText(sticks(st!.deposit)!);
  await expect(doraTiles).toHaveCount(2 * finalDora);

  // The next answer: its final values show once the replay ends.
  const move =
    st!.phase === 'discard'
      ? hand.locator('.hand-drawn button, .hand-tiles button').last()
      : page.locator('.action-bar').getByRole('button', { name: /^(見逃す|スキップ)$/ });
  const next = await act(page, move);
  await page.clock.runFor(50);
  if (next.events.length > 1) {
    await expect(table).toHaveAttribute('data-playing', 'true');
    // After skipping a call the CPUs move first: the wall before them.
    const lead = next.events[0].seat === next.you ? next.events[0].wall_remaining : next.events_wall_remaining;
    await expect(wallRemaining(page)).toHaveText(String(lead));
    await finishPlayback(page);
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(wallRemaining(page)).toHaveText(String(next.wall_remaining));
  await expect(log).toHaveCount(next.events_from + next.events.length);
});

/** Hides the tab, as switching away from it does. */
async function hide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Opens the game with the clock installed, past any CPU turns before yours, your drawn tile ready. */
async function openAtYourTurn(page: Page) {
  await page.clock.install();
  await page.goto(GAME_URL);
  const table = page.locator('.game-table');
  await expect(table).toBeVisible();
  if ((await table.getAttribute('data-playing')) === 'true') {
    await finishPlayback(page);
  }
  await expect(handPanel(page).locator('.hand-drawn button')).toBeEnabled();
  return table;
}

// A hidden tab has nobody to show the steps to: the playback jumps to the end.
test('the playback jumps to the end when the tab is hidden', async ({ page }) => {
  const table = await openAtYourTurn(page);
  // The clock stands still, so the playback stays at its first step until the tab hides.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const st = await act(page, handPanel(page).locator('.hand-drawn button'));
  expect(st.events.length, `CPU moves after your discard (seed ${SEED})`).toBeGreaterThan(1);
  await page.clock.runFor(50);
  await expect(table).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + 1);

  await hide(page);
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + st.events.length);
  await expect(wallRemaining(page)).toHaveText(String(st.wall_remaining));
});

// A tab hidden before the answer lands never starts the steps at all.
test('the playback starts at its end when the tab is already hidden', async ({ page }) => {
  const table = await openAtYourTurn(page);
  // The clock stands still: only the hidden tab can end the playback.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await hide(page);
  const st = await act(page, handPanel(page).locator('.hand-drawn button'));
  expect(st.events.length, `CPU moves after your discard (seed ${SEED})`).toBeGreaterThan(1);
  await page.clock.runFor(50);
  await expect(table).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('.event-log li')).toHaveCount(st.events_from + st.events.length);
  await expect(wallRemaining(page)).toHaveText(String(st.wall_remaining));
});

// A game whose first dealer is a CPU opens with the CPU turns before yours:
// before the first of them lands, the wall is the one they started from.
const CPU_DEALS = 13; // a seed whose first dealer is not you
test('the wall before the first CPU move of a round', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  const created = nextEngineReply(page, (call) => isRequest(call, 'POST', /^\/api\/games$/));
  await page.goto(`./?mode=game&seed=${CPU_DEALS}&first_dealer=random&length=tonpuu`);
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
  const first = (await created).data as GameState;
  if (first.events.length === 0 || first.events[0].seat === first.you) {
    throw new Error(`seed ${CPU_DEALS}: you deal first`);
  }
  await expect(table).toHaveAttribute('data-playing', 'true');
  await expect(page.locator('.event-log li')).toHaveCount(0);
  await expect(wallRemaining(page)).toHaveText(String(first.events_wall_remaining));
  await finishPlayback(page);
  await expect(wallRemaining(page)).toHaveText(String(first.wall_remaining));
});

// playbackState works the table out backwards from an answer's final
// state: the round result's deltas come off first (the settlement shows only
// once the playback ends), then each accepted riichi still to play gives its
// stick back. These tests patch the answer to your first action (your
// discard, then three CPU discards) into a round that ends in it, then check
// each step's points, deposit and ranks, and the final values once it is
// over.
const SEAT_BOXES = ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'];
const START = [25000, 25000, 25000, 25000];

/** Ranks by points, ties to the seat nearer the first dealer. */
function ranksOf(points: number[], firstDealer: number): number[] {
  const near = (s: number) => (s - firstDealer + 4) % 4;
  const order = [0, 1, 2, 3].sort((a, b) => points[b] - points[a] || near(a) - near(b));
  return [0, 1, 2, 3].map((s) => order.indexOf(s) + 1);
}

interface RoundEnd {
  // Turns the real answer into the patched one; `cpus` are the seats of
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
  // The events of the real answer, checked after the click, in the test
  // itself (a hook's error only shows once something waits on the engine).
  let real: string[] = [];
  onEngineReply(page, (call, reply) => {
    if (!isGameAction(call) || reply.status !== 200 || patched !== null) return;
    const st = reply.data as GameState;
    real = st.events.map((e) => e.type);
    patched = st;
    if (real.join() !== 'discard,discard,discard,discard') return;
    end.patch(st, st.events.slice(1).map((e) => e.seat));
    const ranks = end.ranks ?? ranksOf(st.seats.map((s) => s.points), st.first_dealer);
    for (const sd of st.standings) {
      sd.points = st.seats[sd.seat].points;
      sd.rank = ranks[sd.seat];
    }
  });
  await page.goto(GAME_URL);
  const hand = handPanel(page);
  await expect(hand.locator('.hand-drawn button')).toBeEnabled({ timeout: 15_000 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await act(page, hand.locator('.hand-drawn button'));
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

test.describe('touch', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  // A pick made before リーチ is toggled must not declare riichi with one tap.
  // The engine rarely offers riichi early, so its answers are patched to
  // offer it on the tile the test selects (no riichi is ever sent).
  test('toggling riichi drops a tap selection', async ({ page }) => {
    onEngineReply(page, (_call, reply) => {
      const body = reply.data as GameState | null;
      if (reply.status === 200 && body?.legal && body.phase === 'discard' && body.actor === body.you && body.legal.discards.length > 0) {
        const me = body.seats[body.you];
        body.legal.riichi = [me.drawn ?? body.legal.discards[0]];
      }
    });
    const calls = await engineCalls(page);
    await page.goto(`./?mode=game&seed=${SEED}&first_dealer=you`);
    await waitForPlayback(page);
    const hand = handPanel(page);
    const drawn = hand.locator('.hand-drawn button');
    await expect(drawn).toBeVisible();
    await calls(); // dealing the game

    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    await page.locator('.action-bar').getByRole('button', { name: 'リーチ' }).tap();
    await expect(page.locator('.action-bar').getByRole('button', { name: 'リーチ' })).toHaveAttribute('aria-pressed', 'true');
    await expect(hand.locator('.tile-picked')).toHaveCount(0);
    // One tap only selects the riichi tile again: nothing is sent.
    await drawn.tap();
    await expect(drawn).toHaveClass(/tile-picked/);
    expect((await calls()).filter((c) => /\/action(\?|$)/.test(c))).toEqual([]);
  });
});
