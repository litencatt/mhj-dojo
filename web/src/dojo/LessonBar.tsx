import { useState } from 'preact/hooks';
import { Furigana } from './Furigana';
import { GuideDialog } from './GuideDialog';
import { singleStage, type Lesson, type LessonStage } from './lessons';
import type { LessonNote } from './useLesson';
import { guideFor } from './yakuGuide';
import './dojo.css';

// Failures in a row before the hint asks to be opened.
export const HINT_AFTER = 3;

const STAGE_NAMES: Record<LessonStage, string> = {
  locked: 'まだ挑戦できません',
  assisted: '手ほどき中',
  unassisted: '見極め中',
  done: '習得済み',
};

interface LessonBarProps {
  lesson: Lesson;
  stage: LessonStage;
  count: number; // successes in the current stage
  note: LessonNote | null;
  failures: number; // in a row, since the last success
  saveFailed?: boolean;
}

/** The note's text, short enough for a phone's line. */
function noteText(note: LessonNote): string {
  if (note.kind === 'counted' || note.kind === 'replayed') return '達成！';
  if (note.kind === 'passed') return '達成！ 次は見極め';
  if (note.item) return `習得！ ${note.item}を授かりました`;
  return note.coins > 0 ? `習得！ ${note.coins}銭を受け取りました` : '習得！';
}

/**
 * A lesson's lines over the hand (a dojo game's or practice mode's), as tall
 * whatever happens: the lesson's title, its stage and count and what the
 * last success did, on one line; then its hint (once learned, the way back to the hub), folded, the lesson's goal and text and
 * its yaku's guide, which asks to be opened after failures in a row.
 */
export function LessonBar({ lesson, stage, count, note, failures, saveFailed }: LessonBarProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const times = lesson.times ?? 1;
  const active = stage === 'assisted' || stage === 'unassisted';
  const guide = lesson.guide !== undefined && guideFor(lesson.guide) ? lesson.guide : null;
  const seen = new Set<string>(); // the hint's goal and text read a term once between them
  return (
    <div class="dojo-notice lesson-status" data-testid="lesson-status">
      <p class="lesson-status-line" role="status" aria-live="polite">
        <span class="dojo-aid-label">課題</span>
        <b class="lesson-title">{lesson.title}</b>
        {/* Once learned the note says so: the stage gives the title the room. */}
        <span class="lesson-stage" data-stage={stage} hidden={stage === 'done' && note !== null}>
          {stage === 'unassisted' && singleStage(lesson) ? '未習得' : STAGE_NAMES[stage]}
          {active && times > 1 && ` ${count}/${times}`}
        </span>
        {note && <span class="dojo-aid-ok lesson-note">{noteText(note)}</span>}
        {saveFailed && <span class="dojo-aid-warn lesson-note">保存できませんでした</span>}
      </p>
      {stage === 'done' ? (
        // Learned: no hint is needed any more, and the way on is the hub's next lesson.
        <p class="lesson-next">
          <a href="?mode=dojo">道場に戻って次の課題へ</a>
        </p>
      ) : (
        <details class="lesson-hint">
          <summary>
            ヒント
            {active && failures >= HINT_AFTER && <span class="lesson-hint-nudge">うまくいかないときは開いてみよう</span>}
          </summary>
          <p>
            <b>
              <Furigana text={lesson.goal} seen={seen} />
            </b>
            <br />
            {/* In a span: the paragraph is a flex row, whose items each ruby would become. */}
            <span>
              <Furigana text={lesson.text} seen={seen} />
            </span>
            {guide && (
              <button type="button" aria-haspopup="dialog" onClick={() => setGuideOpen(true)}>
                役の解説
              </button>
            )}
          </p>
        </details>
      )}
      <GuideDialog yakuKey={guideOpen ? guide : null} inLesson learned={false} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
