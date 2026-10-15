import { Tile } from '../components/Tile';
import { LESSONS, findLesson, lessonActive, lessonDealSeed, lessonHref, lessonStage, singleStage, type Lesson, type LessonStage } from './lessons';
import { curriculumDone, masterMatchOpen } from './masterMatch';
import { progressSaved, saveProgress, type DojoProgress } from './progress';
import { Furigana } from './Furigana';
import { expandTiles, guideFor } from './yakuGuide';

// The curriculum's tiers (#316): 初伝 (stages 0-1), 中伝 (2-4) and 奥伝 (5), then, after the 師範戦
// (皆伝), 秘伝 (6). The panel counts the lessons learned in each; the word 段 is the 級位's (初段,
// 二段…), so a stage is never shown as 段N.
const TIERS: readonly { name: string; stages: readonly number[] }[] = [
  { name: '初伝', stages: [0, 1] },
  { name: '中伝', stages: [2, 3, 4] },
  { name: '奥伝', stages: [5] },
  { name: '秘伝', stages: [6] },
];

const FORM_NAMES: Record<Lesson['form'], string> = { practice: '練習モード', game: '対局', quiz: '問題' };

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
 * The hub's 鍛錬 panel (#374), short so that 出稽古 shows under it: the count
 * learned; what to do now alone (the next lesson, or the 師範戦 while it is
 * open and not won, before 秘伝), with its goal, a way to start it and,
 * folded, its text and example hand; the other lessons that can be tried,
 * folded; the lessons learned, folded, each to play again (for no reward);
 * then a line of the tiers' counts and how many lessons are locked. A locked
 * lesson is not listed. The score lessons are announced at the end.
 */
export function Curriculum({ progress, seed, onGuide }: CurriculumProps) {
  const next = nextLesson(progress);
  const masterOpen = masterMatchOpen(progress);
  const won = progress.masterMatch.uraOpen;
  // The 師範戦 comes before 秘伝 while it is open and not won: it is the curriculum's goal.
  const masterNow = masterOpen && !won && (!next || next.stage === 6);
  const now = masterNow ? undefined : next;
  const stageOf = (l: Lesson) => lessonStage(progress, l.id);
  const passed = LESSONS.filter((l) => stageOf(l) === 'done').length;
  const others = LESSONS.filter((l) => lessonActive(progress, l.id) && l.id !== now?.id);
  const learned = LESSONS.filter((l) => stageOf(l) === 'done');
  const locked = LESSONS.filter((l) => stageOf(l) === 'locked').length;
  const counts = TIERS.map((t) => {
    const ls = LESSONS.filter((l) => t.stages.includes(l.stage));
    return `${t.name} ${ls.filter((l) => stageOf(l) === 'done').length}/${ls.length}`;
  }).join('・');
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
      {(masterNow || now) && (
        <ul class="shop-list dojo-lesson-now">
          {masterNow ? (
            <MasterMatchRow progress={progress} />
          ) : (
            <LessonRow lesson={now!} progress={progress} next seed={seed} onGuide={onGuide} />
          )}
        </ul>
      )}
      {others.length > 0 && (
        <details class="dojo-lessons-group" data-group="open">
          <summary>
            ほかに挑める課題<span class="dojo-muted"> {others.length}</span>
          </summary>
          <ul class="shop-list">
            {others.map((l) => (
              <LessonRow key={l.id} lesson={l} progress={progress} next={false} seed={seed} onGuide={onGuide} />
            ))}
          </ul>
        </details>
      )}
      {learned.length > 0 && (
        <details class="dojo-lessons-group" data-group="done">
          <summary>
            習得済み<span class="dojo-muted"> {learned.length + (won ? 1 : 0)}</span>
          </summary>
          <ul class="shop-list">
            {learned.map((l) => (
              <LessonRow key={l.id} lesson={l} progress={progress} next={false} seed={seed} onGuide={onGuide} />
            ))}
            {won && <MasterMatchRow progress={progress} />}
          </ul>
        </details>
      )}
      <p class="dojo-lessons-rest dojo-muted" data-testid="dojo-lessons-rest">
        {counts}
        {locked > 0 && <span>。ロック中の課題 {locked}（前の課題を習得すると開きます）</span>}
        {!masterOpen && <span>。奥伝までの課題をすべて習得すると師範戦に挑めます</span>}
      </p>
      <ul class="dojo-lesson-later">
        <li>
          秘伝の点数計算<span class="dojo-muted">準備中</span>
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
  const action = active ? (progress.lessons[lesson.id] ? '続ける' : '始める') : state === 'done' ? 'もう一度' : null;
  const times = lesson.times ?? 1;
  const count = progress.lessons[lesson.id]?.count ?? 0;
  const guide = lesson.guide !== undefined && guideFor(lesson.guide) ? lesson.guide : null;
  const requires = lesson.requires.filter((r) => lessonStage(progress, r) !== 'done').map((r) => findLesson(r)?.title ?? r);
  // Practice mode offers a lesson only to a dojo with a stored progress: a new dojo's is stored on the way.
  const keep = () => {
    if (!progressSaved()) saveProgress(progress);
  };
  // The goal and the text read a term once between them (Furigana).
  const seen = new Set<string>();
  return (
    <li class={`shop-item dojo-lesson${next ? ' dojo-lesson-next' : ''}`} data-lesson={lesson.id} data-state={state} aria-current={next ? 'step' : undefined}>
      <span class="shop-name">
        {lesson.title}
        <span class="dojo-lesson-form">{FORM_NAMES[lesson.form]}</span>
      </span>
      <span class={state === 'done' ? 'shop-owned' : state === 'locked' ? 'shop-locked' : 'shop-price'}>
        {stateName(lesson, state)}
        {active && times > 1 && ` ${count}/${times}`}
      </span>
      <p class="dojo-lesson-goal">
        <span class="dojo-aid-label">目標</span>
        <Furigana text={lesson.goal} seen={seen} />
      </p>
      {guide && (
        <button type="button" aria-haspopup="dialog" aria-label={`${lesson.title}：役の解説`} onClick={() => onGuide(guide)}>
          役の解説
        </button>
      )}
      {/* A lesson learned is played again for no reward (its judgment only). */}
      {action && (
        <a class={next ? 'dojo-start' : 'dojo-restart'} href={lessonHref(lesson, lessonDealSeed(progress, lesson, seed))}
          onClick={keep}
          onAuxClick={keep}
          aria-label={`${lesson.title}を${action}`}
        >
          {action}
        </a>
      )}
      {/* Open for a dojo that has not begun the curriculum: its first lesson's rules are new. */}
      <details class="dojo-lesson-more" open={next && Object.keys(progress.lessons).length === 0}>
        <summary>{state === 'locked' && requires.length > 0 ? `解説（先に: ${requires.join('、')}）` : '解説'}</summary>
        <p>
          <Furigana text={lesson.text} seen={seen} />
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
          師範は普通より強い CPU です。何度でも挑戦できます。順位の報酬は6倍（勝ったあとは4倍）。
          {/* What it opens is told once it is open. */}
          {uraOpen ? '勝って裏道場が開きました。裏師範との対局とイカサマ（よろず屋）が使えます（師範戦ではイカサマは使えません）。' : '勝つと、道場の先が開けます。'}
        </p>
      </details>
    </li>
  );
}
