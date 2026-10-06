// The engine's requests + types mirroring docs/api.md. The engine is compiled
// to WebAssembly and runs in the browser (wasm.ts), on the public site and in
// the local mhj-dojo alike (issue #147).

import { lease, live, STOPPED, STOPPED_MESSAGE } from './singleTab';
import { wasmRequest } from './wasm';

export type Tile = string; // e.g. "1m", "0m" (red five), "7z"

// Unseen copies of each tile kind (docs/api.md "remaining"): every ukeire
// list of a state counts its tiles from its one map.
export type Remaining = Record<Tile, number>;

export interface YakuRow {
  key: string;
  name: string;
  yakuman: boolean; // true for the yakuman rows (kokushi and later)
  han: number; // han for the hand, lowered when open (kuisagari); 13 for yakuman, 0 for the normal row
  shanten: number | null; // 0 = tenpai, null = impossible
  approx: boolean;
  ukeire: Tile[]; // tile types, no red notation
  ukeire_total: number;
}

// A by_discard row: name, yakuman and han are the analysis row's of the same key.
export type DiscardRow = Pick<YakuRow, 'key' | 'shanten' | 'approx' | 'ukeire' | 'ukeire_total'>;

/** A discard's preview rows as whole rows, joined with the analysis by key. */
export function withNames(rows: DiscardRow[], analysis: YakuRow[]): YakuRow[] {
  const byKey = new Map(analysis.map((r) => [r.key, r]));
  return rows.flatMap((r) => {
    const a = byKey.get(r.key);
    return a ? [{ ...a, ...r }] : [];
  });
}

// A combination of yaku one complete hand scores together (docs/api.md "Yaku combos").
export interface ComboRow {
  keys: string[];
  name: string; // row names joined with ＋
  han: number; // sum of the rows' han (open-hand han after a call)
  shanten: number; // 0 = tenpai
  approx: boolean;
  ukeire: Tile[];
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
  by_discard: Record<Tile, DiscardRow[]>;
  combos: ComboRow[]; // best yaku combinations, at most 5
  combos_by_discard: Record<Tile, ComboRow[]>;
  remaining: Remaining;
  history: HistoryEntry[];
  node_count: number; // nodes in the whole tree
  tree: TreeNode[]; // the nodes from the view's treeFrom on (all of them once App has merged them)
  win: Win | null;
  advice: Advice | null; // only while playing, and asked for
  discard_review: DiscardReview | null; // the discard that led to this node, if asked for
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
  wall_remaining: number; // live draws left right after the move
  new_dora_indicators?: Tile[]; // kan dora indicators the move turned over
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
  events_from: number; // the round's index of events[0]
  events_wall_remaining: number; // the wall just before events[0]
  analysis: YakuRow[];
  by_discard: Record<Tile, DiscardRow[]>;
  combos: ComboRow[]; // best yaku combinations, at most 5
  combos_by_discard: Record<Tile, ComboRow[]>;
  remaining: Remaining;
  history: HistoryEntry[];
  result: GameResult | null;
  // An engine from before these fields (a cached wasm) sends neither.
  advice?: Advice | null; // your discard, concealed hand out of riichi only
  danger?: SeatDanger[]; // on your turn: each other seat in riichi
}

/** 0 safe, 1 low, 2 medium, 3 high (docs/api.md "GameState"). */
export type DangerLevel = 0 | 1 | 2 | 3;

export interface SeatDanger {
  seat: number;
  tiles: Record<Tile, DangerLevel>; // every tile you hold
}

export interface GameOptions {
  length: GameLength;
  first_dealer: FirstDealerMode;
  cpu: CpuLevel;
}

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
