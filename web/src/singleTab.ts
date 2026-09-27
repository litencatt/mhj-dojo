// One tab per practice session or CPU game: the newest tab to open one wins
// and any other tab showing it stops (sends nothing more for it, and on the
// static site saves nothing more of it) until the player takes it back.
//
// A tab holds at most one id (a key: the id's API path, as api.ts builds
// it). Its claim, {key, tab, at}, goes two ways:
//
// - over a BroadcastChannel, to the tabs open now: any other tab holding
//   the same key compares the two claims, and the older one stops and says
//   so (an ack: it will never save again). The newer one answers an older
//   claim with its own, so two claims crossing each other still leave
//   exactly one tab.
// - into localStorage, the newest claim of each key, for a tab that missed
//   the message: frozen, or kept in the back/forward cache, perhaps while
//   the newer tab was opened and closed again. Such a tab reads the record
//   as it comes back into view and before each request and save, and stops
//   if the record is newer than its own claim. Silence is not consent.
//
// Two browsers don't see each other: there the server's 409 for a move on
// an out-of-date screen still applies.

// The status and message of a request refused because another tab has
// taken over its session or game: 423 Locked, never taken for a 409.
export const STOPPED = 423;
export const STOPPED_MESSAGE = 'このタブは別のタブで開かれたため停止しました';

interface Claim {
  key: string;
  tab: string;
  at: number; // when claimed: Date.now(), but always after any claim seen
}

// A message: a claim, or with stopped the ack of a tab that has just stopped.
type Message = Claim & { stopped?: true };

const TAB = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Math.random()}`.slice(2);
const RECORD = 'mhj-dojo.tabs'; // localStorage: key → its newest claim
const MAX_RECORDS = 20; // keys kept; the oldest claims go first
// How long a claim waits for the tab it stops to ack; no ack in that time
// means no other tab held the key (or it is frozen, and the record stops it).
const SETTLE_MS = 100;

let held: (Claim & { gen: number; stopped: boolean }) | null = null;
let gens = 0;
let latest = 0; // the newest at seen, this tab's own claims included
let settling: { key: string; done: Promise<void>; resolve: () => void } | null = null;
const listeners = new Set<(key: string, stopped: boolean) => void>();

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('mhj-dojo.tabs') : null;

// Whether claim a is newer than b; the tab id breaks a tie.
function newer(a: Claim, b: Claim): boolean {
  return a.at !== b.at ? a.at > b.at : a.tab > b.tab;
}

function records(): Record<string, Claim> {
  try {
    const r = JSON.parse(localStorage.getItem(RECORD) ?? 'null') as Record<string, Claim> | null;
    if (r && typeof r === 'object') return r;
  } catch {
    // unreadable or unavailable: the channel alone
  }
  return {};
}

// Records c as the newest claim of its key, unless one newer is there.
function record(c: Claim) {
  const all = records();
  if (all[c.key] && newer(all[c.key], c)) return;
  all[c.key] = { key: c.key, tab: c.tab, at: c.at };
  for (const k of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(MAX_RECORDS)) delete all[k];
  try {
    localStorage.setItem(RECORD, JSON.stringify(all));
  } catch {
    // storage refused: the channel alone
  }
}

function notify(key: string, stopped: boolean) {
  for (const fn of listeners) fn(key, stopped);
}

function stop() {
  if (!held || held.stopped) return;
  held.stopped = true;
  channel?.postMessage({ key: held.key, tab: held.tab, at: held.at, stopped: true } satisfies Message);
  notify(held.key, true);
}

// Stops this tab if a newer claim of its key was recorded.
function checkRecord() {
  if (!held || held.stopped) return;
  const r = records()[held.key];
  if (r && newer(r, held)) stop();
}

function announce() {
  if (held && !held.stopped) channel?.postMessage({ key: held.key, tab: held.tab, at: held.at } satisfies Message);
}

if (channel) {
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data as Message;
    latest = Math.max(latest, m.at);
    if (m.stopped) {
      if (settling?.key === m.key) settling.resolve();
      return;
    }
    if (!held || held.stopped || m.key !== held.key || m.tab === TAB) return;
    if (newer(m, held)) stop();
    else announce();
  };
}
const recheck = () => {
  if (document.visibilityState !== 'visible') return;
  checkRecord();
  announce();
};
document.addEventListener('visibilitychange', recheck);
window.addEventListener('pageshow', recheck);

/**
 * Claims key for this tab, stopping any other tab that holds it, and lets go
 * of the one this tab held before. Claiming the key this tab already holds
 * (and was not stopped on) does nothing. See settled for when the tab it
 * stops has stopped.
 */
export function claim(key: string) {
  if (held && held.key === key && !held.stopped) return;
  const r = records()[key];
  // After every claim seen, whatever the clock says.
  const at = Math.max(Date.now(), latest + 1, (r?.at ?? 0) + 1);
  latest = at;
  held = { key, tab: TAB, at, gen: ++gens, stopped: false };
  record(held);
  let resolve = () => {};
  const done = new Promise<void>((res) => {
    resolve = res;
    setTimeout(res, SETTLE_MS);
  });
  settling = { key, done, resolve };
  announce();
  notify(key, false);
}

/**
 * Resolves once the tab the last claim of key stopped has acked (it will
 * never save key again), or SETTLE_MS after the claim without one: what a
 * read of key's save waits for.
 */
export function settled(key: string): Promise<void> {
  return settling?.key === key ? settling.done : Promise.resolve();
}

/** Whether this tab was stopped on the key it holds. */
export function isStopped(): boolean {
  checkRecord();
  return !!held?.stopped;
}

/**
 * A token for a request on key, to check with live once it is answered: null
 * if this tab was stopped on key (the request must not be sent). 0 for a key
 * this tab doesn't hold: nothing to check it against.
 */
export function lease(key: string): number | null {
  if (held?.key !== key) return 0;
  checkRecord();
  return held.stopped ? null : held.gen;
}

/**
 * Whether a request made under l may still show or save its answer: this tab
 * was neither stopped on key since, nor claimed it again (which reloads it).
 */
export function live(key: string, l: number | null): boolean {
  return l !== null && lease(key) === l;
}

/**
 * Calls fn with the key each time this tab is stopped on it (stopped true)
 * or claims one (false); returns the unsubscribe.
 */
export function onChange(fn: (key: string, stopped: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
