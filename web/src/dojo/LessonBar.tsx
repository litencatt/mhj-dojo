import { useState } from 'preact/hooks';
import { findItem } from './catalog';
import { GuideDialog } from './GuideDialog';
import type { Lesson, LessonStage } from './lessons';
import { guideFor } from './yakuGuide';
import './dojo.css';

/** What the last success did: counted one of several, passed the assisted stage, or passed the lesson. */
export type LessonNote = 'counted' | 'passed' | 'completed';

// Failures in a row before the hint (the lesson's text and its yaku's guide) shows.
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

function noteText(lesson: Lesson, note: LessonNote, stage: LessonStage): string {
  if (note === 'counted') return '達成！';
  if (note === 'passed' && stage === 'unassisted') return '補助ありで達成！ 次は補助なしで';
  const item = lesson.reward.item === undefined ? undefined : findItem(lesson.reward.item);
  const reward = [item?.name, lesson.reward.coins > 0 ? `${lesson.reward.coins}銭` : ''].filter(Boolean).join('・');
  return `合格！ ${reward ? `${reward}を授かりました` : ''}`.trim();
}

/**
 * A lesson's line over the hand (a dojo game's or practice mode's): its title,
 * its stage and count, what the last success did, and after failures in a
 * row a hint: the lesson's text and its yaku's guide.
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
        <b>{lesson.title}</b>
        <span class="lesson-stage" data-stage={stage}>
          {STAGE_NAMES[stage]}
          {active && times > 1 && ` ${count}/${times}`}
        </span>
        {note && <span class="dojo-aid-ok">{noteText(lesson, note, stage)}</span>}
        {saveFailed && <span class="dojo-aid-warn">保存できませんでした</span>}
      </p>
      {active && failures >= HINT_AFTER && (
        <p class="lesson-hint">
          <span class="dojo-aid-label">ヒント</span> {lesson.text}
          {guide && (
            <button type="button" aria-haspopup="dialog" onClick={() => setGuideOpen(true)}>
              役の解説
            </button>
          )}
        </p>
      )}
      <GuideDialog yakuKey={guideOpen ? guide : null} learned={false} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
