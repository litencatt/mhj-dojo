import { Fragment } from 'preact';
import { Tile } from '../components/Tile';
import { LESSONS, findLesson, lessonActive, lessonDealSeed, lessonHref, lessonStage, singleStage, type Lesson, type LessonStage } from './lessons';
import { curriculumDone, masterMatchOpen } from './masterMatch';
import { progressSaved, saveProgress, type DojoProgress } from './progress';
import { expandTiles, guideFor } from './yakuGuide';

// The curriculum's stages (#316), 0 to 5, shown under three tiers: 初伝, 中伝 and 奥伝. The word 段
// is the 級位's (初段, 二段…), so a stage is shown by its name only, never as 段N.
const STAGE_NAMES = ['和了の形', '聴牌・待ち・振聴', '役が要る', '鳴き', '守り', '手役'] as const;
const TIERS: readonly { name: string; stages: readonly number[] }[] = [
  { name: '初伝', stages: [0, 1] },
  { name: '中伝', stages: [2, 3, 4] },
  { name: '奥伝', stages: [5] },
];

const STATE_NAMES: Record<LessonStage, string> = {
  locked: 'ロック',
  assisted: '手ほどき中',
  unassisted: '見極め中',
  done: '習得',
};

function stateName(lesson: Lesson, state: LessonStage): string {
  return state === 'unassisted' && singleStage(lesson) ? '未習得' : STATE_NAMES[state];
}

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
 * The hub's 鍛錬 panel: the lessons stage by stage (the stage of the next
 * lesson open, the others folded), each with its form, its state, its goal,
 * a way to start it and, folded, its text and example hand; the next lesson
 * marked. Then the
 * 師範戦 (MasterMatchRow), and 秘伝 (the position problems) announced at the end.
 */
export function Curriculum({ progress, seed, onGuide }: CurriculumProps) {
  const next = nextLesson(progress);
  const passed = LESSONS.filter((l) => lessonStage(progress, l.id) === 'done').length;
  return (
    <section class="dojo-panel" aria-labelledby="dojo-lessons-heading" data-testid="dojo-lessons">
      <div class="dojo-lessons-heading">
        <h2 id="dojo-lessons-heading">鍛錬</h2>
        <div
          class="dojo-xpbar"
          role="progressbar"
          aria-label="習得した課題"
          aria-valuemin={0}
          aria-valuemax={LESSONS.length}
          aria-valuenow={passed}
          aria-valuetext={`${passed} / ${LESSONS.length}`}
        >
          <div style={{ width: `${Math.round((passed / LESSONS.length) * 100)}%` }} />
        </div>
        <small class="dojo-muted" data-testid="dojo-lessons-count">
          {passed} / {LESSONS.length}
        </small>
      </div>
      {TIERS.map((tier) => {
        const tierLessons = LESSONS.filter((l) => tier.stages.includes(l.stage));
        const tierDone = tierLessons.filter((l) => lessonStage(progress, l.id) === 'done').length;
        return (
          <Fragment key={tier.name}>
            <h3 class="dojo-lesson-tier">
              {tier.name}
              <span class="dojo-muted">
                {' '}
                {tierDone} / {tierLessons.length}
              </span>
            </h3>
            {tier.stages.map((stage) => {
              const lessons = LESSONS.filter((l) => l.stage === stage);
              const done = lessons.filter((l) => lessonStage(progress, l.id) === 'done').length;
              const rows = (
                <ul class="shop-list">
                  {lessons.map((l) => (
                    <LessonRow key={l.id} lesson={l} progress={progress} next={l.id === next?.id} seed={seed} onGuide={onGuide} />
                  ))}
                </ul>
              );
              // A stage of one lesson needs no heading of its own: the lesson's title says it.
              if (lessons.length === 1) return <Fragment key={stage}>{rows}</Fragment>;
              return (
                <details key={stage} class="dojo-lesson-stage" open={next?.stage === stage}>
                  <summary>
                    {STAGE_NAMES[stage]}
                    <span class="dojo-muted">
                      {' '}
                      {done} / {lessons.length}
                    </span>
                  </summary>
                  {rows}
                </details>
              );
            })}
          </Fragment>
        );
      })}
      <h3 class="dojo-lesson-tier">皆伝</h3>
      <details class="dojo-lesson-stage" open={masterMatchOpen(progress)}>
        <summary>
          師範戦
          <span class="dojo-muted"> {progress.masterMatch.uraOpen ? '勝利' : masterMatchOpen(progress) ? '挑戦できます' : '奥伝の後'}</span>
        </summary>
        <ul class="shop-list">
          <MasterMatchRow progress={progress} />
        </ul>
      </details>
      <ul class="dojo-lesson-later">
        <li>
          秘伝（何切る・押し引き・待ち当て・点数）<span class="dojo-muted">準備中</span>
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
        <span class="dojo-lesson-form">{lesson.form === 'practice' ? '練習モード' : '対局'}</span>
      </span>
      <span class={state === 'done' ? 'shop-owned' : state === 'locked' ? 'shop-locked' : 'shop-price'}>
        {stateName(lesson, state)}
        {active && times > 1 && ` ${count}/${times}`}
      </span>
      <p class="dojo-lesson-goal">
        <span class="dojo-aid-label">目標</span>
        {lesson.goal}
      </p>
      {guide && (
        <button type="button" aria-haspopup="dialog" aria-label={`${lesson.title}：役の解説`} onClick={() => onGuide(guide)}>
          役の解説
        </button>
      )}
      {active && (
        <a class={next ? 'dojo-start' : 'dojo-restart'} href={lessonHref(lesson, lessonDealSeed(progress, lesson, seed))}
          onClick={keep}
          onAuxClick={keep}
          aria-label={`${lesson.title}を${progress.lessons[lesson.id] ? '続ける' : '始める'}`}
        >
          {progress.lessons[lesson.id] ? '続ける' : '始める'}
        </a>
      )}
      {/* Open for a dojo that has not begun the curriculum: its first lesson's rules are new. */}
      <details class="dojo-lesson-more" open={next && Object.keys(progress.lessons).length === 0}>
        <summary>{state === 'locked' && requires.length > 0 ? `解説（先に: ${requires.join('、')}）` : '解説'}</summary>
        <p>
          {lesson.text}
          {lesson.form === 'game' && <span class="dojo-muted"> 課題の対局は東風戦・CPU 弱い（順位の報酬は等倍）。</span>}
        </p>
        {lesson.example && (
          <div class="dojo-lesson-example" role="group" aria-label="例の手">
            <span class="dojo-muted">例</span>
            {lesson.example.split(' ').map((block, i) => (
              <span key={i} class="dojo-lesson-block">
                {expandTiles(block).map((t, j) => (
                  <Tile key={j} tile={t} size="xs" />
                ))}
              </span>
            ))}
          </div>
        )}
      </details>
    </li>
  );
}

/** The 師範戦's URL: a dojo game dealt as the 師範戦 (GameApp's ?match=master, on a random seed). */
export const MASTER_MATCH_HREF = '?mode=dojo&play=1&match=master';

/**
 * The 師範戦's row: its state (locked until masterMatchOpen, then the tries and wins), 挑戦する
 * (the primary button until it is won: the curriculum is passed by then, so no lesson is next)
 * and, folded, its rules and what is still missing.
 */
function MasterMatchRow({ progress }: { progress: DojoProgress }) {
  const open = masterMatchOpen(progress);
  const { tries, wins, uraOpen } = progress.masterMatch;
  const left = LESSONS.filter((l) => lessonStage(progress, l.id) !== 'done').length;
  const missing = [!curriculumDone(progress) && `初伝〜奥伝の課題を習得する（あと${left}）`].filter((m): m is string => !!m);
  const keep = () => {
    if (!progressSaved()) saveProgress(progress);
  };
  return (
    <li class="shop-item dojo-lesson" data-state={!open ? 'locked' : uraOpen ? 'done' : 'open'} data-testid="dojo-master-match">
      <span class="shop-name">師範戦（半荘・師範×3）</span>
      <span class={uraOpen ? 'shop-owned' : open ? 'shop-price' : 'shop-locked'}>
        {!open ? 'ロック' : `挑戦 ${tries}回・勝利 ${wins}回`}
      </span>
      <p class="dojo-lesson-goal">
        <span class="dojo-aid-label">目標</span>
        半荘戦で師範3人を相手に1位になる
      </p>
      {open && (
        <a class={uraOpen ? 'dojo-restart' : 'dojo-start'} href={MASTER_MATCH_HREF} onClick={keep} onAuxClick={keep}
          aria-label={uraOpen ? '師範戦にもう一度挑戦する' : '師範戦に挑戦する'}
        >
          {uraOpen ? 'もう一度挑戦する' : '挑戦する'}
        </a>
      )}
      <details class="dojo-lesson-more" open={open && !uraOpen}>
        <summary>{missing.length > 0 ? `解説（先に: ${missing.join('、')}）` : '解説'}</summary>
        <p>
          師範は普通より強い CPU です。何度でも挑戦できます。師範戦ではイカサマは使えません。順位の報酬は6倍（勝ったあとは4倍）。勝つと裏道場が開き、裏師範との対局とイカサマ（よろず屋）が解禁されます。
        </p>
      </details>
    </li>
  );
}
