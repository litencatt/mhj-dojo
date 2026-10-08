// Replays the CPU moves in a game response one by one instead of snapping
// straight to the final GameState (issue #29).
//
// The engine only sends the final state plus the flat list of events that
// produced it (docs/api.md "events"); there is no intermediate state per
// event. Recomputing the whole table in the page (discard legality, calls,
// scoring, ...) would duplicate the engine's rules and drift from them.
// Instead this file "reveals" the already-correct final seats progressively:
// it walks `events` backwards from the final seats, undoing each event's
// effect (pop a river tile, pop a meld, un-mark a called tile, ...) down to
// a `base` with nothing from this batch applied, while recording the
// inverse of each undo as a forward "op". Replaying those ops in order over
// `base` reproduces every intermediate frame, always ending exactly on the
// engine's final seats.
//
// The table's numbers (points, riichi sticks, wall, dora, the other seats'
// hand sizes) follow the same steps: see playbackState.
import type { GameEvent, GameState, Meld, RiverTile, Seat, Standing, Tile } from './api';

/** The playback pace (ms per event; "none" reveals everything at once). The
 * default is ~300-400ms per event, per issue #29. */
export const PLAYBACK_SPEEDS = {
  slow: { label: '遅い', ms: 700 },
  normal: { label: '普通', ms: 350 },
  fast: { label: '速い', ms: 150 },
  none: { label: 'なし', ms: 0 },
} as const;
export type PlaybackSpeed = keyof typeof PLAYBACK_SPEEDS;

const SPEED_KEY = 'mhj-dojo.playback-speed.v1';
// The dojo keeps its own choice, limited to the speeds it owns (setDojoSpeeds).
const DOJO_SPEED_KEY = 'mhj-dojo.dojo.playback-speed.v1';

let dojoSpeeds: readonly PlaybackSpeed[] | null = null;

/** Scopes the speed to the dojo and its owned speeds, or (null) to the CPU game's own setting. */
export function setDojoSpeeds(owned: readonly PlaybackSpeed[] | null) {
  dojoSpeeds = owned;
}

export function loadPlaybackSpeed(): PlaybackSpeed {
  try {
    const v = localStorage.getItem(dojoSpeeds ? DOJO_SPEED_KEY : SPEED_KEY);
    if (v && Object.hasOwn(PLAYBACK_SPEEDS, v) && (!dojoSpeeds || dojoSpeeds.includes(v as PlaybackSpeed))) return v as PlaybackSpeed;
  } catch {
    // Storage unavailable: use the default.
  }
  return 'normal';
}

export function savePlaybackSpeed(speed: PlaybackSpeed) {
  try {
    localStorage.setItem(dojoSpeeds ? DOJO_SPEED_KEY : SPEED_KEY, speed);
  } catch {
    // Storage unavailable: the choice just won't persist.
  }
}

/** The current step delay in ms, read when needed so a change applies at once. */
export function playbackStepMs(): number {
  return PLAYBACK_SPEEDS[loadPlaybackSpeed()].ms;
}

type Op =
  | { kind: 'river'; seat: number; tile: RiverTile }
  | { kind: 'meld'; seat: number; meld: Meld }
  // An added kan (加槓) grows an existing meld in place instead of pushing a
  // new one, so it is revealed by replacing that meld's tiles, not pushing.
  | { kind: 'kakan'; seat: number; index: number; tiles: Tile[] }
  // `value` is the seat's *final* riichi flag: a riichi is only accepted
  // (points -1000, the badge shown) once it passes unclaimed or is called,
  // so a discard offered in the same response the round paused on (a call
  // phase awaiting the human) can land with the flag still false.
  | { kind: 'riichi'; seat: number; value: boolean }
  | { kind: 'called'; seat: number; index: number };

export interface PlaybackHighlight {
  seat: number;
  kind: 'river' | 'meld';
  index: number;
}

export interface PlaybackBuild {
  base: Seat[];
  opsPerEvent: Op[][];
}

function cloneSeats(seats: Seat[]): Seat[] {
  if (typeof structuredClone === 'function') return structuredClone(seats);
  return JSON.parse(JSON.stringify(seats)) as Seat[];
}

/** A red five (0m/0p/0s) is the same kind as its plain tile for matching a
 * kan's kind against an existing meld. */
function tileKind(t: Tile): string {
  return t[0] === '0' ? `5${t[1]}` : t;
}

function lastCalledIndex(river: RiverTile[]): number {
  for (let i = river.length - 1; i >= 0; i--) {
    if (river[i].called) return i;
  }
  return -1;
}

/** Undoes a pon/chii/open-kan: pop the caller's new meld, and un-mark the
 * discarder's river tile it was called from. */
function undoCalledMeld(seats: Seat[], seat: number): Op[] {
  const meld = seats[seat].melds.pop();
  if (!meld) return [];
  const ops: Op[] = [{ kind: 'meld', seat, meld }];
  if (meld.from >= 0) {
    const idx = lastCalledIndex(seats[meld.from].river);
    if (idx >= 0) {
      seats[meld.from].river[idx].called = false;
      ops.push({ kind: 'called', seat: meld.from, index: idx });
    }
  }
  return ops;
}

/** Undoes a self-declared kan on the seat's own turn: a concealed kan
 * (ankan, a brand-new meld) or an added kan (kakan, growing an existing pon
 * in place - see internal/game/calls.go completeKakan). Both report as
 * `{type: "kan"}` with no `tiles`, so the existing meld it grew, if any, is
 * found by matching its kind.
 *
 * completeKakan runs only once the added tile passes every other seat's
 * chankan (robbing) opportunity unclaimed: selfKan appends the `kan` event
 * right away, before that is decided. So by the time this response's final
 * seats are read, the meld the kakan targets may still be a 3-tile pon -
 * either it was robbed (the round ended on someone else's ron) or the human
 * is the one being offered chankan and this response paused right there.
 * Either way the meld itself is unchanged by this event: nothing to reveal. */
function undoSelfKan(seats: Seat[], seat: number, tile: Tile | undefined, resolved: Set<number>): Op[] {
  if (tile) {
    const kind = tileKind(tile);
    const kanIdx = seats[seat].melds.findIndex(
      (m, i) => m.type === 'kan' && m.from >= 0 && m.tiles.length === 4 && tileKind(m.tiles[0]) === kind && !resolved.has(i),
    );
    if (kanIdx >= 0) {
      resolved.add(kanIdx);
      const m = seats[seat].melds[kanIdx];
      const finalTiles = m.tiles;
      // The added tile sits second-to-last (the called tile stays last);
      // removing it leaves the original 3-tile pon.
      const preKakan = [...finalTiles.slice(0, -2), finalTiles[finalTiles.length - 1]];
      seats[seat].melds[kanIdx] = { ...m, type: 'pon', tiles: preKakan };
      return [{ kind: 'kakan', seat, index: kanIdx, tiles: finalTiles }];
    }
    const stillPon = seats[seat].melds.some((m) => m.type === 'pon' && m.from >= 0 && tileKind(m.tiles[0]) === kind);
    if (stillPon) return []; // robbed, or pending a chankan decision: nothing changed yet
  }
  const meld = seats[seat].melds.pop(); // a brand-new concealed kan (ankan)
  return meld ? [{ kind: 'meld', seat, meld }] : [];
}

/** Builds the pre-events base and the per-event forward ops that replay
 * `events` on top of it, ending on `finalSeats`. */
export function buildPlayback(finalSeats: Seat[], events: GameEvent[]): PlaybackBuild {
  const seats = cloneSeats(finalSeats);
  const opsPerEvent: Op[][] = new Array(events.length);
  // Meld indices already matched to a kakan undo, per seat.
  const resolvedBySeat = new Map<number, Set<number>>();

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    let ops: Op[];
    switch (e.type) {
      case 'discard': {
        const rt = seats[e.seat].river.pop();
        ops = rt ? [{ kind: 'river', seat: e.seat, tile: rt }] : [];
        break;
      }
      case 'riichi': {
        const rt = seats[e.seat].river.pop();
        const value = finalSeats[e.seat].riichi;
        seats[e.seat].riichi = false;
        const riichiOp: Op = { kind: 'riichi', seat: e.seat, value };
        ops = rt ? [{ kind: 'river', seat: e.seat, tile: rt }, riichiOp] : [riichiOp];
        break;
      }
      case 'pon':
      case 'chii':
        ops = undoCalledMeld(seats, e.seat);
        break;
      case 'kan':
        if (e.tiles && e.tiles.length > 0) {
          ops = undoCalledMeld(seats, e.seat); // daiminkan: an open kan claimed from a discard
        } else {
          let resolved = resolvedBySeat.get(e.seat);
          if (!resolved) {
            resolved = new Set<number>();
            resolvedBySeat.set(e.seat, resolved);
          }
          ops = undoSelfKan(seats, e.seat, e.tile, resolved);
        }
        break;
      default: // tsumo, ron, kyuushu, skip: no table change
        ops = [];
    }
    opsPerEvent[i] = ops;
  }
  return { base: seats, opsPerEvent };
}

// Ops are built once in buildPlayback and replayed on a fresh clone for
// every frame (see playbackFrame): pushing or writing through an op's own
// object would mutate that shared object, poisoning every earlier frame
// too (a 'called' op flips a tile that a 'river' op from an earlier step
// also points at). Every write below copies instead.
function applyOps(seats: Seat[], ops: Op[]) {
  for (const op of ops) {
    const s = seats[op.seat];
    switch (op.kind) {
      case 'river':
        s.river.push({ ...op.tile });
        break;
      case 'meld':
        s.melds.push({ ...op.meld, tiles: [...op.meld.tiles] });
        break;
      case 'kakan':
        s.melds[op.index] = { ...s.melds[op.index], type: 'kan', tiles: [...op.tiles] };
        break;
      case 'riichi':
        s.riichi = op.value;
        break;
      case 'called':
        s.river[op.index] = { ...s.river[op.index], called: true };
        break;
    }
  }
}

/** The seats revealed after `step` of `build`'s events have played. `step`
 * is clamped to `build`'s own event count: a caller may briefly hold a step
 * from a previous, longer-lived build (e.g. a React ref not yet reset for a
 * newly-arrived state) between that state landing and its effect running. */
export function playbackFrame(build: PlaybackBuild, step: number): Seat[] {
  const seats = cloneSeats(build.base);
  const n = Math.min(step, build.opsPerEvent.length);
  for (let i = 0; i < n; i++) applyOps(seats, build.opsPerEvent[i]);
  return seats;
}

/** What just landed at `step` (1-based, matching `playbackFrame`), for the
 * "latest discard" highlight. */
export function playbackHighlight(build: PlaybackBuild, seats: Seat[], step: number): PlaybackHighlight | null {
  if (step <= 0 || step > build.opsPerEvent.length) return null;
  for (const op of build.opsPerEvent[step - 1]) {
    if (op.kind === 'river') return { seat: op.seat, kind: 'river', index: seats[op.seat].river.length - 1 };
    if (op.kind === 'meld') return { seat: op.seat, kind: 'meld', index: seats[op.seat].melds.length - 1 };
    if (op.kind === 'kakan') return { seat: op.seat, kind: 'meld', index: op.index };
  }
  return null;
}

const RIICHI_STICK = 1000;

// A seat between turns holds 13 concealed tiles, less 3 per meld (a kan's
// fourth tile is made up by its replacement draw).
function restingHandCount(seat: Seat): number {
  return 13 - 3 * seat.melds.length;
}

// Whether the move that landed at `step` was a call by seat that left it
// holding a tile to discard. An added kan that was robbed (or waits on a
// chankan decision) changed no meld, and drew no replacement tile.
function heldAfterCall(build: PlaybackBuild, events: GameEvent[], step: number, seat: number): boolean {
  const e = events[step - 1];
  if (!e || e.seat !== seat) return false;
  if (e.type === 'kan') return build.opsPerEvent[step - 1].length > 0;
  return e.type === 'pon' || e.type === 'chii';
}

/** Ranks by points, ties to the seat nearer the first dealer (as
 * internal/game Hanchan.Standings). */
function rankStandings(state: GameState, seats: Seat[]): Standing[] {
  const near = (s: number) => (s - state.first_dealer + 4) % 4;
  const order = [0, 1, 2, 3].sort((a, b) => seats[b].points - seats[a].points || near(a) - near(b));
  return state.standings.map((sd) => ({ ...sd, points: seats[sd.seat].points, rank: order.indexOf(sd.seat) + 1 }));
}

/** `state` as the table stood after `step` of its events had played: the
 * seats of playbackFrame, and the points, riichi sticks, wall, dora and
 * ranks that go with them, with no ura dora yet. At the last step it is
 * `state` itself.
 *
 * The wall and the kan dora come with each event (docs/api.md "events"),
 * the wall before the first as events_wall_remaining.
 * The rest is undone from the final state: a round result's deltas (the
 * settlement only shows once the playback ends), then each accepted riichi
 * still to play (its 1000 back from the table). The other seats' hands are
 * face down until the end, holding 13 tiles less 3 per meld, one more right
 * after their own call (the draw before a discard is not an event). */
export function playbackState(state: GameState, build: PlaybackBuild, step: number): GameState {
  const { events } = state;
  const total = build.opsPerEvent.length;
  if (step >= total) return state;
  const seats = playbackFrame(build, step);
  let deposit = state.deposit;
  const res = state.result;
  if (res) {
    const riichi = (s: number) => (state.seats[s].riichi ? RIICHI_STICK : 0);
    for (const s of seats) s.points -= res.deltas[s.seat] + riichi(s.seat);
    if (res.winner >= 0) deposit = res.stick_deltas[res.winner] + riichi(res.winner);
  }
  let hiddenDora = 0;
  for (let i = step; i < total; i++) {
    const e = events[i];
    if (e.type === 'riichi' && state.seats[e.seat].riichi) {
      seats[e.seat].points += RIICHI_STICK;
      deposit -= RIICHI_STICK;
    }
    hiddenDora += e.new_dora_indicators?.length ?? 0;
  }
  for (const s of seats) {
    if (s.seat === state.you) continue;
    s.hand_count = restingHandCount(s) + (heldAfterCall(build, events, step, s.seat) ? 1 : 0);
    delete s.hand;
    delete s.drawn;
    if (!s.riichi) delete s.waits; // the dojo's riichi waits, once the riichi has played
  }
  const shown = state.dora_indicators.length - hiddenDora;
  return {
    ...state,
    seats,
    events: events.slice(0, step),
    // An engine from before these fields (a cached wasm) sends neither.
    wall_remaining: (step > 0 ? events[step - 1].wall_remaining : state.events_wall_remaining) ?? state.wall_remaining,
    deposit,
    dora_indicators: state.dora_indicators.slice(0, shown),
    dora: state.dora.slice(0, shown),
    ura_dora_indicators: [], // turned over with the result
    ura_dora: [],
    standings: rankStandings(state, seats),
  };
}
