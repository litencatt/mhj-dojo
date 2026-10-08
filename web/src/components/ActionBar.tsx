import { useEffect, useState } from 'preact/hooks';
import type { ActionType, Advice, GameState, Tile as TileT } from '../api';
import { REDRAW_COST, SUMMON_COST } from '../dojo/catalog';
import { tileName } from '../tiles';
import { seatLabel } from './GameTable';
import { Tile } from './Tile';

interface ActionBarProps {
  state: GameState;
  busy: boolean;
  myTurn: boolean;
  riichiMode: boolean;
  onRiichiMode: (on: boolean) => void;
  onAction: (type: ActionType, tile?: TileT, tiles?: TileT[]) => void;
  noCalls?: boolean; // dojo: 鳴きなし is on, no pon, chii or open kan offered
  canRedraw: boolean; // dojo: 引き直し is legal and affordable
  summonable?: TileT[]; // dojo: the kinds 牌寄せ may fetch, when legal and affordable
  /** On a phone, the advice to offer as a chip (no advice panel there). */
  advice: Advice | null;
  highlight: string | null; // the hand's marked tile
  onHighlight: (tile: string | null) => void;
}

/** Your options right now: ron / pon / kan / chii / skip on a discard, or on
 * your turn tsumo, kan, riichi, 九種九牌, or a hint. */
export function ActionBar({ state, busy, myTurn, riichiMode, onRiichiMode, onAction, noCalls = false, canRedraw, summonable, advice, highlight, onHighlight }: ActionBarProps) {
  const { legal } = state;
  // 牌寄せ opens a row of the kinds it may fetch; a new state closes it.
  const [summoning, setSummoning] = useState(false);
  useEffect(() => setSummoning(false), [state]);
  if (state.phase === 'ended') return null;
  if (state.phase === 'call' && legal.skip) {
    // The claimed tile is the last move shown: a discard, or an added kan (槍槓).
    const last = state.events[state.events.length - 1];
    return (
      // At the right end, near the drawn tile the hand is played from (Hand.tsx).
      <div class="action-bar action-bar-call" role="group" aria-label="操作">
        <span class="action-hint">
          {last && `${seatLabel(last.seat, state.you)}の${last.type === 'kan' ? '加槓' : '打牌'}`}
          {state.last_discard && <Tile tile={state.last_discard} size="sm" />}
        </span>
        {legal.ron && (
          <button type="button" class="action-primary" disabled={busy} onClick={() => onAction('ron')}>
            ロン
          </button>
        )}
        {legal.pon && !noCalls && (
          <button type="button" disabled={busy} onClick={() => onAction('pon')}>
            ポン
          </button>
        )}
        {legal.kan.length > 0 && !noCalls && (
          <button type="button" disabled={busy} onClick={() => onAction('kan')}>
            カン
          </button>
        )}
        {!noCalls && legal.chii.map((pair) => (
          <button
            key={pair.join()}
            type="button"
            class="action-call"
            aria-label={`チー ${pair.map(tileName).join(' ')} + ${state.last_discard ? tileName(state.last_discard) : ''}`}
            disabled={busy}
            onClick={() => onAction('chii', undefined, pair)}
          >
            チー
            <span class="call-tiles" aria-hidden="true">
              <Tile tile={pair[0]} size="xs" />
              <Tile tile={pair[1]} size="xs" />
              {state.last_discard && (
                <>
                  +<Tile tile={state.last_discard} size="xs" />
                </>
              )}
            </span>
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => onAction('skip')}>
          {legal.ron ? '見逃す' : 'スキップ'}
        </button>
      </div>
    );
  }
  if (!myTurn) return null;
  const riichiAllowed = legal.riichi.length > 0;
  const best = advice?.candidates[0]?.tile;
  return (
    <div class="action-bar" role="group" aria-label="操作">
      {best && (
        // The best discard of the advice; a tap marks it in the hand (again, unmarks).
        <button
          type="button"
          class="action-advice"
          aria-pressed={highlight === best}
          onClick={() => onHighlight(highlight === best ? null : best)}
        >
          おすすめ: {tileName(best)}
        </button>
      )}
      {legal.tsumo && (
        <button type="button" class="action-primary" disabled={busy} onClick={() => onAction('tsumo')}>
          ツモ
        </button>
      )}
      {legal.kan.map((t) => (
        <button
          key={t}
          type="button"
          class="action-call"
          aria-label={`カン ${tileName(t)}`}
          disabled={busy}
          onClick={() => onAction('kan', t)}
        >
          カン
          <span class="call-tiles" aria-hidden="true">
            <Tile tile={t} size="xs" />
          </span>
        </button>
      ))}
      {legal.kyuushu && (
        <button type="button" disabled={busy} onClick={() => onAction('kyuushu')}>
          九種九牌
        </button>
      )}
      {canRedraw && (
        <button type="button" class="action-redraw" disabled={busy} onClick={() => onAction('redraw')}>
          引き直し（{REDRAW_COST}銭）
        </button>
      )}
      {summonable && (
        <button type="button" class="action-redraw" aria-expanded={summoning} disabled={busy} onClick={() => setSummoning(!summoning)}>
          牌寄せ（{SUMMON_COST}銭）
        </button>
      )}
      {summonable && summoning && (
        <div class="summon-picker" role="group" aria-label="寄せる牌">
          {summonable.map((t) => (
            <Tile key={t} tile={t} size="sm" interactive label={`${tileName(t)}を寄せる`} onClick={() => onAction('summon', t)} />
          ))}
        </div>
      )}
      {riichiAllowed && (
        <button
          type="button"
          class={riichiMode ? 'action-riichi active' : 'action-riichi'}
          aria-pressed={riichiMode}
          disabled={busy}
          onClick={() => onRiichiMode(!riichiMode)}
        >
          リーチ
        </button>
      )}
      <span class="action-hint">
        {riichiMode ? (
          <span>
            リーチ宣言牌を<ClickOrTap />（聴牌が残る牌だけ選べます）
          </span>
        ) : state.seats[state.you].riichi ? (
          'リーチ中：和了るかツモ切り'
        ) : (
          <span>
            捨てる牌を<ClickOrTap />
          </span>
        )}
      </span>
    </div>
  );
}

/** 「クリック」, or on a touch screen 「タップ（もう一度で打牌）」: a tap
 * first selects a tile and a second tap discards it (components/Hand.tsx). */
function ClickOrTap() {
  return (
    <>
      <span class="hint-mouse">クリック</span>
      <span class="hint-touch">タップ（もう一度タップで打牌）</span>
      <span class="hint-hybrid">（タッチでは2回タップ）</span>
    </>
  );
}
