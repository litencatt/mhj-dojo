// The parts of the practice problems' page (QuizApp): the picker of a
// many-tile answer, the table of an oshihiki problem, and the grading with
// each kind's table (the ranking, machi's waits, oshihiki's dangers).
import type { ProblemResult, ProblemSeat, Tile as TileT } from '../api';
import { River } from '../components/GameTable';
import { Melds } from '../components/Melds';
import { Tile } from '../components/Tile';
import { tileName } from '../tiles';
import { MAX_PICKS, PICKER_ROWS, kindKey, seatName, shantenLabel, type AnswerMark } from './quiz';

interface QuizPickerProps {
  picked: TileT[];
  marks: Record<TileT, AnswerMark>;
  disabled: boolean;
  onPick: (t: TileT) => void;
  onSubmit: () => void;
}

/**
 * A many-tile answer (machi): every tile kind, a row per suit, each a toggle
 * (aria-pressed), then 答える with the count picked. Once graded, the waits
 * are raised and the tiles answered that are not waits outlined in red.
 */
export function QuizPicker({ picked, marks, disabled, onPick, onSubmit }: QuizPickerProps) {
  const full = picked.length >= MAX_PICKS;
  return (
    <section class="quiz-picker" aria-label="待ちの牌を選ぶ">
      {PICKER_ROWS.map((row, i) => (
        <div key={i} class="quiz-picker-row" role="group" aria-label={PICKER_ROW_NAMES[i]}>
          {row.map((t) => {
            const on = picked.includes(t);
            const mark = marks[t];
            return (
              <Tile
                key={t}
                tile={t}
                size="sm"
                interactive={!disabled && (on || !full)}
                button
                pressed={on}
                className={mark?.className ?? (on ? 'tile-quiz-picked' : undefined)}
                label={mark ? `${tileName(t)}、${mark.text}` : undefined}
                onClick={() => onPick(t)}
              />
            );
          })}
        </div>
      ))}
      {!disabled && (
        <div class="quiz-actions">
          <button type="button" class="dojo-start" disabled={picked.length === 0} onClick={onSubmit}>
            答える
          </button>
          <span class="muted" aria-live="polite">
            {picked.length}種を選択{full && `（${MAX_PICKS}種まで）`}
          </span>
        </div>
      )}
    </section>
  );
}

const PICKER_ROW_NAMES = ['萬子', '筒子', '索子', '字牌'];

interface QuizResultProps {
  many: boolean;
  result: ProblemResult;
  answer: TileT[];
  busy: boolean;
  nextRef: { current: HTMLButtonElement | null };
  onNext: () => void;
}

/** The grading: 正解 or 不正解, the explanation, every choice ranked (the answer's row marked) and 次の問題. */
export function QuizResult({ many, result, answer, busy, nextRef, onNext }: QuizResultProps) {
  // 待ち only counts at 1-shanten: a column of dashes says nothing.
  const showWait = result.ranking.some((e) => e.wait !== null);
  return (
    <section class="quiz-result" aria-labelledby="quiz-verdict">
      <div class="quiz-result-heading">
        <h2 id="quiz-verdict">
          <span class={result.correct ? 'dojo-aid-ok' : 'dojo-aid-warn'}>{result.correct ? '正解' : '不正解'}</span>
        </h2>
        <span class="quiz-best">
          正解：
          {result.best.map((t) => (
            <Tile key={t} tile={t} size="sm" />
          ))}
        </span>
      </div>
      <p class={result.correct ? 'advice-review advice-review-best' : 'advice-review'}>{result.text}</p>
      {many ? (
        <MachiTable result={result} answer={answer} />
      ) : result.ranking[0]?.danger !== undefined ? (
        <DangerTable result={result} answer={answer} />
      ) : (
        <table class="quiz-ranking">
          <caption class="visually-hidden">切る牌ごとの順位</caption>
          <thead>
            <tr>
              <th scope="col">順位</th>
              <th scope="col">打牌</th>
              <th scope="col">向聴</th>
              <th scope="col">有効牌</th>
              {showWait && (
                <th scope="col" title="聴牌したときの待ちの枚数の平均">
                  待ち
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {result.ranking.map((e) => {
              const mine = answer.includes(e.tile);
              return (
                <tr key={e.tile} class={[e.rank === 1 ? 'quiz-rank-best' : '', mine ? 'quiz-rank-answer' : ''].join(' ').trim() || undefined}>
                  <td>{e.rank}位</td>
                  <th scope="row" aria-label={`打 ${tileName(e.tile)}${mine ? '（あなたの答え）' : ''}`}>
                    <span class="quiz-rank-tile">
                      <Tile tile={e.tile} size="xs" />
                      {mine && <span class="quiz-you">あなた</span>}
                    </span>
                  </th>
                  <td>{shantenLabel(e.shanten)}</td>
                  <td>{e.ukeire}枚</td>
                  {showWait && <td>{e.wait === null ? '−' : `平均${e.wait.toFixed(1)}枚`}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div class="quiz-actions">
        <button type="button" class="dojo-start" ref={nextRef} disabled={busy} onClick={onNext}>
          次の問題
        </button>
      </div>
    </section>
  );
}

/** A machi grading's waits: each with its copies outside the hand, and whether the answer held it or left it out (見逃し). */
function MachiTable({ result, answer }: { result: ProblemResult; answer: TileT[] }) {
  return (
    <table class="quiz-ranking">
      <caption class="visually-hidden">待ちの牌</caption>
      <thead>
        <tr>
          <th scope="col">待ち</th>
          <th scope="col" title="手牌の外に残っている枚数">
            残り
          </th>
          <th scope="col">あなたの答え</th>
        </tr>
      </thead>
      <tbody>
        {result.ranking.map((e) => {
          const mine = answer.includes(e.tile);
          return (
            <tr key={e.tile} class={mine ? 'quiz-rank-best quiz-rank-answer' : undefined}>
              <th scope="row" aria-label={tileName(e.tile)}>
                <span class="quiz-rank-tile">
                  <Tile tile={e.tile} size="xs" />
                </span>
              </th>
              <td>{e.ukeire}枚</td>
              <td>{mine ? '選んだ' : <span class="dojo-aid-warn">見逃し</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * An oshihiki problem's table: the other seats' rivers, 下家 to 上家, each
 * with its riichi (the declaration tile lies sideways) and its melds.
 */
export function QuizTable({ seats }: { seats: ProblemSeat[] }) {
  return (
    <div class="quiz-table" role="group" aria-label="他家の河">
      {seats
        .filter((s) => s.seat !== 0)
        .map((s) => (
          <div key={s.seat} class="quiz-seat">
            <span class="quiz-seat-name">
              {seatName(s.seat)}
              {s.riichi && <span class="dojo-aid-warn">リーチ</span>}
            </span>
            <River seat={s} label={`${seatName(s.seat)}の捨て牌`} />
            <Melds melds={s.melds} owner={s.seat} size="xs" />
          </div>
        ))}
    </div>
  );
}

/** An oshihiki grading: every kind of the hand, safest first, with why and its danger (summed over the riichi). */
function DangerTable({ result, answer }: { result: ProblemResult; answer: TileT[] }) {
  return (
    <table class="quiz-ranking">
      <caption class="visually-hidden">切る牌ごとの危険度</caption>
      <thead>
        <tr>
          <th scope="col">順位</th>
          <th scope="col">打牌</th>
          <th scope="col">根拠</th>
          <th scope="col" title="リーチへの放銃の危険度（0 安全〜9、リーチが複数なら合計）">
            危険度
          </th>
        </tr>
      </thead>
      <tbody>
        {result.ranking.map((e) => {
          const mine = answer.some((a) => kindKey(a) === kindKey(e.tile));
          return (
            <tr key={e.tile} class={[e.rank === 1 ? 'quiz-rank-best' : '', mine ? 'quiz-rank-answer' : ''].join(' ').trim() || undefined}>
              <td>{e.rank}位</td>
              <th scope="row" aria-label={`打 ${tileName(e.tile)}${mine ? '（あなたの答え）' : ''}`}>
                <span class="quiz-rank-tile">
                  <Tile tile={e.tile} size="xs" />
                  {mine && <span class="quiz-you">あなた</span>}
                </span>
              </th>
              <td class="quiz-reason">{e.reason}</td>
              <td>{e.danger}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
