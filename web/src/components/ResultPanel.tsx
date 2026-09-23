import type { GameResult, GameState, Limit, Points } from '../api';
import { seatLabel, WIND_NAMES } from './GameTable';
import { Tile } from './Tile';

const LIMIT_NAMES: Record<Exclude<Limit, ''>, string> = {
  mangan: '満貫',
  haneman: '跳満',
  baiman: '倍満',
  sanbaiman: '三倍満',
  yakuman: '役満',
};

function limitName(p: Points): string {
  if (p.limit === '') return '';
  if (p.limit === 'yakuman' && p.multiplier > 1) return p.multiplier === 2 ? 'ダブル役満' : `${p.multiplier}倍役満`;
  return LIMIT_NAMES[p.limit];
}

/** "8000点", "4000点オール" or "2000-4000点" (non-dealers - dealer). */
function paymentText(p: Points): string {
  if (p.ron) return `${p.ron}点`;
  if (!p.from_dealer) return `${p.from_non_dealer}点オール`;
  return `${p.from_non_dealer}-${p.from_dealer}点`;
}

export interface ResultPanelProps {
  state: GameState;
  result: GameResult;
}

/** End of the round: the winning hand with yaku, fu and points, or the draw, and the point changes. */
export function ResultPanel({ state, result }: ResultPanelProps) {
  const who = (s: number) => seatLabel(s, state.you);
  const winner = result.winner >= 0 ? state.seats[result.winner] : null;
  const yakuman = result.yaku.some((y) => y.han >= 13);
  let title = '流局';
  if (result.kind === 'tsumo') title = `${who(result.winner)}のツモ和了`;
  if (result.kind === 'ron') title = `${who(result.winner)}のロン和了（${who(result.from)}から）`;

  return (
    <section class={result.winner === state.you ? 'result-panel win-panel' : 'result-panel'} aria-label="結果">
      <h2>{title}</h2>
      {winner && result.win_tile && (
        <>
          <div class="win-tiles" role="group" aria-label="和了形">
            {(winner.hand ?? []).map((t, i) => (
              <Tile key={`${t}-${i}`} tile={t} />
            ))}
            <span class="result-win-tile">
              <Tile tile={result.win_tile} label={`和了牌 ${result.win_tile}`} />
            </span>
          </div>
          <table class="win-yaku-table">
            <tbody>
              {result.yaku.map((y) => (
                <tr key={y.key}>
                  <td>{y.name}</td>
                  <td>{y.han}翻</td>
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
        </>
      )}
      <table class="result-deltas">
        <thead>
          <tr>
            <th scope="col">席</th>
            {result.kind === 'draw' && <th scope="col">聴牌</th>}
            <th scope="col">収支</th>
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
              <td class={result.deltas[s.seat] > 0 ? 'delta-plus' : result.deltas[s.seat] < 0 ? 'delta-minus' : ''}>
                {result.deltas[s.seat] > 0 ? '+' : ''}
                {result.deltas[s.seat]}
              </td>
              <td>{s.points.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.deposit > 0 && <p class="muted">供託 {result.deposit / 1000}本は卓に残ります。</p>}
    </section>
  );
}
