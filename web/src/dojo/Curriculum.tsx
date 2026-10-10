import { Tile } from '../components/Tile';
import { LESSONS, findLesson, lessonActive, lessonHref, lessonStage, type Lesson, type LessonStage } from './lessons';
import { progressSaved, saveProgress, type DojoProgress } from './progress';
import { expandTiles, guideFor } from './yakuGuide';

// The curriculum's stages (#316), 0 to 5.
const STAGE_NAMES = ['形', '聴牌・待ち・振聴', '役が要る', '鳴き', '守りの入門', '手役'] as const;

const STATE_NAMES: Record<LessonStage, string> = {
  locked: 'ロック',
  assisted: '補助あり',
  unassisted: '補助なし',
  done: '合格',
};

/** The lesson to do next: the first being learned, in the curriculum's order. */
export function nextLesson(p: DojoProgress): Lesson | undefined {
  return LESSONS.find((l) => lessonActive(p, l.id));
}

interface CurriculumProps {
  progress: DojoProgress;
  /** The seed a game lesson is dealt on, as 対局開始's (the hub URL's, unless settled); none: random. */
  seed?: number;
  onGuide: (yakuKey: string) => void;
}

/**
 * The hub's 課程 panel: the lessons stage by stage (the stage of the next
 * lesson open, the others folded), each with its state, a way to start it
 * and, folded, its text and example hand; the next lesson marked. What comes
 * after (段6 and the 師範戦) is announced at the end.
 */
export function Curriculum({ progress, seed, onGuide }: CurriculumProps) {
  const next = nextLesson(progress);
  const passed = LESSONS.filter((l) => lessonStage(progress, l.id) === 'done').length;
  return (
    <section class="dojo-panel" aria-labelledby="dojo-lessons-heading" data-testid="dojo-lessons">
      <h2 id="dojo-lessons-heading">
        課程（{passed} / {LESSONS.length}）
      </h2>
      {STAGE_NAMES.map((name, stage) => {
        const lessons = LESSONS.filter((l) => l.stage === stage);
        const done = lessons.filter((l) => lessonStage(progress, l.id) === 'done').length;
        return (
          <details key={stage} class="dojo-lesson-stage" open={next?.stage === stage}>
            <summary>
              段{stage} {name}
              <span class="dojo-muted">
                {' '}
                {done} / {lessons.length}
              </span>
            </summary>
            <ul class="shop-list">
              {lessons.map((l) => (
                <LessonRow key={l.id} lesson={l} progress={progress} next={l.id === next?.id} seed={seed} onGuide={onGuide} />
              ))}
            </ul>
          </details>
        );
      })}
      <ul class="dojo-lesson-later">
        <li>
          段6 中級（何切る・押し引き・待ち当て・点数）<span class="dojo-muted">準備中</span>
        </li>
        <li>
          師範戦（段0〜5に合格すると挑戦できます）<span class="dojo-muted">準備中</span>
        </li>
      </ul>
    </section>
  );
}

interface LessonRowProps {
  lesson: Lesson;
  progress: DojoProgress;
  next: boolean;
  seed?: number;
  onGuide: (key: string) => void;
}

function LessonRow({ lesson, progress, next, seed, onGuide }: LessonRowProps) {
  const state = lessonStage(progress, lesson.id);
  const active = lessonActive(progress, lesson.id);
  const times = lesson.times ?? 1;
  const count = progress.lessons[lesson.id]?.count ?? 0;
  const guide = lesson.guide !== undefined && guideFor(lesson.guide) ? lesson.guide : null;
  const requires = lesson.requires.filter((r) => lessonStage(progress, r) !== 'done').map((r) => findLesson(r)?.title ?? r);
  // Practice mode offers a lesson only to a dojo with a stored progress: a new dojo's is stored on the way.
  const keep = () => {
    if (!progressSaved()) saveProgress(progress);
  };
  return (
    <li class={`shop-item dojo-lesson${next ? ' dojo-lesson-next' : ''}`} data-lesson={lesson.id} data-state={state} aria-current={next ? 'step' : undefined}>
      <span class="shop-name">
        {lesson.title}
        {next && <span class="dojo-aid-ok dojo-lesson-badge">次はこれ</span>}
      </span>
      <span class={state === 'done' ? 'shop-owned' : state === 'locked' ? 'shop-locked' : 'shop-price'}>
        {STATE_NAMES[state]}
        {active && times > 1 && ` ${count}/${times}`}
        {lesson.form === 'practice' ? '・練習' : '・対局'}
      </span>
      {guide && (
        <button type="button" aria-haspopup="dialog" aria-label={`${lesson.title}：役の解説`} onClick={() => onGuide(guide)}>
          役の解説
        </button>
      )}
      {active && (
        <a class={next ? 'dojo-start' : 'dojo-restart'} href={lessonHref(lesson, lesson.form === 'game' ? seed : undefined)}
          onClick={keep}
          onAuxClick={keep}
          aria-label={`${lesson.title}を${progress.lessons[lesson.id] ? '続ける' : '始める'}`}
        >
          {progress.lessons[lesson.id] ? '続ける' : '始める'}
        </a>
      )}
      <details class="dojo-lesson-more" open={next}>
        <summary>{state === 'locked' && requires.length > 0 ? `説明（先に: ${requires.join('、')}）` : '説明'}</summary>
        <p>{lesson.text}</p>
        {lesson.example && (
          <div class="dojo-lesson-example" role="group" aria-label="例の手">
            {expandTiles(lesson.example).map((t, i) => (
              <Tile key={i} tile={t} size="xs" />
            ))}
          </div>
        )}
      </details>
    </li>
  );
}
