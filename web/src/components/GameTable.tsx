import type { AbortReason, GameEvent, GameLength, GameState, RiverTile, Seat, Tile as TileT } from '../api';
import type { PlaybackHighlight } from '../playback';
import { Tile } from './Tile';
import { tileName } from '../tiles';
import { Melds } from './Melds';

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
  state: GameState;
  // A playback in progress overrides what is shown: seats with events not
  // yet revealed hidden, and the tile or meld that last landed. Omitted (or
  // playing: false), the table just shows state as-is. Points, deposit,
  // wall_remaining, dora and opponents' hand_count are always state's own
  // final values, even mid-playback: only the river, melds and riichi badge
  // are ever hidden, so nothing here needs to be undone if a request fails
  // mid-round.
  seats?: Seat[];
  events?: GameEvent[];
  highlight?: PlaybackHighlight | null;
  playing?: boolean;
}

/** The table: each seat's river, points and (hidden) hand around the round
 * info. The skip control lives in the action bar (GameApp), not here. */
export function GameTable({ state, seats, events, highlight, playing = false }: GameTableProps) {
  const view = seats ?? state.seats;
  const log = events ?? state.events;
  const at = (rel: number) => view[(state.you + rel) % 4];
  return (
    <section class="game-table" aria-label="卓" data-playing={playing ? 'true' : 'false'}>
      <SeatBox className="seat-top" seat={at(2)} state={state} highlight={highlight} playing={playing} />
      <SeatBox className="seat-left" seat={at(3)} state={state} highlight={highlight} playing={playing} />
      <div class="table-center">
        <div class="table-round">
          {roundName(state.round_wind, state.round_number, state.honba)}
          <span class="table-remaining">残り {state.wall_remaining}</span>
        </div>
        {state.deposit > 0 && <div class="table-deposit">供託 {state.deposit / 1000}本</div>}
        <ol class="event-log" aria-label="直前の動き">
          {log.slice(-6).map((e, i) => (
            <li key={i}>
              <span class="event-seat">{seatLabel(e.seat, state.you)}</span>
              {EVENT_VERB[e.type]}
              {e.tiles?.map((t, j) => <Tile key={j} tile={t} size="xs" />)}
              {e.tile && <Tile tile={e.tile} size="xs" />}
            </li>
          ))}
        </ol>
      </div>
      <SeatBox className="seat-right" seat={at(1)} state={state} highlight={highlight} playing={playing} />
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
}

function SeatBox({ className, seat, state, highlight, playing }: SeatBoxProps) {
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
      </div>
      {!you && (
        <div class="seat-hand" aria-label="手牌">
          {seat.hand
            ? [...seat.hand, ...(seat.drawn ? [seat.drawn] : [])].map((t, i) => <Tile key={`${t}-${i}`} tile={t} size="xs" />)
            : Array.from({ length: seat.hand_count }, (_, i) => <Tile key={i} tile="" size="xs" faceDown />)}
        </div>
      )}
      <Melds melds={seat.melds} owner={seat.seat} size="xs" />
      <div class="seat-river" aria-label="捨て牌">
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
