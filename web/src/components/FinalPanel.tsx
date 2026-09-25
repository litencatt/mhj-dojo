import type { GameState, RoundSummary } from '../api';
import { ABORT_NAMES, LENGTH_NAMES, roundName, seatLabel, WIND_NAMES } from './GameTable';
import { deltaClass, signed } from './ResultPanel';

export interface FinalPanelProps {
  state: GameState;
  busy: boolean;
  onNewGame: () => void;
}

/** "+12.3" / "-4.0": the final score with its sign and one decimal. */
function scoreText(score: number): string {
  const s = score.toFixed(1);
  return score > 0 ? `+${s}` : s;
}

/** ツモ / ロン by whom, 流局 or the abortive draw's reason. */
function roundOutcome(r: RoundSummary, you: number): string {
  const who = (s: number) => seatLabel(s, you);
  switch (r.kind) {
    case 'tsumo':
      return `${who(r.winner)} ツモ`;
    case 'ron':
      return `${who(r.winner)} ロン（${who(r.from)}から）`;
    case 'abort':
      return `途中流局（${r.reason ? ABORT_NAMES[r.reason] : ''}）`;
    default:
      return '流局';
  }
}

/** 最終結果: the ranking with points and scores, and every round's outcome. */
export function FinalPanel({ state, busy, onNewGame }: FinalPanelProps) {
  const ranking = [...state.standings].sort((a, b) => a.rank - b.rank);
  // Seats in table order from you: 自分, 下家, 対面, 上家.
  const order = [0, 1, 2, 3].map((rel) => (state.you + rel) % 4);
  return (
    <section class="result-panel final-panel" aria-label="最終結果">
      <div class="result-heading">
        <h2>最終結果（{LENGTH_NAMES[state.length]}）</h2>
        <button type="button" class="next-round-button" disabled={busy} onClick={onNewGame}>
          新しい対局
        </button>
      </div>
      <table class="result-deltas final-ranking">
        <thead>
          <tr>
            <th scope="col">順位</th>
            <th scope="col">席</th>
            <th scope="col">持ち点</th>
            <th scope="col">スコア</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((st) => (
            <tr key={st.seat} class={st.seat === state.you ? 'result-you' : ''}>
              <td>{st.rank}位</td>
              <td>
                {seatLabel(st.seat, state.you)}（{WIND_NAMES[state.seats[st.seat].wind]}）
              </td>
              <td>{st.points.toLocaleString()}</td>
              <td class={deltaClass(st.score)}>{scoreText(st.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="table-scroll">
        <table class="result-deltas final-rounds">
          <caption>局ごとの収支</caption>
          <thead>
            <tr>
              <th scope="col">局</th>
              <th scope="col">結果</th>
              {order.map((s) => (
                <th key={s} scope="col">
                  {seatLabel(s, state.you)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rounds.map((r, i) => (
              <tr key={i}>
                <td>{roundName(r.round_wind, r.round_number, r.honba)}</td>
                <td>{roundOutcome(r, state.you)}</td>
                {order.map((s) => (
                  <td key={s} class={deltaClass(r.deltas[s])}>
                    {r.deltas[s] === 0 ? '' : signed(r.deltas[s])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
