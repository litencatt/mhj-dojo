// API client + types mirroring docs/api.md.

export type Tile = string; // e.g. "1m", "0m" (red five), "7z"

export interface UkeireEntry {
  tile: Tile; // tile type, no red notation
  remaining: number;
}

export interface YakuRow {
  key: string;
  name: string;
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
