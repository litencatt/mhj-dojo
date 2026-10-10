import { Tile } from '../components/Tile';
import { LESSONS, findLesson, lessonActive, lessonHref, lessonStage, type Lesson, type LessonStage } from './lessons';
import { MASTER_MATCH_LEVEL, curriculumDone, masterMatchOpen } from './masterMatch';
import { level, progressSaved, saveProgress, type DojoProgress } from './progress';
import { rankName } from './rules';
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
 * and, folded, its text and example hand; the next lesson marked. Then the
 * 師範戦 (MasterMatchRow), and 段6 announced at the end.
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
      <details class="dojo-lesson-stage" open={masterMatchOpen(progress)}>
        <summary>
          師範戦
          <span class="dojo-muted"> {progress.masterMatch.uraOpen ? '勝利' : masterMatchOpen(progress) ? '挑戦できます' : '段0〜5の後'}</span>
        </summary>
        <ul class="shop-list">
          <MasterMatchRow progress={progress} />
        </ul>
      </details>
      <ul class="dojo-lesson-later">
        <li>
          段6 中級（何切る・押し引き・待ち当て・点数）<span class="dojo-muted">準備中</span>
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
  const lv = level(progress.xp);
  const missing = [
    !curriculumDone(progress) && `段0〜5の課題に合格する（あと${left}）`,
    lv < MASTER_MATCH_LEVEL && `${rankName(MASTER_MATCH_LEVEL)}になる（いま${rankName(lv)}）`,
  ].filter((m): m is string => !!m);
  const keep = () => {
    if (!progressSaved()) saveProgress(progress);
  };
  return (
    <li class="shop-item dojo-lesson" data-state={!open ? 'locked' : uraOpen ? 'done' : 'open'} data-testid="dojo-master-match">
      <span class="shop-name">師範戦（半荘・師範×3）</span>
      <span class={uraOpen ? 'shop-owned' : open ? 'shop-price' : 'shop-locked'}>
        {!open ? 'ロック' : `挑戦 ${tries}回・勝利 ${wins}回`}
      </span>
      {open && (
        <a class={uraOpen ? 'dojo-restart' : 'dojo-start'} href={MASTER_MATCH_HREF} onClick={keep} onAuxClick={keep}
          aria-label={uraOpen ? '師範戦にもう一度挑戦する' : '師範戦に挑戦する'}
        >
          {uraOpen ? 'もう一度挑戦する' : '挑戦する'}
        </a>
      )}
      <details class="dojo-lesson-more" open={open && !uraOpen}>
        <summary>{missing.length > 0 ? `説明（先に: ${missing.join('、')}）` : '説明'}</summary>
        <p>
          半荘戦で師範（普通より強い CPU）3人を相手に、1位になれば勝ちです。何度でも挑戦できます。師範戦ではイカサマは使えません。勝つとウラ面が開き、裏師範との対局とイカサマ（ショップ）が解禁されます。
        </p>
      </details>
    </li>
  );
}
