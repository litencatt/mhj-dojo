// The saves of practice sessions and CPU games in localStorage (wasm.ts
// rebuilds them in the engine from these), and the lists of them the pages
// offer to resume.

import type { GameState, SessionState } from './apiTypes';

const STORAGE_KEY = 'mhj-dojo.site.practice';
const MAX_SAVED = 10; // sessions kept; the least recently used goes first

// A session as its moves: node i+1 was made from moves[i], from its parent
// node by discarding tile (no tile: tsumo). Node ids follow creation order,
// so replaying the moves in order rebuilds the same tree with the same ids.
export interface Saved {
  seed: number;
  max_turns: number;
  moves: { parent: number; tile?: string }[];
  current: number;
  used: number; // Date.now() of the last save
}

type SavedMap = Record<string, Saved>; // by public session id

export function loadAll(): SavedMap {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { v?: number; sessions?: SavedMap } | null;
    if (s?.v === 2 && s.sessions && typeof s.sessions === 'object') return s.sessions;
  } catch {
    // unreadable: treat as nothing saved
  }
  return {};
}

let warnedStorage = false;
const storageListeners = new Set<() => void>();

/**
 * Calls listener once storage has refused a save (at once if it already
 * has), for the page to tell the player. Returns what unsubscribes it.
 */
export function onStorageFailed(listener: () => void): () => void {
  if (warnedStorage) {
    listener();
    return () => {};
  }
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

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
    for (const listener of storageListeners) listener();
    storageListeners.clear();
  }
}

function storeAll(sessions: SavedMap, keep?: string) {
  write(STORAGE_KEY, sessions, (s) => ({ v: 2, sessions: s }), keep);
}

// Drops all but the max most recently used entries (an unreadable one counts as the oldest).
function trim<T extends { used: number }>(saved: Record<string, T>, max: number) {
  const ids = Object.keys(saved).sort((a, b) => (saved[b]?.used ?? 0) - (saved[a]?.used ?? 0));
  for (const id of ids.slice(max)) delete saved[id];
}

// Each session's save as this tab last built it (by public id), kept even
// when storage refuses to write it: a state's new moves are added to it,
// not to the save read back from localStorage, which may have fallen
// behind. A session this tab hasn't built one for since it was rebuilt from
// a save (or another tab took it over) has none.
export const built = new Map<string, Saved>();

// Saves a session from its state, whose tree holds the nodes from treeFrom
// on (docs/api.md "View options"): the moves that made the nodes before
// come from its last built save. Returns false, saving nothing, when the
// moves then don't add up to the session's whole tree (none built yet).
export function saveSession(publicId: string, st: SessionState, treeFrom: number): boolean {
  const old = built.get(publicId);
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
  const saved = { seed: st.seed, max_turns: st.max_turns, moves, current: st.node_id, used: Date.now() };
  built.set(publicId, saved);
  const sessions = loadAll();
  sessions[publicId] = saved;
  trim(sessions, MAX_SAVED);
  storeAll(sessions, publicId);
  return true;
}

export function forgetSession(publicId: string) {
  built.delete(publicId);
  const sessions = loadAll();
  delete sessions[publicId];
  storeAll(sessions);
}

const GAMES_KEY = 'mhj-dojo.site.games';
// Dojo games (GameState.dojo) are kept apart: the CPU game's list of saves
// never offers them, and the dojo resumes only its own.
export const DOJO_GAMES_KEY = 'mhj-dojo.site.dojo-games';
const MAX_SAVED_GAMES = 5; // games kept; the least recently used goes first

// A CPU game as the engine's own save (the match descriptor: seed, options
// and every action so far), kept as the JSON the engine gave, which
// mhjDojoRestoreGame replays.
interface SavedGame {
  save: string;
  used: number; // Date.now() of the last save
  round?: SavedRound; // where the game stood, for the page's list of saves
}

export interface SavedRound {
  wind: string; // the round wind's tile
  number: number;
  honba: number;
  over: boolean; // the game has ended
}

type SavedGames = Record<string, SavedGame>; // by public game id

export function loadGames(key = GAMES_KEY): SavedGames {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as { v?: number; games?: SavedGames } | null;
    if (s?.v === 1 && s.games && typeof s.games === 'object') return s.games;
  } catch {
    // unreadable: treat as nothing saved
  }
  return {};
}

function storeGames(key: string, games: SavedGames, keep?: string) {
  write(key, games, (g) => ({ v: 1, games: g }), keep);
}

export function saveGame(publicId: string, save: string, st: GameState) {
  const key = st.dojo ? DOJO_GAMES_KEY : GAMES_KEY;
  const games = loadGames(key);
  const round = { wind: st.round_wind, number: st.round_number, honba: st.honba, over: st.game_over };
  games[publicId] = { save, used: Date.now(), round };
  trim(games, MAX_SAVED_GAMES);
  storeGames(key, games, publicId);
}

/** Drops the dojo's unfinished games: the dojo plays one game at a time, and a new one abandons the old (unpaid). */
export function discardUnfinishedDojoGames() {
  const games = loadGames(DOJO_GAMES_KEY);
  const left = Object.fromEntries(Object.entries(games).filter(([, g]) => g.round?.over));
  if (Object.keys(left).length !== Object.keys(games).length) storeGames(DOJO_GAMES_KEY, left);
}

export function forgetGame(publicId: string) {
  for (const key of [GAMES_KEY, DOJO_GAMES_KEY]) {
    const games = loadGames(key);
    if (!(publicId in games)) continue;
    delete games[publicId];
    storeGames(key, games);
  }
}

// Newest first.
function byUsed<T extends { used: number }>(list: T[]): T[] {
  return list.sort((a, b) => b.used - a.used);
}

// Date.now() of a save's last use, 0 when it has none.
function usedOf(saved: { used?: unknown }): number {
  return typeof saved.used === 'number' ? saved.used : 0;
}

export interface SessionSummary {
  id: string; // the public id
  seed: number;
  maxTurns: number;
  used: number; // 0: unknown
}

/** The saved practice sessions, the most recently used first; unreadable ones are left out. */
export function savedSessions(): SessionSummary[] {
  const list: SessionSummary[] = [];
  for (const [id, s] of Object.entries(loadAll() as Record<string, Partial<Saved> | null>)) {
    if (!s || typeof s.seed !== 'number' || typeof s.max_turns !== 'number') continue;
    list.push({ id, seed: s.seed, maxTurns: s.max_turns, used: usedOf(s) });
  }
  return byUsed(list);
}

export interface GameSummary {
  id: string; // the public id
  seed: number | null; // null while the game hides it (a random seed, until the end)
  seedKnown: boolean; // the seed was chosen: the game shows it from the start
  length: string;
  firstDealer: string;
  cpu: string;
  round: SavedRound | null; // null for a save from before rounds were kept
  used: number; // 0: unknown
}

/** The saved CPU games of a mode (the dojo's apart), the most recently used first; unreadable ones are left out. */
export function savedGames(mode: 'game' | 'dojo' = 'game'): GameSummary[] {
  const list: GameSummary[] = [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const key = mode === 'dojo' ? DOJO_GAMES_KEY : GAMES_KEY;
  for (const [id, g] of Object.entries(loadGames(key) as Record<string, Partial<SavedGame> | null>)) {
    if (!g || typeof g.save !== 'string') continue;
    try {
      const s = JSON.parse(g.save) as Record<string, unknown>;
      const round = g.round && typeof g.round === 'object' ? g.round : null;
      const seed = typeof s.seed === 'number' ? s.seed : null;
      list.push({
        id,
        seed: s.seed_known === true || round?.over ? seed : null,
        seedKnown: s.seed_known === true && seed !== null,
        length: str(s.length),
        firstDealer: str(s.first_dealer),
        cpu: str(s.cpu),
        round,
        used: usedOf(g),
      });
    } catch {
      // unreadable: not offered
    }
  }
  return byUsed(list);
}
