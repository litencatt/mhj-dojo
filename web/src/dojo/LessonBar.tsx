import { useState } from 'preact/hooks';
import { GuideDialog } from './GuideDialog';
import type { Lesson, LessonStage } from './lessons';
import type { LessonNote } from './useLesson';
import { guideFor } from './yakuGuide';
import './dojo.css';

// Failures in a row before the hint asks to be opened.
export const HINT_AFTER = 3;

const STAGE_NAMES: Record<LessonStage, string> = {
  locked: 'まだ挑戦できません',
  assisted: '補助あり',
  unassisted: '補助なし',
  done: '合格済み',
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
  if (note.kind === 'counted') return '達成！';
  if (note.kind === 'passed') return '達成！ 次は補助なし';
  if (note.item) return `合格！ ${note.item}を授かりました`;
  return note.coins > 0 ? `合格！ ${note.coins}銭を受け取りました` : '合格！';
}

/**
 * A lesson's lines over the hand (a dojo game's or practice mode's), as tall
 * whatever happens: the lesson's title, its stage and count and what the
 * last success did, on one line; then its hint, folded, the lesson's text and
 * its yaku's guide, which asks to be opened after failures in a row.
 */
export function LessonBar({ lesson, stage, count, note, failures, saveFailed }: LessonBarProps) {
  const [guideOpen, setGuideOpen] = useState(false);
  const times = lesson.times ?? 1;
  const active = stage === 'assisted' || stage === 'unassisted';
  const guide = lesson.guide !== undefined && guideFor(lesson.guide) ? lesson.guide : null;
  return (
    <div class="dojo-notice lesson-status" data-testid="lesson-status">
      <p class="lesson-status-line" role="status" aria-live="polite">
        <span class="dojo-aid-label">課題</span>
        <b class="lesson-title">{lesson.title}</b>
        <span class="lesson-stage" data-stage={stage}>
          {STAGE_NAMES[stage]}
          {active && times > 1 && ` ${count}/${times}`}
        </span>
        {note && <span class="dojo-aid-ok lesson-note">{noteText(note)}</span>}
        {saveFailed && <span class="dojo-aid-warn lesson-note">保存できませんでした</span>}
      </p>
      <details class="lesson-hint">
        <summary>
          ヒント
          {active && failures >= HINT_AFTER && <span class="lesson-hint-nudge">うまくいかないときは開いてみよう</span>}
        </summary>
        <p>
          {lesson.text}
          {guide && (
            <button type="button" aria-haspopup="dialog" onClick={() => setGuideOpen(true)}>
              役の解説
            </button>
          )}
        </p>
      </details>
      <GuideDialog yakuKey={guideOpen ? guide : null} inLesson learned={false} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
