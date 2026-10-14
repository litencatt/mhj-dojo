import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../api';
import type { Problem, ProblemResult, ProblemSeat, Tile as TileT } from '../api';
import { River } from '../components/GameTable';
import { Melds } from '../components/Melds';
import { EngineLoading } from '../components/EngineLoading';
import { ErrorBanner } from '../components/ErrorBanner';
import { Hand } from '../components/Hand';
import { RadioGroup } from '../components/RadioGroup';
import { SettingsDialog } from '../components/SettingsDialog';
import { SiteHeader } from '../components/SiteHeader';
import { Tile } from '../components/Tile';
import { useSerialRequest } from '../hooks';
import { tileName } from '../tiles';
import { LooksSettings, useSharedLooks } from '../dojo/looks';
import { KINDS, KIND_NAMES, kindKey, seatName, LEVEL_NAMES, MAX_PICKS, PICKER_ROWS, doraOf, togglePick, nextSeed, parseQuizParams, quizUrl, shantenLabel, type QuizParams } from './quiz';
import { LessonBar } from '../dojo/LessonBar';
import { findLesson, quizKey } from '../dojo/lessons';
import { progressSaved } from '../dojo/progress';
import { useLesson } from '../dojo/useLesson';
import '../dojo/dojo.css';

// What the page shows: the problem and, once answered, its result and the
// tiles answered. Problems hold no state in the engine (docs/problems.md),
// so this is all there is: a reload asks for the URL's problem again.
interface Shown {
  problem: Problem;
  result: ProblemResult | null;
  answer: TileT[];
}

const noop = () => {};

/** The 秘伝 lesson the URL asks for (?lesson=), once the dojo has a progress to keep it in. */
function askedLesson(): string | null {
  const lesson = findLesson(new URLSearchParams(location.search).get('lesson') ?? '');
  return lesson?.form === 'quiz' && progressSaved() ? lesson.id : null;
}

/** The problems the page asks for: the URL's, or a 秘伝 lesson's kind and level (the URL's seed kept). */
function askedParams(lessonId: string | null): QuizParams {
  const p = parseQuizParams(location.search);
  const lesson = lessonId === null ? undefined : findLesson(lessonId);
  return lesson?.form === 'quiz' ? { ...p, kind: lesson.quiz.kind, level: lesson.quiz.level } : p;
}

/**
 * The practice problems (?mode=quiz&kind=&level=&seed=, issue #239): a
 * position and its question, answered by tapping tiles in the hand (as
 * practice discards: the mouse and the keyboard at once, touch on a second
 * tap), then graded by the engine: 正解 or 不正解, the correct tiles marked in
 * the hand, every choice ranked and the explanation. 次の問題 is the next
 * seed. The count of correct answers lasts as long as the page.
 */
export function QuizApp() {
  // A 秘伝 lesson (dojo/lessons.ts): each problem answered right counts once (quizKey). Its kind and level are fixed.
  const [lessonId] = useState(askedLesson);
  const lesson = useLesson(lessonId);
  const [asked, setAsked] = useState<QuizParams>(() => askedParams(lessonId));
  const [shown, setShown] = useState<Shown | null>(null);
  const [score, setScore] = useState({ correct: 0, answered: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A many-tile answer's tiles, picked before it is sent.
  const [picked, setPicked] = useState<TileT[]>([]);
  const looks = useSharedLooks();
  const nextRef = useRef<HTMLButtonElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const { busy, error, retryable, request, retry } = useSerialRequest<Shown>((next) => {
    setShown(next);
    if (next.result) {
      setScore((s) => ({ correct: s.correct + (next.result!.correct ? 1 : 0), answered: s.answered + 1 }));
      lesson?.record(next.result.correct, quizKey(next.problem.id));
    }
  });

  // Asks for a problem; the URL then names it, the seed the engine picked
  // included, so a reload shows the same problem.
  // asked follows only once the problem has come: a failed or refused request leaves the one shown.
  function load(p: QuizParams) {
    return request(() =>
      api.createProblem(p).then((problem) => {
        setAsked(p);
        setPicked([]);
        history.replaceState(null, '', quizUrl(location.href, problem));
        return { problem, result: null, answer: [] };
      }),
    );
  }

  // A one-tile answer (choose 'one') is the hand's own tap; a many-tile one
  // (machi) is the tiles picked under the hand (QuizPicker), sent by 答える.
  function submit(tiles: TileT[]) {
    if (!shown || shown.result) return;
    const { problem } = shown;
    void request(() => api.answerProblem(problem.id, tiles).then((result) => ({ problem, result, answer: tiles })));
  }

  useEffect(() => {
    document.title = `mhj-dojo - ${KINDS[asked.kind].title}`;
    void load(asked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Answered: 次の問題 takes the focus (without scrolling the hand away), so
  // the keyboard goes on with Enter. The problem it brings gives the focus to
  // the first tile it answers with (the hand's, or the picker's for machi),
  // if nothing else holds it (次の問題 went with the result); a problem the
  // page opened on leaves the focus alone.
  const result = shown?.result ?? null;
  const problem = shown?.problem ?? null;
  const fromNext = useRef(false);
  useEffect(() => {
    if (result) nextRef.current?.focus({ preventScroll: true });
    else if (problem && fromNext.current) {
      fromNext.current = false;
      if (!document.activeElement || document.activeElement === document.body) handRef.current?.querySelector<HTMLElement>(problem.choose === 'many' ? '.quiz-picker button.tile' : 'button.tile')?.focus();
    }
  }, [problem, result]);

  const kind = KINDS[asked.kind];
  const many = problem?.choose === 'many';
  const levels = LEVEL_NAMES[asked.kind];
  const pos = problem?.position;
  // After grading: the correct tiles raised and outlined in the hand (in the
  // picker for a many-tile answer, a wait left out said so), and a wrong
  // answer outlined in red.
  const marks: Record<string, { className: string; text: string }> = {};
  if (result && problem?.kind === 'oshihiki' && pos) {
    // Graded by kind: every tile of a safest kind is correct, a red five as its plain copy.
    const bestKinds = result.best.map(kindKey);
    for (const t of [...pos.hand, ...(pos.drawn ? [pos.drawn] : [])]) {
      const mine = shown!.answer.includes(t);
      if (bestKinds.includes(kindKey(t))) marks[t] = { className: 'tile-advice', text: mine ? '正解、あなたの答え' : '正解' };
      else if (mine) marks[t] = { className: 'tile-quiz-wrong', text: 'あなたの答え' };
    }
  } else if (result) {
    for (const t of shown!.answer) if (!result.best.includes(t)) marks[t] = { className: 'tile-quiz-wrong', text: 'あなたの答え' };
    for (const t of result.best) marks[t] = { className: 'tile-advice', text: shown!.answer.includes(t) ? '正解、あなたの答え' : many ? '正解、見逃し' : '正解' };
  }

  return (
    <div class="app app-quiz">
      <div class="area-main">
        <div class="area-header">
          <SiteHeader mode="quiz" onSettings={() => setSettingsOpen(true)}>
            {problem && pos && (
              <div class="header-status">
                <dl class="game-status">
                  <div>
                    <dt>難易度</dt>
                    <dd>{levels[String(problem.level)] ?? problem.level}</dd>
                  </div>
                  {/* A position off the table (machi: junme 0, the hand's shape only) has no turn, winds or dora. */}
                  {pos.junme > 0 && (
                    <>
                      <div>
                        <dt>巡目</dt>
                        <dd>{pos.junme}巡目</dd>
                      </div>
                      <div>
                        <dt>場風</dt>
                        <dd>{tileName(pos.round_wind)}</dd>
                      </div>
                      <div>
                        <dt>自風</dt>
                        <dd>{tileName(pos.seat_wind)}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>成績</dt>
                    <dd>
                      <span aria-hidden="true" data-testid="quiz-score">
                        {score.correct} / {score.answered}
                      </span>
                      <span class="visually-hidden">{`${score.answered}問中${score.correct}問正解`}</span>
                    </dd>
                  </div>
                </dl>
                {pos.dora_indicators.length > 0 && (
                  <dl class="dora-box">
                    <div>
                      <dt>
                        ドラ<span class="dora-dt-rest">表示牌</span>
                      </dt>
                      <dd class="dora-indicators">
                        {pos.dora_indicators.map((t, i) => (
                          <Tile key={`${t}-${i}`} tile={t} size="sm" />
                        ))}
                        <span class="dora-arrow" aria-hidden="true">
                          →
                        </span>
                        <span class="dora-label">ドラ</span>
                        {pos.dora_indicators.map((t, i) => (
                          <Tile key={`d-${t}-${i}`} tile={doraOf(t)} size="sm" label={`ドラ ${tileName(doraOf(t))}`} />
                        ))}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            )}
          </SiteHeader>
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
            {/* A lesson's problems keep its kind and level. */}
            {!lesson && (
              <div class="new-game-form">
                {/* A kind or a level chosen starts its problem at once, on the same seed (a kind at its first level). */}
                <RadioGroup
                  label="種類"
                  name="quiz-kind"
                  value={asked.kind}
                  names={KIND_NAMES}
                  disabled={busy}
                  onChange={(k) => {
                    if (busy) return;
                    setSettingsOpen(false);
                    void load({ kind: k, level: 1, seed: problem?.seed ?? asked.seed });
                  }}
                />
                <RadioGroup
                  label="難易度"
                  name="quiz-level"
                  value={String(asked.level)}
                  names={levels}
                  disabled={busy}
                  onChange={(l) => {
                    if (busy) return;
                    setSettingsOpen(false);
                    void load({ ...asked, level: Number(l), seed: problem?.seed ?? asked.seed });
                  }}
                />
              </div>
            )}
            {looks.progress && <LooksSettings progress={looks.progress} onChange={looks.change} open={settingsOpen} ownedOnly saveFailed={looks.saveFailed} />}
          </SettingsDialog>
          {/* 再試行 only for an engine failure: a refused request would fail again. */}
          {error && <ErrorBanner message={error} busy={busy} onRetry={retryable ? () => retry(() => void load(asked)) : undefined} />}
          {!problem && !error && <EngineLoading />}
        </div>

        {/* The hand's area (base.css): under the header in the one-column order of a narrow screen. */}
        {problem && pos && (
          <div class="area-hand" ref={handRef}>
            {lesson && (
              <LessonBar
                lesson={lesson.lesson}
                stage={lesson.stage}
                count={lesson.count}
                note={lesson.note}
                failures={lesson.failures}
                saveFailed={lesson.saveFailed}
              />
            )}
            <section class="quiz-question" aria-labelledby="quiz-title">
              <h2 id="quiz-title">{kind.title}</h2>
              <p class="quiz-prompt">{kind.prompt}</p>
              {pos.seats && <QuizTable seats={pos.seats} />}
              <p class="quiz-hint muted">
                {many
                  ? result
                    ? '待ちの牌を持ち上げて示しています。'
                    : '手牌の下から待ちの牌をすべて選び、「答える」を押します。'
                  : result
                    ? '正解の牌を持ち上げて示しています。'
                    : '切る牌をクリックして答えます（タッチ操作では、選んだ牌をもう一度タップ）。'}
              </p>
            </section>
            <Hand
              hand={pos.hand}
              drawn={pos.drawn}
              discards={pos.discards}
              disabled={many || busy || !!result}
              marks={many ? {} : marks}
              onDiscard={(t) => submit([t])}
              onPreview={noop}
            />
            {many && (
              <QuizPicker
                picked={result ? shown!.answer : picked}
                marks={marks}
                disabled={busy || !!result}
                onPick={(t) => setPicked((p) => togglePick(p, t))}
                onSubmit={() => submit(picked)}
              />
            )}
            {/* Always mounted, so the verdict is announced as it comes. */}
            <p class="visually-hidden" role="status" aria-live="polite">
              {result ? (result.correct ? '正解' : '不正解') : ''}
            </p>
            {result && (
              <QuizResult
                many={many}
                result={result}
                answer={shown!.answer}
                busy={busy}
                nextRef={nextRef}
                onNext={() => {
                  fromNext.current = true;
                  void load({ kind: asked.kind, level: problem.level, seed: nextSeed(problem.seed) }).then((ok) => {
                    if (!ok) fromNext.current = false;
                  });
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface QuizPickerProps {
  picked: TileT[];
  marks: Record<string, { className: string; text: string }>;
  disabled: boolean;
  onPick: (t: TileT) => void;
  onSubmit: () => void;
}

/**
 * A many-tile answer (machi): every tile kind, a row per suit, each a toggle
 * (aria-pressed), then 答える with the count picked. Once graded, the waits
 * are raised and the tiles answered that are not waits outlined in red.
 */
function QuizPicker({ picked, marks, disabled, onPick, onSubmit }: QuizPickerProps) {
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
function QuizResult({ many, result, answer, busy, nextRef, onNext }: QuizResultProps) {
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
function QuizTable({ seats }: { seats: ProblemSeat[] }) {
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
