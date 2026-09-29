import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { AbortReason, GameEvent, GameLength, GameState, RiverTile, Seat, Tile as TileT } from '../api';
import type { PlaybackHighlight } from '../playback';
import { Tile } from './Tile';
import { tileName } from '../tiles';
import { Melds } from './Melds';
import { useRiversShown } from '../panels';

export const WIND_NAMES: Record<string, string> = { '1z': '東', '2z': '南', '3z': '西', '4z': '北' };
const RELATIVE = ['自分', '下家', '対面', '上家'];
export const LENGTH_NAMES: Record<GameLength, string> = { tonpuu: '東風戦', hanchan: '半荘戦' };
export const ABORT_NAMES: Record<AbortReason, string> = { kyuushu: '九種九牌', suufon: '四風連打', suucha: '四家立直', suukaikan: '四開槓' };

/** 「東1局」, with 「 1本場」 when the honba is above zero. */
export function roundName(wind: TileT, number: number, honba: number): string {
  return `${WIND_NAMES[wind]}${number}局${honba > 0 ? ` ${honba}本場` : ''}`;
}

/** 自分 / 下家 / 対面 / 上家 for a seat, relative to you. */
export function seatLabel(seat: number, you: number): string {
  return RELATIVE[(seat - you + 4) % 4];
}

const EVENT_VERB: Record<GameEvent['type'], string> = {
  discard: '打',
  riichi: 'リーチ 打',
  tsumo: 'ツモ',
  ron: 'ロン',
  skip: '見逃し',
  kyuushu: '九種九牌',
  pon: 'ポン',
  chii: 'チー',
  kan: 'カン',
};

export interface GameTableProps {
  // The table as shown: during a playback, state as it stood at the
  // current step (usePlayback's view: events not yet played hidden, and the
  // points, deposit, wall, dora and hand counts of that step).
  state: GameState;
  // The round's moves so far, oldest first; state.events if omitted.
  log?: GameEvent[];
  highlight?: PlaybackHighlight | null;
  playing?: boolean;
}

/** The table: each seat's river, points and (hidden) hand around the round
 * info and the round's moves. The skip control lives in the action bar
 * (GameApp), not here. */
export function GameTable({ state, log = state.events, highlight, playing = false }: GameTableProps) {
  const at = (rel: number) => state.seats[(state.you + rel) % 4];
  const logRef = useRef<HTMLOListElement>(null);
  const rivers = useRiversShown();
  // The newest move stays in sight: the log scrolls to its end as moves land
  // (its bottom, or on a phone, where it runs sideways, its right end), and
  // when it comes back on an upright phone, where the rivers stand in for it
  // while they are shown (style.css).
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    }
  }, [log.length, rivers.shown]);
  // A phone turned on its side keeps the newest in sight too.
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      el.scrollLeft = el.scrollWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <section
      class="game-table"
      aria-label="卓"
      data-playing={playing ? 'true' : 'false'}
      data-rivers={rivers.shown ? 'shown' : 'hidden'}
    >
      <SeatBox className="seat-top" seat={at(2)} state={state} highlight={highlight} playing={playing} riverId="river-top" />
      <SeatBox className="seat-left" seat={at(3)} state={state} highlight={highlight} playing={playing} riverId="river-left" />
      <div class="table-center">
        <div class="table-round">
          {roundName(state.round_wind, state.round_number, state.honba)}
          <span class="table-remaining">残り {state.wall_remaining}</span>
          {/* Phones only (style.css): the other seats' rivers fold away. */}
          <button
            type="button"
            class="rivers-toggle"
            aria-expanded={rivers.shown}
            aria-controls="river-top river-left river-right"
            onClick={rivers.toggle}
          >
            捨て牌<span aria-hidden="true">{rivers.shown ? ' ▴' : ' ▾'}</span>
          </button>
        </div>
        {state.deposit > 0 && <div class="table-deposit">供託 {state.deposit / 1000}本</div>}
        {/* Focusable so a keyboard can scroll it too. */}
        <ol ref={logRef} class="event-log" aria-label="この局の動き" tabIndex={0}>
          {log.map((e, i) => (
            <li key={i}>
              <span class="event-seat">{seatLabel(e.seat, state.you)}</span>
              <span class={e.type === 'discard' ? 'event-verb event-verb-discard' : 'event-verb'}>{EVENT_VERB[e.type]}</span>
              {(e.tiles || e.tile) && (
                <span class="event-tiles">
                  {e.tiles?.map((t, j) => <Tile key={j} tile={t} size="xs" />)}
                  {e.tile && <Tile tile={e.tile} size="xs" />}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <SeatBox className="seat-right" seat={at(1)} state={state} highlight={highlight} playing={playing} riverId="river-right" />
      <SeatBox className="seat-bottom" seat={at(0)} state={state} highlight={highlight} playing={playing} />
    </section>
  );
}

interface SeatBoxProps {
  className: string;
  seat: Seat;
  state: GameState;
  highlight?: PlaybackHighlight | null;
  playing: boolean;
  riverId?: string; // a CPU seat's river, which the rivers toggle controls
}

function SeatBox({ className, seat, state, highlight, playing, riverId }: SeatBoxProps) {
  const you = seat.seat === state.you;
  // state.actor is who acts once the (possibly still-playing-back) events
  // have all landed: showing it mid-playback would point at the wrong seat.
  const acting = !playing && state.actor === seat.seat;
  const landed = highlight?.seat === seat.seat;
  const classes = ['seat-box', className];
  if (acting) classes.push('seat-acting');
  if (landed && highlight?.kind === 'meld') classes.push('seat-landed');
  return (
    <div class={classes.join(' ')} aria-label={seatLabel(seat.seat, state.you)}>
      <div class="seat-head">
        <span class="seat-name">{seatLabel(seat.seat, state.you)}</span>
        <span class={seat.seat === state.dealer ? 'seat-wind seat-dealer' : 'seat-wind'}>{WIND_NAMES[seat.wind]}</span>
        <span class="seat-points">{seat.points.toLocaleString()}</span>
        <span class="seat-rank" title="現在の順位">{state.standings[seat.seat].rank}位</span>
        {seat.riichi && <span class="seat-riichi">リーチ</span>}
        {!you && !seat.hand && (
          // Face down: a row of backs under the head, or on a phone one
          // back with the count on it, in the head itself (style.css), so
          // the seat stays short.
          <div class="seat-hand seat-hand-hidden">
            <span class="visually-hidden">手牌 {seat.hand_count}枚</span>
            <span class="seat-hand-backs" aria-hidden="true">
              {Array.from({ length: seat.hand_count }, (_, i) => <Tile key={i} tile="" size="xs" faceDown />)}
            </span>
            <span class="seat-hand-count" aria-hidden="true">
              {seat.hand_count}
            </span>
          </div>
        )}
      </div>
      {!you && seat.hand && (
        <div class="seat-hand" aria-label="手牌">
          {[...seat.hand, ...(seat.drawn ? [seat.drawn] : [])].map((t, i) => <Tile key={`${t}-${i}`} tile={t} size="xs" />)}
        </div>
      )}
      <Melds melds={seat.melds} owner={seat.seat} size="xs" />
      <div id={riverId} class="seat-river" aria-label="捨て牌">
        {seat.river.map((r, i) => (
          <span key={i} class={r.riichi ? 'river-tile river-riichi' : 'river-tile'}>
            <Tile
              tile={r.tile}
              size="xs"
              dimmed={r.called}
              label={riverLabel(r)}
              className={landed && highlight?.kind === 'river' && highlight.index === i ? 'tile-landed' : undefined}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function riverLabel(r: RiverTile): string | undefined {
  const notes = [r.riichi && 'リーチ宣言牌', r.called && '鳴かれた牌'].filter(Boolean);
  return notes.length > 0 ? `${tileName(r.tile)}（${notes.join('・')}）` : undefined;
}
