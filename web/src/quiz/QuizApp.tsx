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
import { KINDS, LEVEL_NAMES, doraOf, nextSeed, parseQuizParams, quizUrl, shantenLabel, type QuizParams } from './quiz';
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

/**
 * The practice problems (?mode=quiz&kind=&level=&seed=, issue #239): a
 * position and its question, answered by tapping tiles in the hand (as
 * practice discards: the mouse and the keyboard at once, touch on a second
 * tap), then graded by the engine: 正解 or 不正解, the correct tiles marked in
 * the hand, every choice ranked and the explanation. 次の問題 is the next
 * seed. The count of correct answers lasts as long as the page.
 */
export function QuizApp() {
  const [asked, setAsked] = useState<QuizParams>(() => parseQuizParams(location.search));
  const [shown, setShown] = useState<Shown | null>(null);
  const [score, setScore] = useState({ correct: 0, answered: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const looks = useSharedLooks();
  const nextRef = useRef<HTMLButtonElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const { busy, error, retryable, request, retry } = useSerialRequest<Shown>((next) => {
    setShown(next);
    if (next.result) setScore((s) => ({ correct: s.correct + (next.result!.correct ? 1 : 0), answered: s.answered + 1 }));
  });

  // Asks for a problem; the URL then names it, the seed the engine picked
  // included, so a reload shows the same problem.
  function load(p: QuizParams) {
    setAsked(p);
    return request(() =>
      api.createProblem(p).then((problem) => {
        history.replaceState(null, '', quizUrl(location.href, problem));
        return { problem, result: null, answer: [] };
      }),
    );
  }

  // Every kind so far answers one tile (choose 'one'): the hand's own tap
  // picks it. A kind that answers many (machi, #242) needs a picker that
  // collects them before sending.
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
  // the hand's first tile, if nothing else holds it (次の問題 went with the
  // result); a problem the page opened on leaves the focus alone.
  const result = shown?.result ?? null;
  const problem = shown?.problem ?? null;
  const fromNext = useRef(false);
  useEffect(() => {
    if (result) nextRef.current?.focus({ preventScroll: true });
    else if (problem && fromNext.current) {
      fromNext.current = false;
      if (!document.activeElement || document.activeElement === document.body) handRef.current?.querySelector<HTMLElement>('button.tile')?.focus();
    }
  }, [problem, result]);

  const kind = KINDS[asked.kind];
  const levels = LEVEL_NAMES[asked.kind];
  const pos = problem?.position;
  // After grading: the correct tiles raised and outlined in the hand, and a wrong answer outlined in red.
  const marks: Record<string, { className: string; text: string }> = {};
  if (result) {
    for (const t of shown!.answer) if (!result.best.includes(t)) marks[t] = { className: 'tile-quiz-wrong', text: 'あなたの答え' };
    for (const t of result.best) marks[t] = { className: 'tile-advice', text: shown!.answer.includes(t) ? '正解、あなたの答え' : '正解' };
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
                  <div>
                    <dt>成績</dt>
                    <dd data-testid="quiz-score" aria-label={`${score.answered}問中${score.correct}問正解`}>
                      {score.correct} / {score.answered}
                    </dd>
                  </div>
                </dl>
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
              </div>
            )}
          </SiteHeader>
          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
            <div class="new-game-form">
              {/* A level chosen starts its problem at once, on the same seed. */}
              <RadioGroup
                label="難易度"
                name="quiz-level"
                value={String(asked.level)}
                names={levels}
                onChange={(l) => {
                  if (busy) return;
                  setSettingsOpen(false);
                  void load({ ...asked, level: Number(l), seed: problem?.seed ?? asked.seed });
                }}
              />
            </div>
            {looks.progress && <LooksSettings progress={looks.progress} onChange={looks.change} open={settingsOpen} ownedOnly saveFailed={looks.saveFailed} />}
          </SettingsDialog>
          {/* 再試行 only for an engine failure: a refused request would fail again. */}
          {error && <ErrorBanner message={error} busy={busy} onRetry={retryable ? () => retry(() => void load(asked)) : undefined} />}
          {!problem && !error && <EngineLoading />}
        </div>

        {/* The hand's area (base.css): under the header in the one-column order of a narrow screen. */}
        {problem && pos && (
          <div class="area-hand" ref={handRef}>
            <section class="quiz-question" aria-labelledby="quiz-title">
              <h2 id="quiz-title">{kind.title}</h2>
              <p class="quiz-prompt">{kind.prompt}</p>
              <p class="quiz-hint muted">
                {result
                  ? '正解の牌を持ち上げて示しています。'
                  : '切る牌をクリックして答えます（タッチ操作では、選んだ牌をもう一度タップ）。'}
              </p>
            </section>
            <Hand
              hand={pos.hand}
              drawn={pos.drawn}
              discards={pos.discards}
              disabled={busy || !!result}
              marks={marks}
              onDiscard={(t) => submit([t])}
              onPreview={noop}
            />
            {/* Always mounted, so the verdict is announced as it comes. */}
            <p class="visually-hidden" role="status" aria-live="polite">
              {result ? (result.correct ? '正解' : '不正解') : ''}
            </p>
            {result && (
              <QuizResult
                result={result}
                answer={shown!.answer}
                busy={busy}
                nextRef={nextRef}
                onNext={() => {
                  fromNext.current = true;
                  void load({ kind: problem.kind, level: problem.level, seed: nextSeed(problem.seed) });
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface QuizResultProps {
  result: ProblemResult;
  answer: TileT[];
  busy: boolean;
  nextRef: { current: HTMLButtonElement | null };
  onNext: () => void;
}

/** The grading: 正解 or 不正解, the explanation, every choice ranked (the answer's row marked) and 次の問題. */
function QuizResult({ result, answer, busy, nextRef, onNext }: QuizResultProps) {
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
      <div class="quiz-actions">
        <button type="button" class="dojo-start" ref={nextRef} disabled={busy} onClick={onNext}>
          次の問題
        </button>
      </div>
    </section>
  );
}
