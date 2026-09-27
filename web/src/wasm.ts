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
// Each tab runs its own worker, but the saves are shared: only one tab at a
// time plays a session or game (singleTab.ts). A tab another one stopped
// neither asks its engine about that one nor saves it, even for a request
// the engine was already working on, and drops its copy, so that taking the
// session or game back rebuilds it from the other tab's save. That save may
// come from a newer version of the site than this tab runs: one this tab's
// engine can't rebuild is kept, and the page asked to reload.

import type { GameState, SessionState } from './api';
import { lease, live, onChange, settled, STOPPED, STOPPED_MESSAGE } from './singleTab';

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
function write<T>(key: string, saved: Record<string, T>, wrap: (saved: Record<string, T>) => unknown, keep?: string) {
  try {
    localStorage.setItem(key, JSON.stringify(wrap(saved)));
    return;
  } catch {
    // retried below with fewer saves
  }
  if (keep !== undefined && keep in saved) {
    try {
      localStorage.setItem(key, JSON.stringify(wrap({ [keep]: saved[keep] })));
      return;
    } catch {
      // storage unavailable
    }
  }
  if (!warnedStorage) {
    warnedStorage = true;
    console.warn('mhj-dojo: cannot save to localStorage; a reload will start over from the URL');
  }
}

function storeAll(sessions: SavedMap, keep?: string) {
  write(STORAGE_KEY, sessions, (s) => ({ v: 2, sessions: s }), keep);
}

// Drops all but the max most recently used entries.
function trim<T extends { used: number }>(saved: Record<string, T>, max: number) {
  const ids = Object.keys(saved).sort((a, b) => (saved[b].used ?? 0) - (saved[a].used ?? 0));
  for (const id of ids.slice(max)) delete saved[id];
}

// Saves a session from its state, whose tree holds the nodes from treeFrom
// on (docs/api.md "View options"): the moves that made the nodes before
// come from its save. Returns false, saving nothing, when the moves then
// don't add up to the session's whole tree (no save, or one that fell
// behind, such as when storage refused it).
function saveSession(publicId: string, st: SessionState, treeFrom: number): boolean {
  const sessions = loadAll();
  const old = sessions[publicId];
  const made = [...st.tree]
    .sort((a, b) => a.node_id - b.node_id)
    .filter((n) => n.parent_id !== null)
    .map((n) => (n.status === 'tsumo' ? { parent: n.parent_id ?? 0 } : { parent: n.parent_id ?? 0, tile: n.discard ?? '' }));
  // Node i+1 was made by moves[i].
  const before = Math.max(treeFrom - 1, 0);
  let moves = made;
  if (before > 0) {
    if (!old || old.seed !== st.seed || old.max_turns !== st.max_turns || old.moves.length < before) return false;
    moves = [...old.moves.slice(0, before), ...made];
  }
  if (moves.length !== st.node_count - 1) return false;
  sessions[publicId] = { seed: st.seed, max_turns: st.max_turns, moves, current: st.node_id, used: Date.now() };
  trim(sessions, MAX_SAVED);
  storeAll(sessions, publicId);
  return true;
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

function storeGames(games: SavedGames, keep?: string) {
  write(GAMES_KEY, games, (g) => ({ v: 1, games: g }), keep);
}

function saveGame(publicId: string, save: string) {
  const games = loadGames();
  games[publicId] = { save, used: Date.now() };
  trim(games, MAX_SAVED_GAMES);
  storeGames(games, publicId);
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
  // Saves a successful response, made with the request's query; false if
  // it can't (see saveSession).
  save: (publicId: string, res: WasmResponse, query: string) => boolean;
  forget: (publicId: string) => void;
  idOf: (data: unknown) => string;
  setId: (data: unknown, id: string) => void;
  engineOf: Map<string, string>; // public id → engine id
  publicOf: Map<string, string>; // engine id → public id
  known: Set<string>; // engine ids the current worker holds
  failures: Map<string, number>; // public id → restores in a row the engine failed (500)
  // Public ids whose save another tab has written since this tab last
  // rebuilt it (it took them over). Kept across workers.
  foreign: Set<string>;
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
    save: (id, res, query) =>
      saveSession(id, res.data as SessionState, Number(new URLSearchParams(query).get('tree_from') ?? 0)),
    forget: forgetSession,
    idOf: (d) => (d as SessionState).session_id,
    setId: (d, id) => ((d as SessionState).session_id = id),
    engineOf: new Map(),
    publicOf: new Map(),
    known: new Set(),
    failures: new Map(),
    foreign: new Set(),
  },
  {
    base: GAMES,
    noun: 'game',
    restoreFn: 'restoreGame',
    saved: (id) => {
      const g = loadGames()[id];
      return typeof g?.save === 'string' ? g.save : null;
    },
    save: (id, res) => {
      // "" when the response isn't a game state: keep the save there is.
      if (res.save) saveGame(id, res.save);
      return true;
    },
    forget: forgetGame,
    idOf: (d) => (d as GameState).game_id,
    setId: (d, id) => ((d as GameState).game_id = id),
    engineOf: new Map(),
    publicOf: new Map(),
    known: new Set(),
    failures: new Map(),
    foreign: new Set(),
  },
];

function forgetEngine() {
  for (const k of kinds) {
    k.engineOf.clear();
    k.publicOf.clear();
    k.known.clear();
  }
}

// The kind and id in a {base}/{id}[/op] path (no query), the path with the
// id swapped for another, and its singleTab key ({base}/{id}).
function splitPath(path: string): { kind: Kind; id: string; with: (id: string) => string; key: string } | null {
  for (const kind of kinds) {
    if (!path.startsWith(`${kind.base}/`)) continue;
    const m = /^([^/]+)(\/.*)?$/.exec(path.slice(kind.base.length + 1));
    if (!m) return null;
    const id = decodeURIComponent(m[1]);
    return {
      kind,
      id,
      with: (other) => `${kind.base}/${encodeURIComponent(other)}${m[2] ?? ''}`,
      key: `${kind.base}/${m[1]}`,
    };
  }
  return null;
}

// Another tab took over a session or game: the copy in this tab's engine is
// out of date from now on, and taking it back rebuilds it from the save.
onChange((key, stopped) => {
  const target = stopped && splitPath(key);
  if (!target) return;
  target.kind.known.delete(target.kind.engineOf.get(target.id) ?? target.id);
  target.kind.foreign.add(target.id);
});

// The answer to a request on a session or game another tab has taken over.
const stoppedResponse = (): WasmResponse => ({ status: STOPPED, data: { error: STOPPED_MESSAGE } });

// The answer when this tab's engine can't rebuild another tab's save (most
// likely that tab runs a newer version of the site).
const NEWER_SAVE = '別の画面で新しい版に保存されています。再読み込みしてください';

const MAX_RESTORE_FAILURES = 2;

// Rebuilds a saved session or game in the engine under its public id and
// returns the engine's response: its state, or an error. A save the engine
// rejects (400/404/409/422) is dropped, and null returned: the request then
// gets the engine's 404 and the page deals afresh from the URL's seed. Any
// other failure (the engine broke) keeps the save for the next try, unless
// the engine failed on it MAX_RESTORE_FAILURES times in a row: the save may
// be what breaks it, so it is dropped (the error is still returned).
// A save another tab wrote (foreign) is never dropped: any failure is a
// 409 asking for a reload, as that tab may run a newer engine. Should
// another tab take it over meanwhile (stopped), none of this is done: that
// tab's save is its own, and this tab's copy is out of date.
async function restore(kind: Kind, publicId: string, query: string, stopped: () => boolean): Promise<WasmResponse | null> {
  // Once the tab this one just took it from has stopped saving it; the
  // engine starts meanwhile.
  await Promise.all([settled(`${kind.base}/${encodeURIComponent(publicId)}`), start()]);
  const saved = kind.saved(publicId);
  if (saved === null) return null;
  // A session's rebuilt state answers with the request's view options.
  const res = await (kind.restoreFn === 'restore' ? call('restore', saved, query) : call('restoreGame', saved));
  if (stopped()) return stoppedResponse();
  if (res.status === 200) {
    const id = kind.idOf(res.data);
    // The copy it replaces (evicted, out of date, or in a stopped worker) is
    // gone; one left in the engine goes when the engine evicts it.
    const old = kind.engineOf.get(publicId);
    if (old !== undefined) {
      kind.publicOf.delete(old);
      kind.known.delete(old);
    }
    kind.engineOf.set(publicId, id);
    kind.publicOf.set(id, publicId);
    kind.known.add(id);
    kind.failures.delete(publicId);
    kind.foreign.delete(publicId);
  } else if (kind.foreign.has(publicId)) {
    return { status: 409, data: { error: NEWER_SAVE } };
  } else if ([400, 404, 409, 422].includes(res.status)) {
    kind.failures.delete(publicId);
    kind.forget(publicId);
    return null;
  } else {
    const failures = (kind.failures.get(publicId) ?? 0) + 1;
    kind.failures.set(publicId, failures);
    if (failures >= MAX_RESTORE_FAILURES) {
      kind.failures.delete(publicId);
      kind.forget(publicId);
    }
  }
  return res;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Answers an API request (method, path and JSON body as for the server) from
 * the engine. A request for a saved session or game that the engine doesn't
 * hold (the page was reloaded, the engine restarted, it evicted it, or
 * another tab took it over and gave it back) first rebuilds it from
 * localStorage; if its save is unusable the request gets the engine's 404 and
 * the page deals afresh from the URL's seed, as the local version does after
 * a server restart. One another tab has taken over (singleTab.ts) gets a 423,
 * and neither the engine nor the save sees it.
 */
export function wasmRequest(method: string, path: string, body?: string): Promise<WasmResponse> {
  // Whether another tab has taken the session or game over since the
  // request was made: checked as it starts, and before anything is saved.
  const key = splitPath(path.split('?', 1)[0])?.key;
  const l = key === undefined ? 0 : lease(key);
  const stopped = () => key !== undefined && !live(key, l);
  // One request at a time, in order: two requests for something the engine
  // doesn't hold would otherwise each rebuild it, and the second copy would
  // lose the first one's move. The worker runs one call at a time anyway.
  const res = queue.then(() => answer(method, path, body, stopped));
  queue = res.catch(() => undefined);
  return res;
}

async function answer(
  method: string,
  fullPath: string,
  body: string | undefined,
  stopped: () => boolean,
): Promise<WasmResponse> {
  if (stopped()) return stoppedResponse();
  const [path, query = ''] = fullPath.split('?', 2);
  const target = splitPath(path);
  const kind = target?.kind ?? kinds.find((k) => path === k.base);
  const send = () => {
    const engineId = target && target.kind.engineOf.get(target.id);
    return call('request', method, target && engineId ? `${target.with(engineId)}${query ? `?${query}` : ''}` : fullPath, body ?? '');
  };
  const isGet = target !== null && method === 'GET' && path === target.with(target.id);
  let res: WasmResponse | null = null;
  if (target && !target.kind.known.has(target.kind.engineOf.get(target.id) ?? target.id)) {
    const r = await restore(target.kind, target.id, query, stopped);
    // A GET is answered by the rebuilt state itself.
    if (r && (r.status !== 200 || isGet)) res = r;
  }
  res ??= await send();
  if (target && res.status === 404 && (res.data as { error?: string })?.error?.startsWith(`not found: ${target.kind.noun} `)) {
    // The engine no longer holds what it had (evicted): rebuild it.
    target.kind.known.delete(target.kind.engineOf.get(target.id) ?? target.id);
    const r = await restore(target.kind, target.id, query, stopped);
    if (r && (r.status !== 200 || isGet)) res = r;
    else if (r) res = await send();
  }
  // Taken over while the engine worked on it: the other tab's save stands.
  if (stopped()) return stoppedResponse();
  if (kind && res.status === 200) {
    const engineId = kind.idOf(res.data);
    kind.known.add(engineId);
    const publicId = kind.publicOf.get(engineId) ?? engineId;
    kind.setId(res.data, publicId);
    if (!kind.save(publicId, res, query)) {
      // The save fell behind the tree: save it from the whole tree.
      const whole = await call('request', 'GET', `${kind.base}/${encodeURIComponent(engineId)}?advice=0`, '');
      if (stopped()) return stoppedResponse();
      if (whole.status === 200) kind.save(publicId, whole, '');
    }
  } else if (target && res.status !== 200) {
    // Error messages name the engine's id; show the page's instead.
    const engineId = target.kind.engineOf.get(target.id);
    const data = res.data as { error?: string } | null;
    if (engineId && typeof data?.error === 'string') data.error = data.error.split(engineId).join(target.id);
  }
  return res;
}
