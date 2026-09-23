// API client + types mirroring docs/api.md.

export type Tile = string; // e.g. "1m", "0m" (red five), "7z"

export interface UkeireEntry {
  tile: Tile; // tile type, no red notation
  remaining: number;
}

export interface YakuRow {
  key: string;
  name: string;
  yakuman: boolean; // true for the yakuman rows (kokushi and later)
  han: number; // closed-hand han; 13 for yakuman, 0 for the normal row
  shanten: number | null; // 0 = tenpai, null = impossible
  approx: boolean;
  ukeire: UkeireEntry[];
  ukeire_total: number;
}

export interface HistoryShantenMap {
  [yakuKey: string]: number | null;
}

export interface HistoryEntry {
  node_id: number;
  turn: number;
  draw: Tile | null;
  discard: Tile | null;
  shanten: HistoryShantenMap;
}

export interface TreeNode {
  node_id: number;
  parent_id: number | null;
  turn: number;
  draw: Tile | null;
  discard: Tile | null;
  status: NodeStatus;
  normal_shanten: number | null;
}

export type NodeStatus = 'playing' | 'tsumo' | 'exhausted';

export interface WinYaku {
  key: string;
  name: string;
  han: number;
}

export interface Win {
  tiles: Tile[];
  yaku: WinYaku[];
  dora: number;
  han_total: number;
}

export interface State {
  session_id: string;
  seed: number;
  max_turns: number;
  round_wind: Tile;
  seat_wind: Tile;
  node_id: number;
  turn: number;
  status: NodeStatus;
  hand: Tile[];
  drawn: Tile | null;
  discards: Tile[];
  dora_indicators: Tile[];
  dora: Tile[]; // dora kinds pointed to by the indicators
  ura_dora_indicators: Tile[]; // [] until the game ends
  ura_dora: Tile[];
  wall_remaining: number;
  can_tsumo: boolean;
  analysis: YakuRow[];
  by_discard: Record<Tile, YakuRow[]>;
  history: HistoryEntry[];
  tree: TreeNode[];
  win: Win | null;
}

export interface ApiErrorBody {
  error: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // ignore body parse failure, use status text
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export function createSession(opts: { seed?: number; max_turns?: number } = {}): Promise<State> {
  return request<State>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getSession(id: string): Promise<State> {
  return request<State>(`/api/sessions/${encodeURIComponent(id)}`);
}

export function discard(id: string, tile: Tile): Promise<State> {
  return request<State>(`/api/sessions/${encodeURIComponent(id)}/discard`, {
    method: 'POST',
    body: JSON.stringify({ tile }),
  });
}

export function tsumo(id: string): Promise<State> {
  return request<State>(`/api/sessions/${encodeURIComponent(id)}/tsumo`, {
    method: 'POST',
  });
}

export function goto(id: string, nodeId: number): Promise<State> {
  return request<State>(`/api/sessions/${encodeURIComponent(id)}/goto`, {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId }),
  });
}

// ---- Games against CPU players (docs/api.md "Games") ----

export type GamePhase = 'discard' | 'call' | 'ended';
export type ActionType = 'discard' | 'riichi' | 'tsumo' | 'ron' | 'skip';

export interface RiverTile {
  tile: Tile;
  riichi: boolean; // the riichi declaration tile
}

export interface Seat {
  seat: number;
  wind: Tile; // 1z-4z
  points: number;
  riichi: boolean;
  river: RiverTile[];
  hand_count: number;
  hand?: Tile[]; // yours, or everyone's once the round has ended
  drawn?: Tile;
}

export interface Legal {
  discards: Tile[];
  riichi: Tile[];
  tsumo: boolean;
  ron: boolean;
  skip: boolean;
}

export interface GameEvent {
  seat: number;
  type: ActionType;
  tile?: Tile;
}

export type Limit = '' | 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'yakuman';

export interface Points {
  limit: Limit;
  multiplier: number;
  total: number;
  ron?: number;
  from_dealer?: number;
  from_non_dealer?: number;
}

export interface GameResult {
  kind: 'tsumo' | 'ron' | 'draw';
  winner: number;
  from: number;
  win_tile: Tile | null;
  yaku: WinYaku[];
  han: number;
  fu: number;
  dora: number;
  ura_dora: number;
  points: Points;
  deltas: number[];
  tenpai: boolean[];
  deposit: number;
}

export interface GameState {
  game_id: string;
  seed: number | null; // null until the end unless you chose the seed
  you: number;
  dealer: number;
  round_wind: Tile;
  phase: GamePhase;
  actor: number;
  wall_remaining: number;
  deposit: number;
  dora_indicators: Tile[];
  dora: Tile[];
  ura_dora_indicators: Tile[];
  ura_dora: Tile[];
  seats: Seat[];
  last_discard: Tile | null;
  legal: Legal;
  events: GameEvent[];
  analysis: YakuRow[];
  by_discard: Record<Tile, YakuRow[]>;
  history: HistoryEntry[];
  result: GameResult | null;
}

export function createGame(opts: { seed?: number } = {}): Promise<GameState> {
  return request<GameState>('/api/games', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getGame(id: string): Promise<GameState> {
  return request<GameState>(`/api/games/${encodeURIComponent(id)}`);
}

export function gameAction(id: string, type: ActionType, tile?: Tile): Promise<GameState> {
  return request<GameState>(`/api/games/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    body: JSON.stringify(tile ? { type, tile } : { type }),
  });
}
