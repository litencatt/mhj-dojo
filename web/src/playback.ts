// Replays the CPU moves in a game response one by one instead of snapping
// straight to the final GameState (issue #29).
//
// The server only sends the final state plus the flat list of events that
// produced it (docs/api.md "events"); there is no intermediate state per
// event. Recomputing the whole table client-side (discard legality, calls,
// scoring, ...) would duplicate the server's rules and drift from them.
// Instead this file "reveals" the already-correct final seats progressively:
// it walks `events` backwards from the final seats, undoing each event's
// effect (pop a river tile, pop a meld, un-mark a called tile, ...) down to
// a `base` with nothing from this batch applied, while recording the
// inverse of each undo as a forward "op". Replaying those ops in order over
// `base` reproduces every intermediate frame, always ending exactly on the
// server's final seats.
import type { GameEvent, Meld, RiverTile, Seat, Tile } from './api';

/** One place for the playback timing: ~300-400ms per event, per issue #29. */
export const PLAYBACK_STEP_MS = 350;

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
 * found by matching its kind. */
function undoSelfKan(seats: Seat[], seat: number, tile: Tile | undefined, resolved: Set<number>): Op[] {
  if (tile) {
    const kind = tileKind(tile);
    const idx = seats[seat].melds.findIndex(
      (m, i) => m.type === 'kan' && m.from >= 0 && m.tiles.length === 4 && tileKind(m.tiles[0]) === kind && !resolved.has(i),
    );
    if (idx >= 0) {
      resolved.add(idx);
      const m = seats[seat].melds[idx];
      const finalTiles = m.tiles;
      // The added tile sits second-to-last (the called tile stays last);
      // removing it leaves the original 3-tile pon.
      const preKakan = [...finalTiles.slice(0, -2), finalTiles[finalTiles.length - 1]];
      seats[seat].melds[idx] = { ...m, type: 'pon', tiles: preKakan };
      return [{ kind: 'kakan', seat, index: idx, tiles: finalTiles }];
    }
  }
  const meld = seats[seat].melds.pop();
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

function applyOps(seats: Seat[], ops: Op[]) {
  for (const op of ops) {
    const s = seats[op.seat];
    switch (op.kind) {
      case 'river':
        s.river.push(op.tile);
        break;
      case 'meld':
        s.melds.push(op.meld);
        break;
      case 'kakan':
        s.melds[op.index] = { ...s.melds[op.index], type: 'kan', tiles: op.tiles };
        break;
      case 'riichi':
        s.riichi = op.value;
        break;
      case 'called':
        s.river[op.index].called = true;
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
