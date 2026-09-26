// API client + types mirroring docs/api.md.

import { wasmRequest } from './wasm';

// The static site (`npm run build:site`, issue #67) answers requests from the
// practice engine compiled to WebAssembly instead of the mhj-dojo server. Fixed
// at build time, so the default build leaves the WASM transport out.
export const WASM = import.meta.env.VITE_MHJDOJO_TARGET === 'wasm';

export type Tile = string; // e.g. "1m", "0m" (red five), "7z"

export interface UkeireEntry {
  tile: Tile; // tile type, no red notation
  remaining: number;
}

export interface YakuRow {
  key: string;
  name: string;
  yakuman: boolean; // true for the yakuman rows (kokushi and later)
  han: number; // han for the hand, lowered when open (kuisagari); 13 for yakuman, 0 for the normal row
  shanten: number | null; // 0 = tenpai, null = impossible
  approx: boolean;
  ukeire: UkeireEntry[];
  ukeire_total: number;
}

// A combination of yaku one complete hand scores together (docs/api.md "Yaku combos").
export interface ComboRow {
  keys: string[];
  name: string; // row names joined with ＋
  han: number; // sum of the rows' han (open-hand han after a call)
  shanten: number; // 0 = tenpai
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

// A block of the hand's split (docs/api.md "HandGroup"): its type and the
// indexes of its tiles in `hand`.
export type HandGroupType = 'seq' | 'trip' | 'pair' | 'ryanmen' | 'kanchan' | 'penchan' | 'toitsu' | 'float';
export interface HandGroup {
  type: HandGroupType;
  tiles: number[];
}

export interface SessionState {
  session_id: string;
  seed: number;
  max_turns: number;
  round_wind: Tile;
  seat_wind: Tile;
  node_id: number;
  turn: number;
  status: NodeStatus;
  hand: Tile[];
  hand_groups: HandGroup[]; // blocks of hand, drawn tile excluded
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
  combos: ComboRow[]; // best yaku combinations, at most 5
  combos_by_discard: Record<Tile, ComboRow[]>;
  history: HistoryEntry[];
  tree: TreeNode[];
  win: Win | null;
  advice: Advice | null; // only while playing
  discard_review: DiscardReview | null; // the discard that led to this node
}

// Rule-based advice for the pending discard (docs/api.md "Advice").
export interface AdviceCandidate {
  tile: Tile;
  shanten: number;
  ukeire_kinds: number;
  ukeire: number;
  wait: number | null; // expected tenpai wait; null above 1-shanten
  yaku: string[];
}

export interface NearYaku {
  key: string;
  name: string;
  han: number;
  shanten: number;
  kept: boolean;
}

export type AdvicePhase = 'early' | 'middle' | 'late';

export interface Advice {
  candidates: AdviceCandidate[];
  junme: number;
  phase: AdvicePhase;
  guideline: string;
  draws_left: number;
  tenpai_chance: number; // 0..1
  win_chance: number;
  shape: string;
  near_yaku: NearYaku[];
  notes: string[];
}

export interface DiscardReview {
  tile: Tile;
  best: Tile;
  rank: number;
  is_best: boolean;
  shanten: number;
  best_shanten: number;
  ukeire: number;
  best_ukeire: number;
  text: string;
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
  if (WASM) {
    const res = await wasmRequest(init?.method ?? 'GET', path, init?.body as string | undefined);
    if (res.status !== 200) {
      const message = (res.data as ApiErrorBody | null)?.error || `${res.status}`;
      throw new ApiError(message, res.status);
    }
    return res.data as T;
  }
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

export function createSession(opts: { seed?: number; max_turns?: number } = {}): Promise<SessionState> {
  return request<SessionState>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getSession(id: string): Promise<SessionState> {
  return request<SessionState>(`/api/sessions/${encodeURIComponent(id)}`);
}

// nodeId is the node the page showed when the user acted (state.node_id):
// the server rejects the request (409) if the session has since moved on
// from it in another tab (docs/api.md, issue #53).
export function discard(id: string, tile: Tile, nodeId: number): Promise<SessionState> {
  return request<SessionState>(`/api/sessions/${encodeURIComponent(id)}/discard`, {
    method: 'POST',
    body: JSON.stringify({ tile, node_id: nodeId }),
  });
}

export function tsumo(id: string, nodeId: number): Promise<SessionState> {
  return request<SessionState>(`/api/sessions/${encodeURIComponent(id)}/tsumo`, {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId }),
  });
}

export function goto(id: string, nodeId: number): Promise<SessionState> {
  return request<SessionState>(`/api/sessions/${encodeURIComponent(id)}/goto`, {
    method: 'POST',
    body: JSON.stringify({ node_id: nodeId }),
  });
}

// The commit the server (or the site's engine) was built from (docs/api.md
// "GET /api/version").
export interface VersionInfo {
  version: string; // 7 hex digits, or "dev" for a build without the stamp
  revision: string; // "" when unknown
  time: string; // the commit time (RFC 3339); "" when unknown
  modified: boolean;
}

export function getVersion(): Promise<VersionInfo> {
  return request<VersionInfo>('/api/version');
}

// ---- Games against CPU players (docs/api.md "Games") ----

export type GamePhase = 'discard' | 'call' | 'ended';
export type ActionType = 'discard' | 'riichi' | 'tsumo' | 'ron' | 'skip' | 'kyuushu' | 'pon' | 'chii' | 'kan' | 'next';
export type GameLength = 'tonpuu' | 'hanchan'; // 東風戦 | 半荘戦
export type FirstDealerMode = 'random' | 'you'; // 起家: ランダム | 自分
export type CpuLevel = 'weak' | 'normal'; // 弱い | 普通
export type AbortReason = 'kyuushu' | 'suufon' | 'suucha' | 'suukaikan'; // 九種九牌 | 四風連打 | 四家立直 | 四開槓

export interface RiverTile {
  tile: Tile;
  riichi: boolean; // the riichi declaration tile
  called: boolean; // taken into another seat's meld (stays in the river for furiten)
}

export type MeldType = 'chii' | 'pon' | 'kan' | 'ankan'; // kan: an open or added kan

export interface Meld {
  type: MeldType;
  tiles: Tile[]; // the called tile last; a kakan's added tile just before it
  from: number; // the seat the called tile came from; -1 for an ankan
  added: boolean; // a kan made by adding a tile to a pon (kakan)
}

export interface Seat {
  seat: number;
  wind: Tile; // 1z-4z
  points: number;
  riichi: boolean;
  river: RiverTile[];
  melds: Meld[];
  hand_count: number;
  hand?: Tile[]; // yours, or everyone's once the round has ended
  hand_groups?: HandGroup[]; // yours only: blocks of hand
  drawn?: Tile;
}

export interface Legal {
  discards: Tile[];
  riichi: Tile[];
  tsumo: boolean;
  ron: boolean;
  skip: boolean;
  kyuushu: boolean; // may declare 九種九牌
  pon: boolean; // may pon last_discard
  chii: [Tile, Tile][]; // the pairs of own tiles that can chii last_discard
  kan: Tile[]; // call phase: open kan of last_discard; own turn: kinds to ankan or add to a pon
}

export interface GameEvent {
  seat: number;
  type: Exclude<ActionType, 'next'>;
  tile?: Tile; // for a call, the claimed tile; for a kan on your own turn, the kind
  tiles?: Tile[]; // for a call, the seat's own tiles in the meld
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

export type RoundKind = 'tsumo' | 'ron' | 'draw' | 'abort';

export interface Standing {
  seat: number;
  rank: number; // 1-4
  points: number;
  score: number; // final once game_over
}

export interface RoundSummary {
  round_wind: Tile;
  round_number: number;
  honba: number;
  kind: RoundKind;
  reason?: AbortReason;
  winner: number;
  from: number;
  deltas: number[];
}

export interface GameResult {
  kind: RoundKind;
  reason?: AbortReason; // abort only
  winner: number;
  from: number;
  win_tile: Tile | null;
  yaku: WinYaku[];
  han: number;
  fu: number;
  dora: number;
  ura_dora: number;
  points: Points;
  deltas: number[]; // the sum of the next three
  hand_deltas: number[]; // the hand's payments (or the noten penalty)
  honba_deltas: number[];
  stick_deltas: number[]; // riichi sticks paid and received
  honba: number;
  tenpai: boolean[];
  deposit: number;
  pao: Pao[]; // seats responsible (包) for yakuman of the win
}

export interface Pao {
  seat: number;
  yaku: string; // the yakuman's key: daisangen, daisuushii or suukantsu
}

export interface GameState {
  game_id: string;
  seed: number | null; // null until the end unless you chose the seed
  length: GameLength;
  first_dealer_mode: FirstDealerMode; // the first_dealer asked for
  cpu: CpuLevel;
  you: number;
  first_dealer: number; // the seat
  dealer: number;
  round_wind: Tile;
  round_number: number; // 1-4
  honba: number;
  can_next: boolean; // the round has ended and another follows
  game_over: boolean;
  standings: Standing[]; // index = seat
  rounds: RoundSummary[]; // finished rounds, the current one last once it ends
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
  combos: ComboRow[]; // best yaku combinations, at most 5
  combos_by_discard: Record<Tile, ComboRow[]>;
  history: HistoryEntry[];
  result: GameResult | null;
}

export interface GameOptions {
  length: GameLength;
  first_dealer: FirstDealerMode;
  cpu: CpuLevel;
}

export function createGame(opts: Partial<GameOptions> & { seed?: number } = {}): Promise<GameState> {
  return request<GameState>('/api/games', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getGame(id: string): Promise<GameState> {
  return request<GameState>(`/api/games/${encodeURIComponent(id)}`);
}

export function gameAction(id: string, type: ActionType, tile?: Tile, tiles?: Tile[]): Promise<GameState> {
  return request<GameState>(`/api/games/${encodeURIComponent(id)}/action`, {
    method: 'POST',
    body: JSON.stringify({ type, ...(tile ? { tile } : {}), ...(tiles ? { tiles } : {}) }),
  });
}
