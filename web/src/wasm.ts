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
let nextId = 1;
const pending = new Map<number, (r: Reply) => void>();

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
  });
  engine = started;
  return started;
}

async function call(fn: 'request' | 'restore' | 'restoreGame', ...args: string[]): Promise<WasmResponse> {
  const w = await start();
  const id = nextId++;
  const reply = await new Promise<Reply>((resolve) => {
    pending.set(id, resolve);
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
// keeps only the one just saved and tries once more; if storage still
// refuses, the saves go stale (a reload starts over from the URL's seed),
// which is worth one warning.
function write<T>(key: string, saved: Record<string, T>, wrap: (saved: Record<string, T>) => unknown, keep?: string) {
  try {
    localStorage.setItem(key, JSON.stringify(wrap(saved)));
    return;
  } catch {
    // retried below with fewer saves
  }
  try {
    const only = keep !== undefined && keep in saved ? { [keep]: saved[keep] } : {};
    localStorage.setItem(key, JSON.stringify(wrap(only)));
    return;
  } catch {
    // storage unavailable
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

function saveSession(publicId: string, st: SessionState) {
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
  storeAll(sessions, publicId);
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
  save: (publicId: string, res: WasmResponse) => void;
  forget: (publicId: string) => void;
  idOf: (data: unknown) => string;
  setId: (data: unknown, id: string) => void;
  engineOf: Map<string, string>; // public id → engine id
  publicOf: Map<string, string>; // engine id → public id
  known: Set<string>; // engine ids the current worker holds
  failures: Map<string, number>; // public id → restores in a row the engine failed (500)
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
    save: (id, res) => saveSession(id, res.data as SessionState),
    forget: forgetSession,
    idOf: (d) => (d as SessionState).session_id,
    setId: (d, id) => ((d as SessionState).session_id = id),
    engineOf: new Map(),
    publicOf: new Map(),
    known: new Set(),
    failures: new Map(),
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
    },
    forget: forgetGame,
    idOf: (d) => (d as GameState).game_id,
    setId: (d, id) => ((d as GameState).game_id = id),
    engineOf: new Map(),
    publicOf: new Map(),
    known: new Set(),
    failures: new Map(),
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

const MAX_RESTORE_FAILURES = 2;

// Rebuilds a saved session or game in the engine under its public id and
// returns the engine's response: its state, or an error. A save the engine
// rejects (400/404/409/422) is dropped, and null returned: the request then
// gets the engine's 404 and the page deals afresh from the URL's seed. Any
// other failure (the engine broke) keeps the save for the next try, unless
// the engine failed on it MAX_RESTORE_FAILURES times in a row: the save may
// be what breaks it, so it is dropped (the error is still returned).
async function restore(kind: Kind, publicId: string): Promise<WasmResponse | null> {
  const saved = kind.saved(publicId);
  if (saved === null) return null;
  const res = await call(kind.restoreFn, saved);
  if (res.status === 200) {
    const id = kind.idOf(res.data);
    // The copy it replaces (evicted, or in a stopped worker) is gone.
    const old = kind.engineOf.get(publicId);
    if (old !== undefined) {
      kind.publicOf.delete(old);
      kind.known.delete(old);
    }
    kind.engineOf.set(publicId, id);
    kind.publicOf.set(id, publicId);
    kind.known.add(id);
    kind.failures.delete(publicId);
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
 * hold (the page was reloaded, the engine restarted, or it evicted it) first
 * rebuilds it from localStorage; if its save is unusable the request gets the
 * engine's 404 and the page deals afresh from the URL's seed, as the local
 * version does after a server restart.
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
  if (target && !target.kind.known.has(target.kind.engineOf.get(target.id) ?? target.id)) {
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
  if (kind && res.status === 200) {
    const engineId = kind.idOf(res.data);
    kind.known.add(engineId);
    const publicId = kind.publicOf.get(engineId) ?? engineId;
    kind.setId(res.data, publicId);
    kind.save(publicId, res);
  } else if (target && res.status !== 200) {
    // Error messages name the engine's id; show the page's instead.
    const engineId = target.kind.engineOf.get(target.id);
    const data = res.data as { error?: string } | null;
    if (engineId && typeof data?.error === 'string') data.error = data.error.split(engineId).join(target.id);
  }
  return res;
}
