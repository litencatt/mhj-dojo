// Routes api.ts's requests (issues #67, #147) to the engine compiled to
// WebAssembly, running in a Web Worker (engine.ts, site-public/worker.js),
// on the public site and in the local mhj-dojo.
//
// The engine keeps practice sessions and CPU games in the worker's memory,
// which a reload loses (and it evicts all but a few), so each one is also
// saved to localStorage (saves.ts: a session's moves, a game's save from the engine)
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

import type { GameState, SessionState } from './apiTypes';
import { call, onEngineLost, start, type WasmResponse } from './engine';
import { built, DOJO_GAMES_KEY, forgetGame, forgetSession, loadAll, loadGames, saveGame, saveSession, type Saved } from './saves';
import { lease, live, onChange, settled, STOPPED, STOPPED_MESSAGE } from './singleTab';

export type { WasmResponse } from './engine';

const SESSIONS = '/api/sessions';
const GAMES = '/api/games';

// What the page keeps in the engine: practice sessions and CPU games. Each
// is known to the page by its public id, the id the engine first gave it;
// one rebuilt from its save gets a new engine id, mapped here. A new worker
// starts the maps over.
interface Kind {
  base: string; // the collection's path
  noun: string; // as in the engine's "not found: session ..." errors
  restoreFn: 'restore' | 'restoreGame';
  saved: (publicId: string) => string | null; // the restore body
  // Notes the save the engine was just rebuilt from, or (null) that this
  // tab's copy is out of date: another tab took it over.
  rebuilt: (publicId: string, saved: string | null) => void;
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
    // This tab's own last save first: storage may have refused it.
    saved: (id) => {
      const s = built.get(id) ?? loadAll()[id];
      return s ? JSON.stringify(s) : null;
    },
    rebuilt: (id, saved) => {
      if (saved === null) built.delete(id);
      else built.set(id, JSON.parse(saved) as Saved);
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
    // Public ids are unique, so either list may hold it.
    saved: (id) => {
      const g = loadGames()[id] ?? loadGames(DOJO_GAMES_KEY)[id];
      return typeof g?.save === 'string' ? g.save : null;
    },
    rebuilt: () => {},
    save: (id, res) => {
      // "" when the response isn't a game state: keep the save there is.
      if (res.save) saveGame(id, res.save, res.data as GameState);
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

// A worker given up takes what it held with it.
onEngineLost(() => {
  for (const k of kinds) {
    k.engineOf.clear();
    k.publicOf.clear();
    k.known.clear();
  }
});

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
  target.kind.rebuilt(target.id, null);
});

// The answer to a request on a session or game another tab has taken over.
const stoppedResponse = (): WasmResponse => ({ status: STOPPED, data: { error: STOPPED_MESSAGE } });

// The answer when this tab's engine can't rebuild another tab's save (most
// likely that tab runs a newer version of the site).
const NEWER_SAVE = '別の画面で新しい版に保存されています';

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
  // The rebuilt state answers with the request's view options.
  const res = await (kind.restoreFn === 'restore' ? call('restore', saved, query) : call('restoreGame', saved, query));
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
    kind.rebuilt(publicId, saved);
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
 * Answers a request (method, path and JSON body, docs/api.md) from the
 * engine. A request for a saved session or game that the engine doesn't
 * hold (the page was reloaded, the engine restarted, it evicted it, or
 * another tab took it over and gave it back) first rebuilds it from
 * localStorage; if there is no save for it, or its save is unusable, the
 * request gets the engine's 404 and the page deals afresh from the URL's
 * seed. One another tab has taken over (singleTab.ts) gets a 423, and
 * neither the engine nor the save sees it.
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
    const engineId = target.kind.engineOf.get(target.id);
    // The engine failed partway (a panic): its copy may be half changed, so
    // the next request rebuilds it from the last save, and a retry acts on
    // the state the page still shows.
    if (res.status >= 500) target.kind.known.delete(engineId ?? target.id);
    // Error messages name the engine's id; show the page's instead.
    const data = res.data as { error?: string } | null;
    if (engineId && typeof data?.error === 'string') data.error = data.error.split(engineId).join(target.id);
  }
  return res;
}
