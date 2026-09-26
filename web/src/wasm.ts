// The static site's transport (issue #67): instead of calling the mhj2
// server, API requests go to the practice engine compiled to WebAssembly,
// running in a Web Worker (site-public/worker.js). Only built into the site
// (`npm run build:site`); see api.ts.
//
// The engine keeps sessions in the worker's memory, which a reload loses, so
// each session's moves are also saved to localStorage and replayed when the
// page asks for a session the fresh worker doesn't know. The replayed
// session keeps the id the page knows it by (its public id), whatever id the
// engine gave it this time, so URLs and bookmarks keep working.

import type { SessionState } from './api';

export interface WasmResponse {
  status: number;
  data: unknown; // the parsed JSON body
}

interface Reply {
  id: number;
  status: number;
  body: string;
}

let engine: Promise<Worker> | null = null;
let nextId = 1;
const pending = new Map<number, (r: Reply) => void>();

// Starts the worker on first use. The measure 'mhj2:wasm-init' records how
// long the download, compile and start of the engine took. If the engine
// fails to start, or exits later, the next request starts a new worker;
// the sessions it held are rebuilt from their saves as they are asked for.
function start(): Promise<Worker> {
  if (engine) return engine;
  const started: Promise<Worker> = new Promise<Worker>((resolve, reject) => {
    const t0 = performance.now();
    const url = new URL('worker.js', document.baseURI);
    // A hash of the worker, wasm_exec.js and mhj2.wasm (vite.config.ts), so a
    // deploy never mixes cached and new copies of them.
    const version = import.meta.env.VITE_MHJ2_ENGINE as string | undefined;
    if (version) url.searchParams.set('v', version);
    const w = new Worker(url);
    const fail = (message: string) => {
      w.terminate();
      if (engine !== started) return; // an old worker, already replaced
      engine = null;
      engineOf.clear();
      publicOf.clear();
      known.clear();
      reject(new Error(message)); // no-op once it had started
      for (const [id, done] of pending) done({ id, status: 500, body: JSON.stringify({ error: message }) });
      pending.clear();
    };
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; error?: string } & Partial<Reply>;
      if (m.type === 'ready') {
        try {
          performance.measure('mhj2:wasm-init', { start: t0, end: performance.now() });
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

async function call(fn: 'request' | 'restore', ...args: string[]): Promise<WasmResponse> {
  const w = await start();
  const id = nextId++;
  const reply = await new Promise<Reply>((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, fn, args });
  });
  return { status: reply.status, data: JSON.parse(reply.body) as unknown };
}

const SESSIONS = '/api/sessions';
const STORAGE_KEY = 'mhj2.site.practice';
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

function storeAll(sessions: SavedMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, sessions }));
  } catch {
    // Storage unavailable or full: a reload just starts over from the URL's seed.
  }
}

function save(publicId: string, st: SessionState) {
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
  const ids = Object.keys(sessions).sort((a, b) => (sessions[b].used ?? 0) - (sessions[a].used ?? 0));
  for (const id of ids.slice(MAX_SAVED)) delete sessions[id];
  storeAll(sessions);
}

function forget(publicId: string) {
  const sessions = loadAll();
  delete sessions[publicId];
  storeAll(sessions);
}

// Public id ↔ engine id, for sessions replayed under a new engine id, and
// the engine ids the current worker holds. A new worker starts them over.
const engineOf = new Map<string, string>();
const publicOf = new Map<string, string>();
const known = new Set<string>();

// The session id in a /api/sessions/{id}[/op] path, and the path with it
// swapped for another.
function splitPath(path: string): { id: string; with: (id: string) => string } | null {
  const m = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return { id, with: (other) => `${SESSIONS}/${encodeURIComponent(other)}${m[2] ?? ''}` };
}

// Rebuilds a saved session in the engine under its public id and returns
// the engine's response: its state, or an error. A save the engine rejects
// (400/404/409/422) is dropped, and null returned: the request then gets
// the engine's 404 and the page deals a fresh session from the URL's seed.
// Any other failure (the engine broke) keeps the save for the next try.
async function restore(publicId: string): Promise<WasmResponse | null> {
  const saved = loadAll()[publicId];
  if (!saved) return null;
  const res = await call('restore', JSON.stringify(saved));
  if (res.status === 200) {
    const id = (res.data as SessionState).session_id;
    engineOf.set(publicId, id);
    publicOf.set(id, publicId);
    known.add(id);
  } else if ([400, 404, 409, 422].includes(res.status)) {
    forget(publicId);
    return null;
  }
  return res;
}

/**
 * Answers an API request (method, path and JSON body as for the server) from
 * the engine. A request for a saved session that the engine doesn't hold
 * (the page was reloaded, or the engine restarted) first rebuilds it from
 * localStorage; if its save is unusable the request gets the engine's 404
 * and the page deals a fresh session from the URL's seed, as the local
 * version does after a server restart.
 */
export async function wasmRequest(method: string, path: string, body?: string): Promise<WasmResponse> {
  const target = splitPath(path);
  const send = () => {
    const engineId = target && engineOf.get(target.id);
    return call('request', method, target && engineId ? target.with(engineId) : path, body ?? '');
  };
  const isGet = target !== null && method === 'GET' && path === target.with(target.id);
  let res: WasmResponse | null = null;
  if (target && !known.has(engineOf.get(target.id) ?? target.id)) {
    const r = await restore(target.id);
    // A GET is answered by the rebuilt state itself.
    if (r && (r.status !== 200 || isGet)) res = r;
  }
  res ??= await send();
  if (target && res.status === 404 && /^not found: session /.test((res.data as { error?: string })?.error ?? '')) {
    // The engine no longer holds a session it had (evicted): rebuild it.
    known.delete(engineOf.get(target.id) ?? target.id);
    const r = await restore(target.id);
    if (r && (r.status !== 200 || isGet)) res = r;
    else if (r) res = await send();
  }
  if (res.status === 200 && path.startsWith(SESSIONS)) {
    const st = res.data as SessionState;
    known.add(st.session_id);
    st.session_id = publicOf.get(st.session_id) ?? st.session_id;
    save(st.session_id, st);
  } else if (target && res.status !== 200) {
    // Error messages name the engine's id; show the page's instead.
    const engineId = engineOf.get(target.id);
    const data = res.data as { error?: string } | null;
    if (engineId && typeof data?.error === 'string') data.error = data.error.split(engineId).join(target.id);
  }
  return res;
}
