import type { GameResult, GameState, Limit, Points } from '../api';
import { ABORT_NAMES, seatLabel, WIND_NAMES } from './GameTable';
import { Tile } from './Tile';
import { tileName } from '../tiles';
import { Melds } from './Melds';
import { yakuHanText, yakumanName } from '../yakumanLabel';
import { COINS_PER_HAN, WIN_BONUS_COINS, XP_PER_HAN, yakuName } from '../dojo/catalog';
import { cheated } from '../dojo/progress';

const HIGH_LIMITS: Limit[] = ['haneman', 'baiman', 'sanbaiman', 'yakuman'];

const LIMIT_NAMES: Record<Exclude<Limit, ''>, string> = {
  mangan: '満貫',
  haneman: '跳満',
  baiman: '倍満',
  sanbaiman: '三倍満',
  yakuman: '役満',
};

function limitName(p: Points): string {
  if (p.limit === '') return '';
  if (p.limit === 'yakuman' && p.multiplier > 1) return yakumanName(p.multiplier);
  return LIMIT_NAMES[p.limit];
}

/** "8000点", "4000点オール" or "2000-4000点" (non-dealers - dealer). */
function paymentText(p: Points): string {
  if (p.ron) return `${p.ron}点`;
  if (!p.from_dealer) return `${p.from_non_dealer}点オール`;
  return `${p.from_non_dealer}-${p.from_dealer}点`;
}

/** "+600", "-1000" or "0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function deltaClass(n: number): string {
  return n > 0 ? 'delta-plus' : n < 0 ? 'delta-minus' : '';
}

/** The honba and riichi-stick parts of a seat's change, when the round had any. */
function breakdown(result: GameResult, seat: number): string {
  const parts: string[] = [];
  const hand = result.hand_deltas[seat];
  if (hand !== 0) parts.push(`${result.kind === 'draw' ? '罰符' : '点数'} ${signed(hand)}`);
  if (result.honba_deltas[seat] !== 0) parts.push(`本場 ${signed(result.honba_deltas[seat])}`);
  if (result.stick_deltas[seat] !== 0) parts.push(`供託 ${signed(result.stick_deltas[seat])}`);
  return parts.join(' / ');
}

export interface ResultPanelProps {
  state: GameState;
  result: GameResult;
  busy: boolean;
  onNext: () => void;
  dojoHan?: number; // a dojo game: the han of your win this round (paid at once), 0 for none
}

/** End of the round: the winning hand with yaku, fu and points, or the draw, and the point changes. */
export function ResultPanel({ state, result, busy, onNext, dojoHan }: ResultPanelProps) {
  const who = (s: number) => seatLabel(s, state.you);
  const winner = result.winner >= 0 ? state.seats[result.winner] : null;
  const yakuman = result.yaku.some((y) => y.han >= 13);
  // Your win at 跳満 or above: the dojo's win effect plays over it (style.css; none unless one is chosen).
  const high = result.winner === state.you && HIGH_LIMITS.includes(result.points.limit);
  let title = '流局';
  if (result.kind === 'abort') title = `途中流局（${result.reason ? ABORT_NAMES[result.reason] : ''}）`;
  if (result.kind === 'tsumo') title = `${who(result.winner)}のツモ和了`;
  if (result.kind === 'ron') title = `${who(result.winner)}のロン和了（${who(result.from)}から）`;

  // A 内訳 column only when honba or riichi sticks moved points this round.
  const split = [0, 1, 2, 3].some((s) => result.honba_deltas[s] !== 0 || result.stick_deltas[s] !== 0);
  // A win of a round with a redraw or a summon pays no 和了祝儀.
  const round = state.rounds[state.rounds.length - 1];
  const bonus = round && cheated(round) ? 0 : WIN_BONUS_COINS;

  return (
    <section class={result.winner === state.you ? 'result-panel win-panel' : 'result-panel'} aria-label="結果">
      <div class="result-heading">
        <h2>{title}</h2>
        {state.can_next && (
          <button type="button" class="next-round-button" disabled={busy} onClick={onNext}>
            次の局へ
          </button>
        )}
      </div>
      {high && <div class="win-effect" data-testid="win-effect" aria-hidden="true" />}
      {!!dojoHan && (
        <p class="dojo-round-reward" data-testid="dojo-round-reward">
          道場の報酬 +{dojoHan * COINS_PER_HAN + bonus} 銭（和了 +{dojoHan * COINS_PER_HAN}、
          {bonus ? `和了祝儀 +${bonus}` : 'イカサマ使用のため和了祝儀なし'}）・稽古 +{dojoHan * XP_PER_HAN}
        </p>
      )}
      {winner && result.win_tile && (
        <>
          <div class="win-tiles" role="group" aria-label="和了形">
            {(winner.hand ?? []).map((t, i) => (
              <Tile key={`${t}-${i}`} tile={t} />
            ))}
            <span class="result-win-tile">
              <Tile tile={result.win_tile} label={`和了牌 ${tileName(result.win_tile)}`} />
            </span>
            <Melds melds={winner.melds} owner={winner.seat} size="sm" />
          </div>
          <table class="win-yaku-table">
            <tbody>
              {result.yaku.map((y) => (
                <tr key={y.key}>
                  <td>{y.name}</td>
                  <td>{yakuHanText(y.han)}</td>
                </tr>
              ))}
              {/* Dojo: the yaku the hand had but the player has not learned count for nothing. */}
              {result.excluded?.map((k) => (
                <tr key={`excluded-${k}`} class="yaku-excluded">
                  <td>{yakuName(k)}</td>
                  <td>未修得</td>
                </tr>
              ))}
              {!yakuman && result.dora > 0 && (
                <tr>
                  <td>ドラ</td>
                  <td>{result.dora}翻</td>
                </tr>
              )}
              {!yakuman && result.ura_dora > 0 && (
                <tr>
                  <td>裏ドラ</td>
                  <td>{result.ura_dora}翻</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">
                  {yakuman ? '' : `${result.fu}符 ${result.han}翻`} {limitName(result.points)}
                </th>
                <td>{paymentText(result.points)}</td>
              </tr>
            </tfoot>
          </table>
          {result.pao.map((p) => (
            <p key={p.yaku} class="result-pao">
              包: {who(p.seat)}（{result.yaku.find((y) => y.key === p.yaku)?.name ?? p.yaku}）
            </p>
          ))}
        </>
      )}
      <table class="result-deltas">
        <thead>
          <tr>
            <th scope="col">席</th>
            {result.kind === 'draw' && <th scope="col">聴牌</th>}
            <th scope="col">収支</th>
            {split && <th scope="col">内訳</th>}
            <th scope="col">持ち点</th>
          </tr>
        </thead>
        <tbody>
          {state.seats.map((s) => (
            <tr key={s.seat} class={s.seat === state.you ? 'result-you' : ''}>
              <td>
                {who(s.seat)}（{WIND_NAMES[s.wind]}）
              </td>
              {result.kind === 'draw' && <td>{result.tenpai[s.seat] ? '聴牌' : 'ノーテン'}</td>}
              <td class={deltaClass(result.deltas[s.seat])}>{signed(result.deltas[s.seat])}</td>
              {split && <td class="result-breakdown">{breakdown(result, s.seat)}</td>}
              <td>{s.points.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.deposit > 0 && <p class="muted">供託 {result.deposit / 1000}本は卓に残ります。</p>}
    </section>
  );
}
