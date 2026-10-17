import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../api';
import type { Problem, ProblemResult, Tile as TileT } from '../api';
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
import { KINDS, KIND_NAMES, LEVEL_NAMES, answerMarks, doraOf, nextSeed, parseQuizParams, quizUrl, togglePick, type QuizParams } from './quiz';
import { QuizPicker, QuizResult, QuizTable } from './QuizParts';
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
  const marks = problem && result ? answerMarks(problem, result, shown!.answer) : {};

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
