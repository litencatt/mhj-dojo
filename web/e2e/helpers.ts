import { expect, test, type Locator, type Page } from '@playwright/test';
import { initialProgress, STORAGE_KEY as DOJO_STORAGE_KEY, type DojoProgress } from '../src/dojo/progress.ts';

// What the specs share. The site's build runs its engine as WebAssembly in
// a Web Worker; the specs run on it as mhj-dojo serves it
// (playwright.config.ts).

/** A test that plays a whole round on the engine (WASM, some three times slower than native Go) gets three times its timeout. */
export function slowEngine() {
  test.slow(true, 'the engine runs as WebAssembly');
}

/**
 * Records what the page asks its engine from now on: the calls posted to
 * the engine's worker ("POST /api/sessions/…/discard?…", or the call's name,
 * such as "restore"). Call it before the page loads. The function it
 * returns takes the calls recorded since its last call.
 */
export async function engineCalls(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { engineCalls: string[] };
    w.engineCalls = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, m: { fn?: string; args?: string[] }) {
      if (m?.fn) w.engineCalls.push(m.fn === 'request' ? `${m.args?.[0]} ${m.args?.[1]}` : m.fn);
      return post.call(this, m as never);
    } as typeof Worker.prototype.postMessage;
  });
  return () => page.evaluate(() => (window as unknown as { engineCalls: string[] }).engineCalls.splice(0));
}

/** How many discards (POST …/discard) are among the calls engineCalls recorded since its last call. */
export async function discardsSent(calls: () => Promise<string[]>) {
  return (await calls()).filter((c) => /^POST \S+\/discard(\?|$)/.test(c)).length;
}

/** The header's version: a commit and its build's date, or on a release its tag. */
export function versionPattern() {
  return /^(v\d{4}\.\d{4}\.\d+|(dev|[0-9a-f]{7})( · \d{4}-\d{2}-\d{2})?)$/;
}

export function handPanel(page: Page) {
  return page.getByRole('region', { name: '手牌' });
}

/** A call the page made to its engine: fn 'request' with the method and path (with the engine's own ids), or 'restore' / 'restoreGame' rebuilding a save. */
export interface EngineCall {
  id: number;
  fn: string;
  method?: string;
  path?: string;
}

/** The engine's answer to a call: its status and its parsed JSON body. */
export interface EngineReply {
  status: number;
  data: any; // a state the test reads and patches as it likes
}

type ReplyHook = (call: EngineCall, reply: EngineReply) => void;

interface Watch {
  hooks: ReplyHook[];
  // The replies waited for, by worker and call id (ids restart with each
  // worker: a reload, or the engine restarted), until the page has them.
  delivered: Map<string, () => void>;
  // The first error a hook threw: the page got that reply unchanged, and
  // nextEngineReply and engineSession throw it.
  error: unknown;
  failed: ((err: unknown) => void)[];
}

const watches = new WeakMap<Page, Watch>();

/**
 * Lets the test see, and change, the engine's answers before the page does,
 * as page.route does with a server's responses: see onEngineReply and
 * nextEngineReply. Call it before the page loads (the engine's worker must
 * start with the hook in place); it lasts across reloads.
 */
export async function watchEngine(page: Page) {
  if (watches.has(page)) return;
  const watch: Watch = { hooks: [], delivered: new Map(), error: undefined, failed: [] };
  watches.set(page, watch);
  await page.exposeFunction('__mhjEngineReply', (call: EngineCall & { worker: number }, reply: EngineReply) => {
    for (const hook of [...watch.hooks]) {
      try {
        hook(call, reply);
      } catch (err) {
        if (watch.error === undefined) {
          watch.error = err;
          console.error('onEngineReply hook failed:', err);
          for (const fail of watch.failed.splice(0)) fail(err);
        }
      }
    }
    return reply;
  });
  await page.exposeFunction('__mhjEngineDelivered', (worker: number, id: number) => {
    const key = `${worker}:${id}`;
    watch.delivered.get(key)?.();
    watch.delivered.delete(key);
  });
  await page.addInitScript(() => {
    type Message = { id?: number; fn?: string; args?: string[]; status?: number; body?: string; save?: string };
    const w = window as unknown as {
      Worker: typeof Worker;
      __mhjEngineReply: (call: object, reply: { status: number; data: unknown }) => Promise<{ status: number; data: unknown }>;
      __mhjEngineDelivered: (worker: number, id: number) => void;
      __mhjAsk?: (method: string, path: string) => Promise<unknown>;
      __mhjCall?: (fn: string, args: string[]) => Promise<Message>;
      __mhjSession?: string;
    };
    const Native = w.Worker;
    let asked = 1e9; // ids of the test's own calls (engineSession), past any of the page's
    let workers = 0; // the page's workers so far: call ids restart with each
    w.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const worker = ++workers;
        const calls = new Map<number, Message>();
        const asks = new Map<number, (reply: Message) => void>();
        const post = this.postMessage.bind(this) as (m: Message) => void;
        this.postMessage = ((m: Message) => {
          if (typeof m?.id === 'number') calls.set(m.id, m);
          post(m);
        }) as typeof this.postMessage;
        w.__mhjCall = (fn, args) =>
          new Promise((resolve) => {
            const id = asked++;
            asks.set(id, resolve);
            post({ id, fn, args });
          });
        w.__mhjAsk = async (method, path) => {
          const data = await w.__mhjCall!('request', [method, path, '']);
          if (data.status !== 200) throw new Error(`the engine answered ${data.status}: ${data.body}`);
          return JSON.parse(data.body!);
        };
        // The page's onmessage gets each message once the test has seen it,
        // in the order the engine sent them.
        let handler: ((e: MessageEvent) => void) | null = null;
        Object.defineProperty(this, 'onmessage', { get: () => handler, set: (h) => (handler = h) });
        let order = Promise.resolve();
        this.addEventListener('message', (e: MessageEvent) => {
          order = order.then(async () => {
            let data = e.data as Message;
            const id = data?.id;
            if (typeof id === 'number' && asks.has(id)) {
              asks.get(id)!(data);
              asks.delete(id);
              return;
            }
            const call = typeof id === 'number' ? calls.get(id) : undefined;
            if (call) {
              calls.delete(id!);
              const [method, path] = call.fn === 'request' ? call.args ?? [] : [];
              try {
                const reply = await w.__mhjEngineReply({ id, worker, fn: call.fn, method, path }, { status: data.status!, data: JSON.parse(data.body!) });
                const session = (reply.data as { session_id?: string } | null)?.session_id;
                if (reply.status === 200 && session) w.__mhjSession = session;
                data = { ...data, status: reply.status, body: JSON.stringify(reply.data) };
              } catch {
                // The test could not look at it (the page is closing, say):
                // the page gets the engine's answer as it was.
              }
            }
            handler?.call(this, new MessageEvent('message', { data }));
            if (call) w.__mhjEngineDelivered(worker, id!);
          });
        });
      }
    };
  });
}

function watching(page: Page) {
  const watch = watches.get(page);
  if (!watch) throw new Error('watchEngine(page) must run before the page loads');
  return watch;
}

/**
 * Calls hook on each of the engine's answers before the page gets it: the
 * hook may change reply (its status, or its data in place), and the page
 * gets the changed one. A practice session's 200 is what the page saves to
 * localStorage as it got it, patches included; a CPU game's save is the
 * engine's own, whatever the hook changes. A hook that throws leaves that
 * reply unchanged, and nextEngineReply and engineSession then throw its
 * error. Returns a function that removes the hook.
 */
export function onEngineReply(page: Page, hook: ReplyHook) {
  const { hooks } = watching(page);
  hooks.push(hook);
  return () => {
    const i = hooks.indexOf(hook);
    if (i >= 0) hooks.splice(i, 1);
  };
}

/**
 * The engine's next answer to a call that match accepts, as the page got
 * it (after any onEngineReply hook), once the page has it: the site's
 * page.waitForResponse. Call it before the click that makes the call.
 */
export function nextEngineReply(page: Page, match: (call: EngineCall) => boolean): Promise<EngineReply> {
  const watch = watching(page);
  if (watch.error !== undefined) return Promise.reject(watch.error);
  return new Promise((resolve, reject) => {
    watch.failed.push(reject);
    const hook: ReplyHook = (call, reply) => {
      if (!match(call)) return;
      watch.hooks.splice(watch.hooks.indexOf(hook), 1);
      const { worker } = call as EngineCall & { worker: number };
      watch.delivered.set(`${worker}:${call.id}`, () => {
        watch.failed.splice(watch.failed.indexOf(reject), 1);
        resolve(reply);
      });
    };
    watch.hooks.push(hook);
  });
}

/** Whether a call is a request with this method, its path (query left out) matching path. */
export function isRequest(call: EngineCall, method: string, path: RegExp) {
  return call.fn === 'request' && call.method === method && path.test(call.path!.split('?')[0]);
}

/** A CPU game's action (POST /api/games/{id}/action). */
export function isGameAction(call: EngineCall) {
  return isRequest(call, 'POST', /^\/api\/games\/[^/]+\/action$/);
}

/**
 * The whole state of the page's practice session as the engine has it, with
 * nothing left out (the view the page doesn't ask for): the test's own call
 * to the page's engine, which the page never sees. Needs watchEngine.
 */
export async function engineSession<T>(page: Page): Promise<T> {
  const watch = watching(page);
  await expect(page).toHaveURL(/[?&]session=/);
  await page.waitForFunction(() => !!(window as unknown as { __mhjSession?: string }).__mhjSession);
  if (watch.error !== undefined) throw watch.error;
  return (await page.evaluate(async () => {
    const w = window as unknown as { __mhjAsk: (m: string, p: string) => Promise<unknown>; __mhjSession: string };
    return w.__mhjAsk('GET', `/api/sessions/${encodeURIComponent(w.__mhjSession)}`);
  })) as T;
}

/** The tiles' names in the hand panel's hand (.hand-tiles) or river (.discard-river), in order. */
export function labels(page: Page, selector: string) {
  return handPanel(page)
    .locator(`${selector} .tile`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

/** Discards the drawn tile in practice mode and waits for it in the river; returns its name. */
export async function discardDrawn(page: Page) {
  const hand = handPanel(page);
  const river = hand.locator('.discard-river .tile');
  const before = await river.count();
  const drawn = hand.locator('.hand-drawn button');
  await expect(drawn).toBeEnabled();
  const tile = await drawn.getAttribute('aria-label');
  await drawn.click();
  await expect(river).toHaveCount(before + 1);
  return tile;
}

// One tab of a browser at a time plays a session or a game
// (src/singleTab.ts): the newest tab to open it wins, and the one before
// stops until taken back.
export function stoppedDialog(page: Page) {
  return page.getByRole('alertdialog', { name: 'このタブは別のタブで開かれたため停止しました' });
}

/** The dialog covers the page: shown modal, so everything else is inert. */
export async function expectStopped(page: Page) {
  await expect(stoppedDialog(page)).toBeVisible();
  expect(await stoppedDialog(page).evaluate((d) => d.matches(':modal'))).toBe(true);
}

/** The page's sideways overflow: above 0 means it scrolls sideways. */
export function pageOverflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

// The CPU game.

// A seed where a "tsumogiri" strategy (discard the tile you just drew; with
// no drawn tile, right after a call, discard the last hand tile), skipping
// every non-pon call offer, is offered a pon within a couple of your turns.
// Guarded by TestE2ESeedOffersPon in internal/apicall/e2e_seeds_test.go: if game
// logic changes and it fails, pick a new seed as its message says.
export const SEED = 12;

// Dojo seeds (DOJO_RIICHI_SEED: riichi offered; DOJO_REDRAW_SEED: redraw
// offered), guarded by internal/apicall/e2e_seeds_test.go.
export const DOJO_RIICHI_SEED = 162;
export const DOJO_REDRAW_SEED = 1;
export const DOJO_SUMMON_SEED = 1; // a summon offered within 3 tsumogiri moves (e2e_seeds_test.go)
export const DOJO_NOYAKU_SEED = 16379; // a new dojo's hand is tenpai without a learned yaku's row (e2e_seeds_test.go)
export const DOJO_RIICHIWAITS_SEED = 221; // a CPU riichi's waits show within 3 tsumogiri moves (e2e_seeds_test.go)
export const DOJO_WIN_SEED = 11896; // a new dojo wins the first round by tsumogiri, with han (e2e_seeds_test.go)
export const DOJO_CALLED_NOYAKU_SEED = 308; // a new dojo's hand, taking a pon, is open and tenpai without a learned yaku's row (e2e_seeds_test.go)

/**
 * Opens a dojo game (?mode=dojo&play=1) on a seed. The dojo's progress is
 * set first (`progress` over the initial one), but only while the browser has
 * none yet, so that a reload keeps what the page has stored since. Call it
 * once per page, before anything else loads.
 */
export async function newDojoGame(page: Page, seed: number, progress: Partial<DojoProgress> = {}) {
  const stored = JSON.stringify({ ...initialProgress(), ...progress });
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    [DOJO_STORAGE_KEY, stored],
  );
  await page.goto(`./?mode=dojo&play=1&seed=${seed}`);
  await expect(handPanel(page)).toBeVisible();
}

/** The dojo's progress as the page has it stored. */
export function dojoProgress(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as DojoProgress | null, DOJO_STORAGE_KEY);
}

/**
 * Plays the page's dojo game (?game=) to its end at once, then reloads the
 * page on it at its 最終結果: the engine replays the game's save and plays on
 * as nextMove does (tsumo or ron when offered, skip a call offer, discard the
 * drawn tile or else the last one; 次の局へ between the rounds), and the
 * finished game's save replaces the page's. The page sees only the reload,
 * as after a game ended in another tab. Needs watchEngine.
 */
export async function finishDojoGame(page: Page) {
  watching(page);
  const id = new URL(page.url()).searchParams.get('game');
  if (!id) throw new Error('the page has no game yet');
  await waitForPlayback(page);
  await page.evaluate(
    async ([key, id]) => {
      type Reply = { status?: number; body?: string; save?: string };
      const w = window as unknown as { __mhjCall: (fn: string, args: string[]) => Promise<Reply> };
      const saved = JSON.parse(localStorage.getItem(key)!);
      let reply = await w.__mhjCall('restoreGame', [saved.games[id].save, '']);
      for (let i = 0; ; i++) {
        if (reply.status !== 200 || i > 1500) throw new Error(`the game did not play to its end: ${reply.status} ${reply.body}`);
        const st = JSON.parse(reply.body!);
        if (st.game_over) {
          const round = { wind: st.round_wind, number: st.round_number, honba: st.honba, over: true };
          saved.games[id] = { save: reply.save, used: Date.now(), round };
          localStorage.setItem(key, JSON.stringify(saved));
          return;
        }
        const l = st.legal;
        const move = st.can_next
          ? { type: 'next' }
          : l.tsumo
            ? { type: 'tsumo' }
            : l.ron
              ? { type: 'ron' }
              : l.skip
                ? { type: 'skip' }
                : { type: 'discard', tile: st.seats[st.you].drawn ?? l.discards[l.discards.length - 1] };
        reply = await w.__mhjCall('request', ['POST', `/api/games/${st.game_id}/action`, JSON.stringify(move)]);
      }
    },
    ['mhj-dojo.site.dojo-games', id],
  );
  await page.reload();
  await expect(page.getByRole('region', { name: '最終結果' })).toBeVisible();
}

/** Waits until the CPU moves have finished replaying: while they replay,
 * the action bar shows only a hint. */
export async function waitForPlayback(page: Page) {
  await expect(page.locator('.game-table')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });
}

/** With the page clock installed: runs it until the CPU moves have finished replaying. */
export async function finishPlayback(page: Page) {
  const table = page.locator('.game-table');
  for (let i = 0; i < 100 && (await table.getAttribute('data-playing')) === 'true'; i++) {
    await page.clock.runFor(1000);
  }
  await expect(table).toHaveAttribute('data-playing', 'false');
}

/** Everything a game action changes: the table (rivers, points), the hand, the result panel and the wall left (in the header, or over the hand on a phone). */
export async function gameSnapshot(page: Page) {
  const status = page.locator('.header-status');
  return `${(await status.count()) > 0 ? await status.innerText() : ''}\n${await page.locator('.area-hand').innerText()}`;
}

/** Clicks and waits until the engine has answered, so the next step never
 * races a request still in flight: until the table, the hand or the result
 * panel changes (the site saves the game before it shows the answer). The
 * CPU moves may still be playing back: callers that need them over wait for
 * that. */
export async function clickAndWait(page: Page, locator: Locator) {
  const before = await gameSnapshot(page);
  await locator.click();
  await expect.poll(() => gameSnapshot(page), { timeout: 30_000, intervals: [10, 20, 50, 100] }).not.toBe(before);
}

/** The control for one generic step: tsumo or ron when offered, otherwise
 * skip/見逃す any call offer (callers wanting a pon check for it first),
 * otherwise tsumogiri (discard the tile you just drew, or with none, right
 * after a call, the last hand tile). Mirrors nextMove() in route_games_test.go,
 * except for the discard rule, which is playTsumogiriUntilPon's
 * (internal/apicall/e2e_seeds_test.go, guarding SEED). */
export async function nextMove(page: Page): Promise<Locator> {
  await waitForPlayback(page);
  const actionBar = page.locator('.action-bar');
  await actionBar.waitFor({ state: 'visible', timeout: 15_000 });
  const tsumo = actionBar.getByRole('button', { name: 'ツモ', exact: true });
  const ron = actionBar.getByRole('button', { name: 'ロン', exact: true });
  const skip = actionBar.getByRole('button', { name: /^(見逃す|スキップ)$/ });
  for (const candidate of [tsumo, ron, skip]) {
    if (await candidate.isVisible()) return candidate;
  }
  const hand = handPanel(page);
  const drawn = hand.locator('.hand-drawn button');
  const tile = (await drawn.count()) > 0 ? drawn : hand.locator('.hand-tiles button').last();
  await expect(tile).toBeEnabled({ timeout: 15_000 });
  return tile;
}

export async function playOneStep(page: Page) {
  await clickAndWait(page, await nextMove(page));
}

/** Plays generic steps until a pon is offered, without resolving it: used
 * to get two pages looking at the exact same call offer before either of
 * them acts on it. */
export async function playUntilPonOffered(page: Page, maxSteps = 60) {
  const actionBar = page.locator('.action-bar');
  // Exact: 結果 also matches 最終結果, which shows with the last round's result.
  const result = page.getByRole('region', { name: '結果', exact: true });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await result.isVisible()) {
      throw new Error(`round ended (seed ${SEED}) before a pon was ever offered`);
    }
    await actionBar.waitFor({ state: 'visible', timeout: 15_000 });
    if (await actionBar.getByRole('button', { name: 'ポン', exact: true }).isVisible()) {
      return;
    }
    await playOneStep(page);
  }
  throw new Error(`no pon offered within ${maxSteps} steps (seed ${SEED})`);
}

/** Plays generic steps until the round's result panel appears. */
export async function playToResult(page: Page, maxSteps = 150) {
  const result = page.getByRole('region', { name: '結果', exact: true });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await result.isVisible()) return;
    await playOneStep(page);
  }
  throw new Error(`round did not reach a result panel within ${maxSteps} steps`);
}

/** Plays the game on the page to its end (最終結果), round by round with 次の局へ: no engine shortcut. */
export async function playGameToEnd(page: Page, maxSteps = 1500) {
  const result = page.getByRole('region', { name: '結果', exact: true });
  const final = page.getByRole('region', { name: '最終結果' });
  const next = result.getByRole('button', { name: '次の局へ' });
  for (let i = 0; i < maxSteps; i++) {
    await waitForPlayback(page);
    if (await final.isVisible()) return;
    if (await next.isVisible()) await clickAndWait(page, next);
    else await playOneStep(page);
  }
  throw new Error(`game did not reach 最終結果 within ${maxSteps} steps`);
}

/** Every river, your hand and the status line: what a reload or another tab must show the same. */
export async function tableState(page: Page) {
  const tiles = (sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  return {
    rivers: await Promise.all(
      ['.seat-bottom', '.seat-right', '.seat-top', '.seat-left'].map((s) => tiles(`${s} .seat-river .tile`)),
    ),
    hand: await tiles('.area-hand .hand-row .tile'),
    status: await page.locator('.game-status').innerText(),
  };
}

/** Opens the header's 設定 (every mode has one) and returns its dialog. */
export async function openSettings(page: Page): Promise<Locator> {
  await page.locator('.app-header').getByRole('button', { name: '設定', exact: true }).click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The 設定 dialog, open or not. */
export function settingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: '設定' });
}

/** The radio buttons of a choice in 設定 (再生速度, 対局 ...), by its name. */
export function settingsChoice(page: Page, name: string): Locator {
  return settingsDialog(page).getByRole('group', { name, exact: true }).getByRole('radio');
}

/** The 設定 checkbox that folds the other seats' rivers away on a phone. */
export function riversOption(page: Page): Locator {
  return settingsDialog(page).getByRole('checkbox', { name: '他家の捨て牌' });
}

/** Folds the other seats' rivers away (or back) through 設定, closing it after. */
export async function toggleRivers(page: Page) {
  await openSettings(page);
  await riversOption(page).click();
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toBeHidden();
}

/** The wall left as shown: in the header, or on a phone over the hand. Both copies are in the page, one
 * hidden: always look for the displayed one (this, or a `visible: true` filter for the dora). */
export function wallRemaining(page: Page): Locator {
  return page.getByTestId('wall-remaining').filter({ visible: true });
}
