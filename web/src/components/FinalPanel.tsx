import type { GameState, RoundSummary } from '../api';
import { ABORT_NAMES, LENGTH_NAMES, roundName, seatLabel, WIND_NAMES } from './GameTable';
import { deltaClass, signed } from './ResultPanel';
import { CATALOG } from '../dojo/catalog';
import { cheated, type Reward } from '../dojo/progress';
import { rankMultiplierLabel, rankName } from '../dojo/rules';

export interface FinalPanelProps {
  state: GameState;
  busy: boolean;
  onNewGame: () => void;
  /** A dojo game: the reward just paid (null: it was paid before) and the button's label. */
  dojo?: { reward: Reward | null; newLabel: string; saveFailed?: boolean };
}

/** 道場の報酬: XP, coins, the redraws' and summons' cost, the level-up and what it unlocked. */
function DojoReward({ reward, state }: { reward: Reward | null; state: GameState }) {
  if (!reward) return <p class="muted dojo-reward">この対局の報酬は受け取り済みです。</p>;
  const unlocked = reward.levelAfter > reward.levelBefore
    ? CATALOG.filter((it) => it.level > reward.levelBefore && it.level <= reward.levelAfter)
    : [];
  const multiplier = reward.rankMultiplier !== 1 ? `（${rankMultiplierLabel(state.length, state.cpu)}）` : '';
  return (
    <div class="dojo-reward" data-testid="dojo-reward">
      <h3>道場の報酬</h3>
      <ul>
        <li>
          稽古 +{reward.xp}
          {multiplier && `（順位 +${reward.rankXp}${multiplier}）`}
        </li>
        <li>
          銭 {signed(reward.coins)}（順位 +{reward.rankCoins}{multiplier}
          {reward.wins > 0 && `、和了 +${reward.hanCoins}、和了祝儀 +${reward.winBonusCoins}${cheatedNote(reward)}${paidNote(reward)}`}
          {reward.firstGameBonus > 0 && `、初回ボーナス +${reward.firstGameBonus}`}
          {reward.redraws > 0 && `、引き直し ${reward.redraws}回 -${reward.redrawCost}`}
          {reward.summons > 0 && `、牌寄せ ${reward.summons}回 -${reward.summonCost}`}）
        </li>
        {reward.levelAfter > reward.levelBefore && (
          <li class="dojo-levelup">{reward.levelAfter > 10 ? '昇段' : '昇級'}！ {rankName(reward.levelBefore)} → {rankName(reward.levelAfter)}</li>
        )}
        {unlocked.length > 0 && <li>ショップに解禁: {unlocked.map((it) => it.name).join('、')}</li>}
      </ul>
    </div>
  );
}

/** The wins of rounds with a redraw or a summon, which paid no 和了祝儀. */
function cheatedNote(r: Reward): string {
  return r.cheatedWins > 0 ? `（イカサマ使用の ${r.cheatedWins} 局は祝儀なし）` : '';
}

/** The part of the wins' coins (han and 和了祝儀) paid as the rounds ended, if any. */
function paidNote(r: Reward): string {
  if (r.paidCoins === 0) return '';
  return r.paidCoins === r.hanCoins + r.winBonusCoins ? '（局ごとに受け取り済み）' : `（うち ${r.paidCoins} は局ごとに受け取り済み）`;
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
export function FinalPanel({ state, busy, onNewGame, dojo }: FinalPanelProps) {
  const ranking = [...state.standings].sort((a, b) => a.rank - b.rank);
  // Seats in table order from you: 自分, 下家, 対面, 上家.
  const order = [0, 1, 2, 3].map((rel) => (state.you + rel) % 4);
  return (
    <section class="result-panel final-panel" aria-label="最終結果">
      <div class="result-heading">
        <h2>最終結果（{LENGTH_NAMES[state.length]}）</h2>
        <button type="button" class="next-round-button" disabled={busy} onClick={onNewGame}>
          {dojo ? dojo.newLabel : '新しい対局'}
        </button>
      </div>
      {dojo && <DojoReward reward={dojo.reward} state={state} />}
      {dojo?.saveFailed && (
        <p class="dojo-notice" role="alert">
          報酬を保存できませんでした（ブラウザの保存領域を確認してください）。
        </p>
      )}
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
                <td>
                  {roundOutcome(r, state.you)}
                  {/* Dojo: a round with a redraw or a summon; its win paid no 和了祝儀. */}
                  {cheated(r) && (
                    <span class="dojo-cheated">
                      {(r.han ?? 0) > 0 ? '（イカサマ使用・祝儀なし）' : '（イカサマ使用）'}
                    </span>
                  )}
                </td>
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
