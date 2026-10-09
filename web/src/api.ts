// The engine's requests, mirroring docs/api.md (the types are in apiTypes.ts). The engine is compiled
// to WebAssembly and runs in the browser (wasm.ts), on the public site and in
// the local mhj-dojo alike (issue #147).

import { lease, live, STOPPED, STOPPED_MESSAGE } from './singleTab';
import type { ActionType, GameOptions, GameState, SessionState, Tile } from './apiTypes';
import { wasmRequest } from './wasm';

// The types live in apiTypes.ts; the pages import them from here, with the requests.
export type * from './apiTypes';
export { withNames } from './apiTypes';

export interface ApiErrorBody {
  error: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The singleTab key of the session or game at an API path: its own path,
 * without any operation after the id. null for a path that names none.
 */
function tabKey(path: string): string | null {
  return /^\/api\/(sessions|games)\/[^/?]+/.exec(path)?.[0] ?? null;
}

export const sessionKey = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
export const gameKey = (id: string) => `/api/games/${encodeURIComponent(id)}`;

// A tab another one stopped sends nothing for that session or game, and
// drops the answer to a request it sent before it was stopped.
async function request<T>(path: string, init?: { method: string; body: string }): Promise<T> {
  const key = tabKey(path);
  const l = key ? lease(key) : 0;
  if (key && l === null) throw new ApiError(STOPPED_MESSAGE, STOPPED);
  const res = await send<T>(path, init);
  if (key && !live(key, l)) throw new ApiError(STOPPED_MESSAGE, STOPPED);
  return res;
}

async function send<T>(path: string, init?: { method: string; body: string }): Promise<T> {
  const res = await wasmRequest(init?.method ?? 'GET', path, init?.body);
  if (res.status !== 200) {
    const message = (res.data as ApiErrorBody | null)?.error || `${res.status}`;
    throw new ApiError(message, res.status);
  }
  return res.data as T;
}

// The optional parts of a practice state to ask for (docs/api.md "View
// options"): the advice (and the review of the discard), and only the tree
// nodes from treeFrom on, when the page holds the ones before.
export interface SessionView {
  advice: boolean;
  treeFrom: number;
}

const FULL_VIEW: SessionView = { advice: true, treeFrom: 0 };

function sessionPath(path: string, view: SessionView): string {
  const q = new URLSearchParams();
  if (!view.advice) q.set('advice', '0');
  if (view.treeFrom > 0) q.set('tree_from', String(view.treeFrom));
  const query = q.toString();
  return query ? `${path}?${query}` : path;
}

export function createSession(opts: { seed?: number; max_turns?: number } = {}, view = FULL_VIEW): Promise<SessionState> {
  return request<SessionState>(sessionPath('/api/sessions', view), {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getSession(id: string, view = FULL_VIEW): Promise<SessionState> {
  return request<SessionState>(sessionPath(`/api/sessions/${encodeURIComponent(id)}`, view));
}

// nodeId is the node the page showed when the user acted (state.node_id):
// the engine rejects the request (409) if the session is no longer at it
// (docs/api.md, issue #53).
export function discard(id: string, tile: Tile, nodeId: number, view = FULL_VIEW): Promise<SessionState> {
  return request<SessionState>(sessionPath(`/api/sessions/${encodeURIComponent(id)}/discard`, view), {
    method: 'POST',
    body: JSON.stringify({ tile, node_id: nodeId }),
  });
}

export function tsumo(id: string, nodeId: number, view = FULL_VIEW): Promise<SessionState> {
  return request<SessionState>(sessionPath(`/api/sessions/${encodeURIComponent(id)}/tsumo`, view), {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId }),
  });
}

export function goto(id: string, nodeId: number, view = FULL_VIEW): Promise<SessionState> {
  return request<SessionState>(sessionPath(`/api/sessions/${encodeURIComponent(id)}/goto`, view), {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId }),
  });
}

// ---- Games against CPU players (docs/api.md "Games") ----

// A game request's path: with the advice and the danger left out (docs/api.md
// "View options") when the page doesn't show them.
const gamePath = (path: string, advice: boolean) => (advice ? path : `${path}?advice=0`);

export function createGame(opts: Partial<GameOptions> & { seed?: number } = {}, advice = true): Promise<GameState> {
  return request<GameState>(gamePath('/api/games', advice), {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getGame(id: string, advice = true): Promise<GameState> {
  return request<GameState>(gamePath(`/api/games/${encodeURIComponent(id)}`, advice));
}

export function gameAction(id: string, type: ActionType, tile?: Tile, tiles?: Tile[], advice = true): Promise<GameState> {
  return request<GameState>(gamePath(`/api/games/${encodeURIComponent(id)}/action`, advice), {
    method: 'POST',
    body: JSON.stringify({ type, ...(tile ? { tile } : {}), ...(tiles ? { tiles } : {}) }),
  });
}
