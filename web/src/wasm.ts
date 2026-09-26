// The static site's transport (issue #67): instead of calling the mhj2
// server, API requests go to the practice engine compiled to WebAssembly,
// running in a Web Worker (site-public/worker.js). Only built into the site
// (`npm run build:site`); see api.ts.
//
// The engine keeps sessions in the worker's memory, which a reload loses, so
// the current session's moves are also saved to localStorage and replayed
// when the page asks for a session the fresh worker doesn't know.

import type { SessionState, TreeNode } from './api';

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
// long the download, compile and start of the engine took.
function start(): Promise<Worker> {
  engine ??= new Promise<Worker>((resolve, reject) => {
    const t0 = performance.now();
    const w = new Worker(new URL('worker.js', document.baseURI));
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
        reject(new Error(`計算エンジンを起動できませんでした: ${m.error}`));
      } else if (typeof m.id === 'number') {
        pending.get(m.id)?.(m as Reply);
        pending.delete(m.id);
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      const err = new Error(`計算エンジンを読み込めませんでした${e.message ? `: ${e.message}` : ''}`);
      reject(err);
      for (const [id, done] of pending) done({ id, status: 500, body: JSON.stringify({ error: err.message }) });
      pending.clear();
    };
  });
  return engine;
}

async function call(method: string, path: string, body?: string): Promise<WasmResponse> {
  const w = await start();
  const id = nextId++;
  const reply = await new Promise<Reply>((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, method, path, body: body ?? '' });
  });
  return { status: reply.status, data: JSON.parse(reply.body) as unknown };
}

const SESSIONS = '/api/sessions';
const STORAGE_KEY = 'mhj2.site.practice';

// A session as its moves: node i+1 was made from moves[i] = [its parent,
// the tile discarded or null for tsumo]. Node ids follow creation order, so
// replaying the moves in order rebuilds the same tree with the same ids.
interface Saved {
  v: 1;
  session_id: string;
  seed: number;
  max_turns: number;
  moves: [number, string | null][];
  current: number;
}

function save(st: SessionState) {
  const tree: TreeNode[] = [...st.tree].sort((a, b) => a.node_id - b.node_id);
  const saved: Saved = {
    v: 1,
    session_id: st.session_id,
    seed: st.seed,
    max_turns: st.max_turns,
    moves: tree.slice(1).map((n) => [n.parent_id ?? 0, n.status === 'tsumo' ? null : n.discard]),
    current: st.node_id,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable: a reload just starts over from the URL's seed.
  }
}

function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null;
    if (
      s?.v === 1 &&
      typeof s.session_id === 'string' &&
      Number.isInteger(s.seed) &&
      Number.isInteger(s.max_turns) &&
      Array.isArray(s.moves) &&
      Number.isInteger(s.current)
    ) {
      return s;
    }
  } catch {
    // unreadable: treat as nothing saved
  }
  return null;
}

function forget() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do
  }
}

const post = (path: string, body: object) => call('POST', path, JSON.stringify(body));
const nodeOf = (r: WasmResponse) => (r.status === 200 ? (r.data as SessionState).node_id : -1);

// Rebuilds a saved session in the engine; null if the moves no longer apply.
async function replay(s: Saved): Promise<WasmResponse | null> {
  let res = await post(SESSIONS, { seed: s.seed, max_turns: s.max_turns });
  if (res.status !== 200) return null;
  const base = `${SESSIONS}/${encodeURIComponent((res.data as SessionState).session_id)}`;
  let cur = 0;
  for (const [i, move] of s.moves.entries()) {
    const [parent, tile] = Array.isArray(move) ? move : [];
    if (typeof parent !== 'number' || (tile !== null && typeof tile !== 'string')) return null;
    if (parent !== cur) {
      res = await post(`${base}/goto`, { node_id: parent });
      if (nodeOf(res) !== parent) return null;
    }
    res = tile === null ? await post(`${base}/tsumo`, { node_id: parent }) : await post(`${base}/discard`, { tile, node_id: parent });
    cur = i + 1;
    if (nodeOf(res) !== cur) return null;
  }
  if (s.current !== cur) {
    res = await post(`${base}/goto`, { node_id: s.current });
    if (nodeOf(res) !== s.current) return null;
  }
  return res;
}

/**
 * Answers an API request (method, path and JSON body as for the server) from
 * the engine. A GET of the saved session that the engine doesn't have (the
 * page was reloaded) replays it from localStorage; if that fails the 404
 * stands and the page deals a fresh session from the URL's seed, as the
 * local version does after a server restart.
 */
export async function wasmRequest(method: string, path: string, body?: string): Promise<WasmResponse> {
  let res = await call(method, path, body);
  if (res.status === 404 && method === 'GET' && path.startsWith(`${SESSIONS}/`)) {
    const saved = load();
    if (saved && `${SESSIONS}/${encodeURIComponent(saved.session_id)}` === path) {
      let restored: WasmResponse | null = null;
      try {
        restored = await replay(saved);
      } catch {
        restored = null;
      }
      if (restored) res = restored;
      else forget();
    }
  }
  if (res.status === 200 && path.startsWith(SESSIONS)) save(res.data as SessionState);
  return res;
}
