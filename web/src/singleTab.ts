// One tab per practice session or CPU game: the newest tab to open one wins
// and any other tab showing it stops (sends nothing more for it, and on the
// static site saves nothing more of it) until the player takes it back.
//
// Tabs of one browser tell each other over a BroadcastChannel. A tab holds
// at most one id (a key: the id's API path, as api.ts builds it) and says so
// when it claims it: any other tab holding the same key compares the two
// claims, and the older one stops. The newer one answers an older claim with
// its own, so two claims crossing each other still leave exactly one tab.
// A tab also says so again when it comes back into view (it may have been
// frozen, or kept in the back/forward cache, while another tab claimed).
//
// Two browsers, or a browser without BroadcastChannel, don't see each other:
// there the server's 409 for a move on an out-of-date screen still applies.

// The status and message of a request refused because another tab has
// taken over its session or game: 423 Locked, never taken for a 409.
export const STOPPED = 423;
export const STOPPED_MESSAGE = 'このタブは別のタブで開かれたため停止しました';

interface Claim {
  key: string;
  tab: string;
  at: number; // Date.now() of the claim
}

const TAB = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Math.random()}`.slice(2);

let held: (Claim & { gen: number; stopped: boolean }) | null = null;
let gens = 0;
const listeners = new Set<(key: string) => void>();

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('mhj-dojo.tabs') : null;

// Whether claim a is newer than b; the tab id breaks a tie.
function newer(a: Claim, b: Claim): boolean {
  return a.at !== b.at ? a.at > b.at : a.tab > b.tab;
}

function announce() {
  if (held && !held.stopped) channel?.postMessage({ key: held.key, tab: held.tab, at: held.at } satisfies Claim);
}

if (channel) {
  channel.onmessage = (e: MessageEvent) => {
    const other = e.data as Claim;
    if (!held || held.stopped || other.key !== held.key || other.tab === TAB) return;
    if (newer(other, held)) {
      held.stopped = true;
      for (const fn of listeners) fn(held.key);
    } else {
      announce();
    }
  };
  const recheck = () => {
    if (document.visibilityState === 'visible') announce();
  };
  document.addEventListener('visibilitychange', recheck);
  window.addEventListener('pageshow', recheck);
}

/**
 * Claims key for this tab, stopping any other tab that holds it, and lets go
 * of the one this tab held before. Claiming the key this tab already holds
 * (and was not stopped on) does nothing.
 */
export function claim(key: string) {
  if (held && held.key === key && !held.stopped) return;
  held = { key, tab: TAB, at: Date.now(), gen: ++gens, stopped: false };
  announce();
}

/**
 * A token for a request on key, to check with live once it is answered: null
 * if this tab was stopped on key (the request must not be sent).
 */
export function lease(key: string): number | null {
  if (held?.key !== key) return 0;
  return held.stopped ? null : held.gen;
}

/**
 * Whether a request made under l may still show or save its answer: this tab
 * was neither stopped on key since, nor claimed it again (which reloads it).
 */
export function live(key: string, l: number | null): boolean {
  return l !== null && lease(key) === l;
}

/** Calls fn with the key each time another tab stops this one; returns the unsubscribe. */
export function onStop(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
