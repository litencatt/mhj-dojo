// The static site's transport (issue #67): instead of calling the mhj-dojo
// server, API requests go to the engine compiled to WebAssembly, running in
// a Web Worker (site-public/worker.js). Only built into the site (`npm run
// build:site`); see api.ts.
//
// The engine keeps practice sessions and CPU games in the worker's memory,
// which a reload loses (and it evicts all but a few), so each one is also
// saved to localStorage (a session's moves, a game's save from the engine)
// and replayed when the page asks for one the worker doesn't hold. The
// replayed one keeps the id the page knows it by (its public id), whatever id
// the engine gave it this time, so URLs and bookmarks keep working.
//
// Each tab runs its own worker, but the saves are shared: when another tab
// has saved a newer version of a session or game, this tab rebuilds its copy
// from that save before acting on it, and refuses (409) a move the player
// chose on the out-of-date screen, as the server does for two tabs on the
// same session. The page then re-fetches and shows the newer state.

import type { GameState, SessionState } from './api';

export interface WasmResponse {
  status: number;
  data: unknown; // the parsed JSON body
  save?: string; // a CPU game's save (JSON), on its successful responses
}

interface Reply {
  id: number;
  status: number;
  body: string;
  save?: string;
}

let engine: Promise<Worker> | null = null;
// Gives up on the current worker (see start's fail); null before the first.
let abandon: ((message: string) => void) | null = null;
let nextId = 1;
const pending = new Map<number, (r: Reply) => void>();

// How long one call may take before the engine counts as hung. The longest
// legitimate calls are a rebuild from a save (a whole 半荘戦 replays in well
// under a second on a phone) and a round of CPU turns; nothing takes seconds.
const CALL_TIMEOUT_MS = 60_000;

// Starts the worker on first use. The measure 'mhj-dojo:wasm-init' records how
// long the download, compile and start of the engine took. If the engine
// fails to start, or exits later, the next request starts a new worker;
// the sessions it held are rebuilt from their saves as they are asked for.
function start(): Promise<Worker> {
  if (engine) return engine;
  const started: Promise<Worker> = new Promise<Worker>((resolve, reject) => {
    const t0 = performance.now();
    const url = new URL('worker.js', document.baseURI);
    // A hash of the worker, wasm_exec.js and mhj-dojo.wasm (vite.config.ts), so a
    // deploy never mixes cached and new copies of them.
    const version = import.meta.env.VITE_MHJDOJO_ENGINE as string | undefined;
    if (version) url.searchParams.set('v', version);
    const w = new Worker(url);
    const fail = (message: string) => {
      w.terminate();
      if (engine !== started) return; // an old worker, already replaced
      engine = null;
      abandon = null;
      forgetEngine();
      reject(new Error(message)); // no-op once it had started
      for (const [id, done] of pending) done({ id, status: 500, body: JSON.stringify({ error: message }) });
      pending.clear();
    };
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; error?: string } & Partial<Reply>;
      if (m.type === 'ready') {
        try {
          performance.measure('mhj-dojo:wasm-init', { start: t0, end: performance.now() });
        } catch {
          // measuring is best effort
        }
        resolve(w);
      } else if (m.type === 'failed') {
        fail(`計算エンジンを起動できませんでした: ${m.error}`);
      } else if (typeof m.id === 'number') {
        pending.get(m.id)?.(m as Reply);
        pending.delete(m.id);
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      fail(`計算エンジンを読み込めませんでした${e.message ? `: ${e.message}` : ''}`);
    };
    w.onmessageerror = () => fail('計算エンジンの応答を読めませんでした');
    abandon = fail;
  });
  engine = started;
  return started;
}

async function call(fn: 'request' | 'restore' | 'restoreGame', ...args: string[]): Promise<WasmResponse> {
  const w = await start();
  const id = nextId++;
  const reply = await new Promise<Reply>((resolve) => {
    // A call the engine never answers (it hung, or looped) would leave the
    // page waiting forever: past the timeout the worker is given up, this
    // and any other pending call fail with a 500, and the next request
    // starts a new worker and rebuilds what it needs from the saves.
    const timer = setTimeout(() => {
      if (pending.has(id)) abandon?.('計算エンジンが応答しません');
    }, CALL_TIMEOUT_MS);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage({ id, fn, args });
  });
  return { status: reply.status, data: JSON.parse(reply.body) as unknown, save: reply.save };
}

const SESSIONS = '/api/sessions';
const STORAGE_KEY = 'mhj-dojo.site.practice';
const MAX_SAVED = 10; // sessions kept; the least recently used goes first

// A session as its moves: node i+1 was made from moves[i], from its parent
// node by discarding tile (no tile: tsumo). Node ids follow creation order,
// so replaying the moves in order rebuilds the same tree with the same ids.
interface Saved {
  seed: number;
  max_turns: number;
  moves: { parent: number; tile?: string }[];
  current: number;
  used: number; // Date.now() of the last save
}

type SavedMap = Record<string, Saved>; // by public session id

function loadAll(): SavedMap {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { v?: number; sessions?: SavedMap } | null;
    if (s?.v === 2 && s.sessions && typeof s.sessions === 'object') return s.sessions;
  } catch {
    // unreadable: treat as nothing saved
  }
  return {};
}

let warnedStorage = false;

// Writes saves to localStorage. When that fails (most likely the quota),
// keeps only the one just saved (keep) and tries once more; if storage
// still refuses, the saves go stale (a reload starts over from the URL's
// seed), which is worth one warning. Without a keep (dropping a save) the
// stale saves stay as they are rather than being wiped for a smaller write.
// Returns whether keep (or, without one, everything) was stored.
function write<T>(
  key: string,
  saved: Record<string, T>,
  wrap: (saved: Record<string, T>) => unknown,
  keep?: string,
): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(wrap(saved)));
    return true;
  } catch {
    // retried below with fewer saves
  }
  if (keep !== undefined && keep in saved) {
    try {
      localStorage.setItem(key, JSON.stringify(wrap({ [keep]: saved[keep] })));
      return true;
    } catch {
      // storage unavailable
    }
  }
  if (!warnedStorage) {
    warnedStorage = true;
    console.warn('mhj-dojo: cannot save to localStorage; a reload will start over from the URL');
  }
  return false;
}

function storeAll(sessions: SavedMap, keep?: string): boolean {
  return write(STORAGE_KEY, sessions, (s) => ({ v: 2, sessions: s }), keep);
}

// Drops all but the max most recently used entries.
function trim<T extends { used: number }>(saved: Record<string, T>, max: number) {
  const ids = Object.keys(saved).sort((a, b) => (saved[b].used ?? 0) - (saved[a].used ?? 0));
  for (const id of ids.slice(max)) delete saved[id];
}

function saveSession(publicId: string, st: SessionState): boolean {
  const sessions = loadAll();
  sessions[publicId] = {
    seed: st.seed,
    max_turns: st.max_turns,
    moves: [...st.tree]
      .sort((a, b) => a.node_id - b.node_id)
      .slice(1)
      .map((n) => (n.status === 'tsumo' ? { parent: n.parent_id ?? 0 } : { parent: n.parent_id ?? 0, tile: n.discard ?? '' })),
    current: st.node_id,
    used: Date.now(),
  };
  trim(sessions, MAX_SAVED);
  return storeAll(sessions, publicId);
}

function forgetSession(publicId: string) {
  const sessions = loadAll();
  delete sessions[publicId];
  storeAll(sessions);
}

const GAMES = '/api/games';
const GAMES_KEY = 'mhj-dojo.site.games';
const MAX_SAVED_GAMES = 5; // games kept; the least recently used goes first

// A CPU game as the engine's own save (the match descriptor: seed, options
// and every action so far), kept as the JSON the engine gave, which
// mhjDojoRestoreGame replays.
interface SavedGame {
  save: string;
  used: number; // Date.now() of the last save
}

type SavedGames = Record<string, SavedGame>; // by public game id

function loadGames(): SavedGames {
  try {
    const s = JSON.parse(localStorage.getItem(GAMES_KEY) ?? 'null') as { v?: number; games?: SavedGames } | null;
    if (s?.v === 1 && s.games && typeof s.games === 'object') return s.games;
  } catch {
    // unreadable: treat as nothing saved
  }
  return {};
}

function storeGames(games: SavedGames, keep?: string): boolean {
  return write(GAMES_KEY, games, (g) => ({ v: 1, games: g }), keep);
}

function saveGame(publicId: string, save: string): boolean {
  const games = loadGames();
  games[publicId] = { save, used: Date.now() };
  trim(games, MAX_SAVED_GAMES);
  return storeGames(games, publicId);
}

function forgetGame(publicId: string) {
  const games = loadGames();
  delete games[publicId];
  storeGames(games);
}

// What the page keeps in the engine: practice sessions and CPU games. Each
// is known to the page by its public id, the id the engine first gave it;
// one rebuilt from its save gets a new engine id, mapped here. A new worker
// starts the maps over.
interface Kind {
  base: string; // the collection's path
  noun: string; // as in the engine's "not found: session ..." errors
  restoreFn: 'restore' | 'restoreGame';
  saved: (publicId: string) => string | null; // the restore body
  content: (saved: string) => string; // a restore body without its bookkeeping (when it was last used)
  refuseStale: boolean; // a move on an out-of-date copy gets a 409 (the engine can't tell)
  save: (publicId: string, res: WasmResponse) => boolean; // whether it was stored
  forget: (publicId: string) => void;
  idOf: (data: unknown) => string;
  setId: (data: unknown, id: string) => void;
  engineOf: Map<string, string>; // public id → engine id
  publicOf: Map<string, string>; // engine id → public id
  known: Set<string>; // engine ids the current worker holds
  failures: Map<string, number>; // public id → restores in a row the engine failed (500)
  // public id → the content of its save as this tab last wrote or rebuilt
  // it (null: none); a different save is another tab's. Kept across workers.
  seen: Map<string, string | null>;
}

const kinds: Kind[] = [
  {
    base: SESSIONS,
    noun: 'session',
    restoreFn: 'restore',
    saved: (id) => {
      const s = loadAll()[id];
      return s ? JSON.stringify(s) : null;
    },
    content: (saved) => {
      const s = JSON.parse(saved) as Saved;
      return JSON.stringify([s.seed, s.max_turns, s.moves, s.current]);
    },
    // A discard or tsumo names the node it was chosen on (node_id), and the
    // engine refuses it (409) if the session has moved on from there.
    refuseStale: false,
    save: (id, res) => saveSession(id, res.data as SessionState),
    forget: forgetSession,
    idOf: (d) => (d as SessionState).session_id,
    setId: (d, id) => ((d as SessionState).session_id = id),
    engineOf: new Map(),
    publicOf: new Map(),
    known: new Set(),
    failures: new Map(),
    seen: new Map(),
  },
  {
    base: GAMES,
    noun: 'game',
    restoreFn: 'restoreGame',
    saved: (id) => {
      const g = loadGames()[id];
      return typeof g?.save === 'string' ? g.save : null;
    },
    // Without the check digest, which a save from before it had none of and
    // a rebuild adds: the moves alone say whether the game moved on.
    content: (saved) => {
      try {
        return JSON.stringify(JSON.parse(saved), (k, v: unknown) => (k === 'check' ? undefined : v));
      } catch {
        return saved;
      }
    },
    // A game's actions don't say which state they were chosen on.
    refuseStale: true,
    save: (id, res) => {
      // "" when the response isn't a game state: keep the save there is.
      return !!res.save && saveGame(id, res.save);
    },
    forget: forgetGame,
    idOf: (d) => (d as GameState).game_id,
    setId: (d, id) => ((d as GameState).game_id = id),
    engineOf: new Map(),
    publicOf: new Map(),
    known: new Set(),
    failures: new Map(),
    seen: new Map(),
  },
];

function forgetEngine() {
  for (const k of kinds) {
    k.engineOf.clear();
    k.publicOf.clear();
    k.known.clear();
  }
}

// The kind and id in a {base}/{id}[/op] path, and the path with the id
// swapped for another.
function splitPath(path: string): { kind: Kind; id: string; with: (id: string) => string } | null {
  for (const kind of kinds) {
    if (!path.startsWith(`${kind.base}/`)) continue;
    const m = /^([^/]+)(\/.*)?$/.exec(path.slice(kind.base.length + 1));
    if (!m) return null;
    const id = decodeURIComponent(m[1]);
    return { kind, id, with: (other) => `${kind.base}/${encodeURIComponent(other)}${m[2] ?? ''}` };
  }
  return null;
}

// Notes the save of publicId, just written, as this tab's own.
function see(kind: Kind, publicId: string) {
  const saved = kind.saved(publicId);
  kind.seen.set(publicId, saved === null ? null : kind.content(saved));
}

// Whether another tab has saved publicId since this tab last did.
function savedElsewhere(kind: Kind, publicId: string): boolean {
  if (!kind.seen.has(publicId)) return false;
  const saved = kind.saved(publicId);
  return saved !== null && kind.content(saved) !== kind.seen.get(publicId);
}

// The localStorage keys of the saves, whose 'storage' events tell a tab that
// another one saved.
export const SAVE_KEYS: readonly string[] = [STORAGE_KEY, GAMES_KEY];

/**
 * Whether another tab has moved on the session or game at path (an API
 * path, as for wasmRequest) since this tab last saw it, so the page can show
 * the newer state.
 */
export function wasmSavedElsewhere(path: string): boolean {
  const target = splitPath(path);
  return target !== null && savedElsewhere(target.kind, target.id);
}

const MAX_RESTORE_FAILURES = 2;

// Rebuilds a saved session or game in the engine under its public id and
// returns the engine's response: its state, or an error. A save the engine
// rejects (400/404/409/422) is dropped, and null returned: the request then
// gets the engine's 404 and the page deals afresh from the URL's seed. Any
// other failure (the engine broke) keeps the save for the next try, unless
// the engine failed on it MAX_RESTORE_FAILURES times in a row: the save may
// be what breaks it, so it is dropped (the error is still returned).
// With keep (a save another tab wrote) any failure just returns the error
// and leaves the save alone: that tab may run a newer engine than this one.
async function restore(kind: Kind, publicId: string, keep = false): Promise<WasmResponse | null> {
  const saved = kind.saved(publicId);
  if (saved === null) return null;
  const res = await call(kind.restoreFn, saved);
  if (res.status === 200) {
    const id = kind.idOf(res.data);
    // The copy it replaces is gone: evicted, in a stopped worker, or out of
    // date and left in the engine until it evicts it (the least recently
    // used goes first).
    const old = kind.engineOf.get(publicId);
    if (old !== undefined) {
      kind.publicOf.delete(old);
      kind.known.delete(old);
    }
    kind.engineOf.set(publicId, id);
    kind.publicOf.set(id, publicId);
    kind.known.add(id);
    kind.failures.delete(publicId);
    kind.seen.set(publicId, kind.content(saved));
  } else if (keep) {
    return res;
  } else if ([400, 404, 409, 422].includes(res.status)) {
    kind.failures.delete(publicId);
    kind.forget(publicId);
    kind.seen.delete(publicId);
    return null;
  } else {
    const failures = (kind.failures.get(publicId) ?? 0) + 1;
    kind.failures.set(publicId, failures);
    if (failures >= MAX_RESTORE_FAILURES) {
      kind.failures.delete(publicId);
      kind.forget(publicId);
      kind.seen.delete(publicId);
    }
  }
  return res;
}

let queue: Promise<unknown> = Promise.resolve();

// The 409 for a move chosen on a screen another tab has since moved on from.
const MOVED_ON = '別の画面で進んだため、この操作は行いませんでした';
// The 409 when this tab's engine can't rebuild another tab's save (most
// likely that tab runs a newer version of the site).
const NEWER_SAVE = '別の画面で新しい版に保存されています。再読み込みしてください';

// Rebuilds target from the save another tab wrote since this tab last saw
// it. Returns the answer to the request: the rebuilt state for a GET, a 409
// for a move of a kind that refuses one on an out-of-date copy, or null to
// send the request to the rebuilt copy. A save this tab can't rebuild stays
// for the other tab (and a reload); the request gets a 409 meanwhile rather
// than going to the out-of-date copy.
async function catchUp(kind: Kind, publicId: string, isGet: boolean): Promise<WasmResponse | null> {
  const r = await restore(kind, publicId, true);
  if (r?.status !== 200) return { status: 409, data: { error: NEWER_SAVE } };
  if (isGet) return r;
  return kind.refuseStale ? { status: 409, data: { error: MOVED_ON } } : null;
}

/**
 * Answers an API request (method, path and JSON body as for the server) from
 * the engine. A request for a saved session or game that the engine doesn't
 * hold (the page was reloaded, the engine restarted, or it evicted it), or
 * that another tab has since saved a newer version of, first rebuilds it from
 * localStorage; if its save is unusable the request gets the engine's 404 and
 * the page deals afresh from the URL's seed, as the local version does after
 * a server restart.
 */
export function wasmRequest(method: string, path: string, body?: string): Promise<WasmResponse> {
  // One request at a time, in order: two requests for something the engine
  // doesn't hold would otherwise each rebuild it, and the second copy would
  // lose the first one's move. The worker runs one call at a time anyway.
  const res = queue.then(() => answer(method, path, body));
  queue = res.catch(() => undefined);
  return res;
}

async function answer(method: string, path: string, body?: string): Promise<WasmResponse> {
  const target = splitPath(path);
  const kind = target?.kind ?? kinds.find((k) => path === k.base);
  const send = () => {
    const engineId = target && target.kind.engineOf.get(target.id);
    return call('request', method, target && engineId ? target.with(engineId) : path, body ?? '');
  };
  const isGet = target !== null && method === 'GET' && path === target.with(target.id);
  let res: WasmResponse | null = null;
  if (target && savedElsewhere(target.kind, target.id)) {
    // Another tab moved it on: this tab's copy is out of date.
    res = await catchUp(target.kind, target.id, isGet);
  } else if (target && !target.kind.known.has(target.kind.engineOf.get(target.id) ?? target.id)) {
    const r = await restore(target.kind, target.id);
    // A GET is answered by the rebuilt state itself.
    if (r && (r.status !== 200 || isGet)) res = r;
  }
  res ??= await send();
  if (target && res.status === 404 && (res.data as { error?: string })?.error?.startsWith(`not found: ${target.kind.noun} `)) {
    // The engine no longer holds what it had (evicted): rebuild it.
    target.kind.known.delete(target.kind.engineOf.get(target.id) ?? target.id);
    const r = await restore(target.kind, target.id);
    if (r && (r.status !== 200 || isGet)) res = r;
    else if (r) res = await send();
  }
  if (target && res.status === 200 && savedElsewhere(target.kind, target.id)) {
    // Another tab saved while the engine worked on this: its save wins, and
    // what this request did to this tab's copy is not kept. Checked once:
    // should a move sent again here race yet another save, its save wins.
    res = (await catchUp(target.kind, target.id, isGet)) ?? (await send());
  }
  if (kind && res.status === 200) {
    const engineId = kind.idOf(res.data);
    kind.known.add(engineId);
    const publicId = kind.publicOf.get(engineId) ?? engineId;
    kind.setId(res.data, publicId);
    // A save storage refused leaves the one there was: nothing new to note.
    if (kind.save(publicId, res)) see(kind, publicId);
  } else if (target && res.status !== 200) {
    // Error messages name the engine's id; show the page's instead.
    const engineId = target.kind.engineOf.get(target.id);
    const data = res.data as { error?: string } | null;
    if (engineId && typeof data?.error === 'string') data.error = data.error.split(engineId).join(target.id);
  }
  return res;
}
