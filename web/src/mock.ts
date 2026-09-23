// In-browser mock backend, used only when VITE dev + `?mock=1` (see client.ts).
// Simulates the session/tree/discard/tsumo/goto model from docs/api.md against
// a deterministic seeded wall, so the UI can be built and demoed before the Go
// backend exists. Shanten/ukeire numbers come from src/mockShanten.ts, a cheap
// heuristic engine — NOT the certified backend algorithm.

import type { HistoryEntry, State, TreeNode, Win, YakuRow } from './api';
import { ApiError } from './api';
import { countsFromTiles, indexToTile, parseTile, sortTiles, tileIndex } from './tiles';
import { detectWinYaku, isCompleteHand, shantenForKey, ukeireForKey } from './mockShanten';

const ROWS: Array<{ key: string; name: string }> = [
  { key: 'normal', name: '一般形（役なし）' },
  { key: 'tanyao', name: '断么九' },
  { key: 'pinfu', name: '平和' },
  { key: 'iipeikou', name: '一盃口' },
  { key: 'sanshoku', name: '三色同順' },
  { key: 'ittsu', name: '一気通貫' },
  { key: 'chanta', name: '混全帯么九' },
  { key: 'junchan', name: '純全帯么九' },
  { key: 'honitsu', name: '混一色' },
  { key: 'chinitsu', name: '清一色' },
  { key: 'toitoi', name: '対々和' },
  { key: 'sanankou', name: '三暗刻' },
  { key: 'haku', name: '役牌 白' },
  { key: 'hatsu', name: '役牌 發' },
  { key: 'chun', name: '役牌 中' },
  { key: 'ton', name: '役牌 東（場風・自風）' },
  { key: 'chiitoitsu', name: '七対子' },
  { key: 'kokushi', name: '国士無双' },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWall(seed: number): string[] {
  const deck: string[] = [];
  for (let i = 0; i < 34; i++) {
    const t = indexToTile(i);
    for (let c = 0; c < 4; c++) deck.push(t);
  }
  // Replace one copy of each suit's 5 with the red variant.
  for (const suit of ['m', 'p', 's'] as const) {
    const idx = deck.findIndex((t) => t === `5${suit}`);
    if (idx >= 0) deck[idx] = `0${suit}`;
  }
  const rand = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = deck[i] as string;
    deck[i] = deck[j] as string;
    deck[j] = tmp;
  }
  return deck;
}

function nextDora(indicator: string): string {
  const { suit, rank } = parseTile(indicator);
  if (suit === 'z') {
    if (rank <= 4) return `${(rank % 4) + 1}z`; // winds cycle 1-4
    return `${((rank - 5 + 1) % 3) + 5}z`; // dragons cycle 5-7
  }
  return `${(rank % 9) + 1}${suit}`;
}

interface MockNode {
  id: number;
  parentId: number | null;
  turn: number;
  hand: string[]; // 13 tiles
  draw: string | null;
  discard: string | null;
  status: 'playing' | 'tsumo' | 'exhausted';
  discardsPath: string[];
  children: Map<string, number>;
}

interface MockSession {
  sessionId: string;
  seed: number;
  maxTurns: number;
  drawPool: string[];
  doraIndicators: string[];
  nodes: Map<number, MockNode>;
  nextNodeId: number;
  currentNodeId: number;
}

const sessions = new Map<string, MockSession>();

function computeYakuRows(shantenHand: string[], visibleTiles: string[]): YakuRow[] {
  const visibleCounts = countsFromTiles(visibleTiles);
  return ROWS.map(({ key, name }) => {
    const shanten = shantenForKey(key, shantenHand);
    const approx = key === 'pinfu' && shanten !== null && shanten !== 0;
    const ukeireTiles = shanten !== null ? ukeireForKey(key, shantenHand) : [];
    const ukeire = ukeireTiles.map((tile) => ({
      tile,
      remaining: Math.max(0, 4 - (visibleCounts[tileIndex(tile)] ?? 0)),
    }));
    const ukeire_total = ukeire.reduce((sum, u) => sum + u.remaining, 0);
    return { key, name, shanten, approx, ukeire, ukeire_total };
  });
}

function visibleSetFor(node: MockNode, session: MockSession, drawn: string | null): string[] {
  return [...node.hand, ...(drawn ? [drawn] : []), ...node.discardsPath, ...session.doraIndicators];
}

// 136 tiles - 13 dealt - 14 dead wall (reserved, incl. dora indicator) = 109 live draws.
const LIVE_WALL_DRAWS = 109;
const DEAD_WALL_SIZE = 14;

function wallRemaining(_session: MockSession, turn: number): number {
  // The draw shown at a playing node (or the winning tile at a tsumo node)
  // counts as already taken, so the root (turn 0) reports 108.
  return Math.max(0, LIVE_WALL_DRAWS - turn - 1);
}

function clampMaxTurns(value: number | undefined): number {
  if (!value) return 18; // 0 or omitted -> 18
  return Math.min(109, Math.max(1, Math.floor(value)));
}

function buildState(session: MockSession): State {
  const node = session.nodes.get(session.currentNodeId);
  if (!node) throw new ApiError('node not found', 404);
  const drawn = node.status === 'playing' ? (session.drawPool[node.turn] ?? null) : null;
  const visible = visibleSetFor(node, session, drawn);
  const analysis = computeYakuRows(node.hand, visible);

  let by_discard: Record<string, YakuRow[]> = {};
  let can_tsumo = false;
  if (node.status === 'playing' && drawn) {
    const fourteen = [...node.hand, drawn];
    can_tsumo = isCompleteHand(fourteen);
    const seen = new Set<string>();
    for (const candidate of fourteen) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const remainder = [...fourteen];
      remainder.splice(remainder.indexOf(candidate), 1);
      by_discard[candidate] = computeYakuRows(sortTiles(remainder), visible);
    }
  }

  const history: HistoryEntry[] = [];
  let cursor: MockNode | undefined = node;
  const chain: MockNode[] = [];
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentId === null ? undefined : session.nodes.get(cursor.parentId);
  }
  for (const n of chain) {
    const shantenMap: Record<string, number | null> = {};
    if (n.status === 'tsumo' && n.draw) {
      // Per docs/api.md implementation notes: computed on the 14 winning tiles,
      // -1 for every row the win satisfies, otherwise the distance - 1 (>= 0).
      // shantenForKey's block search already returns -1 for a 14-tile hand that
      // fully satisfies a row's constraints, so this falls out naturally.
      const winTiles = [...n.hand, n.draw];
      for (const { key } of ROWS) shantenMap[key] = shantenForKey(key, winTiles);
    } else {
      const rows = computeYakuRows(n.hand, visibleSetFor(n, session, n.status === 'playing' ? (session.drawPool[n.turn] ?? null) : null));
      for (const r of rows) shantenMap[r.key] = r.shanten;
    }
    history.push({ node_id: n.id, turn: n.turn, draw: n.draw, discard: n.discard, shanten: shantenMap });
  }

  const tree: TreeNode[] = Array.from(session.nodes.values()).map((n) => ({
    node_id: n.id,
    parent_id: n.parentId,
    turn: n.turn,
    draw: n.draw,
    discard: n.discard,
    status: n.status,
    normal_shanten: n.status === 'tsumo' ? -1 : shantenForKey('normal', n.hand),
  }));

  let win: Win | null = null;
  if (node.status === 'tsumo' && node.draw) {
    const tiles = sortTiles([...node.hand, node.draw]);
    const detected = detectWinYaku(tiles);
    // Kokushi is reported alone (han: 13); otherwise 門前清自摸和 is always included
    // (Phase 1 hands are always closed) alongside whatever else was detected.
    const yaku = detected.some((y) => y.key === 'kokushi')
      ? detected.filter((y) => y.key === 'kokushi')
      : [{ key: 'tsumo', name: '門前清自摸和', han: 1 }, ...detected];
    const doraTile = nextDora(session.doraIndicators[0] ?? '1z');
    const doraCount = tiles.filter((t) => tileIndex(t) === tileIndex(doraTile)).length;
    const redCount = tiles.filter((t) => parseTile(t).red).length;
    const dora = doraCount + redCount;
    const han_total = yaku.reduce((s, y) => s + y.han, 0) + dora;
    win = { tiles, yaku, dora, han_total };
  }

  return {
    session_id: session.sessionId,
    seed: session.seed,
    max_turns: session.maxTurns,
    round_wind: '1z',
    seat_wind: '1z',
    node_id: node.id,
    turn: node.turn,
    status: node.status,
    hand: node.hand,
    drawn,
    discards: node.discardsPath,
    dora_indicators: session.doraIndicators,
    wall_remaining: wallRemaining(session, node.turn),
    can_tsumo,
    analysis,
    by_discard,
    history,
    tree,
    win,
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

function randomSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getSessionOrThrow(id: string): MockSession {
  const s = sessions.get(id);
  if (!s) throw new ApiError('session not found', 404);
  return s;
}

export function mockCreateSession(opts: { seed?: number; max_turns?: number } = {}): Promise<State> {
  const seed = opts.seed ?? randomSeed();
  const maxTurns = clampMaxTurns(opts.max_turns);
  const wall = buildWall(seed);
  const drawPool = wall.slice(13, 13 + LIVE_WALL_DRAWS);
  const deadWall = wall.slice(13 + LIVE_WALL_DRAWS, 13 + LIVE_WALL_DRAWS + DEAD_WALL_SIZE);
  const doraIndicators = [deadWall[0] as string];
  const hand = sortTiles(wall.slice(0, 13));
  const root: MockNode = {
    id: 0,
    parentId: null,
    turn: 0,
    hand,
    draw: null,
    discard: null,
    status: maxTurns <= 0 ? 'exhausted' : 'playing',
    discardsPath: [],
    children: new Map(),
  };
  const session: MockSession = {
    sessionId: randomSessionId(),
    seed,
    maxTurns,
    drawPool,
    doraIndicators,
    nodes: new Map([[0, root]]),
    nextNodeId: 1,
    currentNodeId: 0,
  };
  sessions.set(session.sessionId, session);
  return Promise.resolve(buildState(session));
}

export function mockGetSession(id: string): Promise<State> {
  return Promise.resolve(buildState(getSessionOrThrow(id)));
}

export function mockDiscard(id: string, tile: string): Promise<State> {
  const session = getSessionOrThrow(id);
  const node = session.nodes.get(session.currentNodeId) as MockNode;
  if (node.status !== 'playing') throw new ApiError('action not allowed at a terminal node', 409);
  const drawn = session.drawPool[node.turn];
  if (drawn === undefined) throw new ApiError('wall exhausted', 409);
  const fourteen = [...node.hand, drawn];
  if (!fourteen.includes(tile)) throw new ApiError(`tile ${tile} not in hand`, 400);

  let childId = node.children.get(tile);
  if (childId === undefined) {
    const remainder = [...fourteen];
    remainder.splice(remainder.indexOf(tile), 1);
    const turn = node.turn + 1;
    const discardsPath = [...node.discardsPath, tile];
    const status: MockNode['status'] = turn >= session.maxTurns ? 'exhausted' : 'playing';
    childId = session.nextNodeId++;
    session.nodes.set(childId, {
      id: childId,
      parentId: node.id,
      turn,
      hand: sortTiles(remainder),
      draw: drawn,
      discard: tile,
      status,
      discardsPath,
      children: new Map(),
    });
    node.children.set(tile, childId);
  }
  session.currentNodeId = childId;
  return Promise.resolve(buildState(session));
}

export function mockTsumo(id: string): Promise<State> {
  const session = getSessionOrThrow(id);
  const node = session.nodes.get(session.currentNodeId) as MockNode;
  if (node.status !== 'playing') throw new ApiError('action not allowed at a terminal node', 409);
  const drawn = session.drawPool[node.turn];
  if (drawn === undefined) throw new ApiError('wall exhausted', 409);
  if (!isCompleteHand([...node.hand, drawn])) throw new ApiError('hand is not complete', 409);

  const key = '__tsumo__';
  let childId = node.children.get(key);
  if (childId === undefined) {
    childId = session.nextNodeId++;
    session.nodes.set(childId, {
      id: childId,
      parentId: node.id,
      turn: node.turn,
      hand: node.hand,
      draw: drawn,
      discard: null,
      status: 'tsumo',
      discardsPath: node.discardsPath,
      children: new Map(),
    });
    node.children.set(key, childId);
  }
  session.currentNodeId = childId;
  return Promise.resolve(buildState(session));
}

export function mockGoto(id: string, nodeId: number): Promise<State> {
  const session = getSessionOrThrow(id);
  if (!session.nodes.has(nodeId)) throw new ApiError(`node ${nodeId} not found`, 404);
  session.currentNodeId = nodeId;
  return Promise.resolve(buildState(session));
}
