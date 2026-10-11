// The dojo's curriculum (#316): lessons in stages 0 to 5, each teaching one
// thing, in the order of what they rest on. A lesson is played in practice
// mode or in a dojo game, judged by a pure function of what the engine
// returns, first with its assists and then without them; passing it without
// them pays its reward, once. A failure costs nothing. No page plays them yet
// (#318); plain Node runs the tests, so imports carry the .ts extension.
import type { GameEvent, GameResult, SessionState, Tile } from '../apiTypes.ts';
import { parseTile } from '../tiles.ts';
import { YAKUHAI_KEYS, findItem } from './catalog.ts';
import { dojoGame, type DojoProgress, type LessonProgress } from './progress.ts';
import seedData from './lessonSeeds.json' with { type: 'json' };

/**
 * A practice-mode step: the state reached, and the state and discard that led
 * to it (none at the start). A success is counted once for its position
 * (practiceKey of `after`), however often the tree is walked back to it.
 */
export interface PracticeStep {
  before: SessionState | null;
  discard: Tile | null;
  after: SessionState;
}

/**
 * A dojo game's round once it has ended: its result and every move of the
 * round from its first. A GameState carries only the moves since your
 * previous one (events, starting at events_from): the caller joins them by
 * events_from into the round's whole list, and passes the round's index with
 * the game's id as the success's key (gameRoundKey).
 */
export interface RoundRecord {
  you: number;
  result: GameResult;
  events: GameEvent[];
}

/** A judgment: passed, failed, or null when the round or the step had nothing the lesson asks about. */
export type Verdict = boolean | null;

interface LessonBase {
  id: string;
  stage: 0 | 1 | 2 | 3 | 4 | 5;
  title: string;
  /** What to do and why, for the lesson's page. */
  text: string;
  /** An example hand in compact notation ("123m55z"): the winning hand, or the tenpai the lesson asks for; none where a hand shows nothing. */
  example?: string;
  /** Successes a stage needs (1 if not given). */
  times?: number;
  /** The assists of the first stage, taken away in the second; none: one stage, without them. */
  assists: readonly string[];
  /** Yaku counted in the lesson's games even if not owned. */
  tempYaku: readonly string[];
  /** The reward: a shop item (a yaku or an assist) and coins. An item owned already pays its price instead. */
  reward: { item?: string; coins: number };
  /** Lessons that must be passed first, of any stage. */
  requires: readonly string[];
  /** The yaku (a key of the yaku guide, yakuGuide.ts) the lesson's hint links to; none for a lesson about no yaku. */
  guide?: string;
}

export type Lesson =
  | (LessonBase & { form: 'practice'; judge: (s: PracticeStep) => Verdict })
  | (LessonBase & { form: 'game'; judge: (r: RoundRecord) => Verdict });

// The coins of a lesson that grants no item (docs/dojo-economy.md): about half
// a 東風戦's coins, so that a lesson is worth doing between games; economy.test.ts
// plays the curriculum along.
export const LESSON_COINS = 30;

const NOYAKU = ['assist:noyaku'];
const UKEIRE = ['assist:ukeire'];
const DANGER = ['assist:danger'];

// ---- Judging helpers ----

/** The tile's kind: a red five as a five. */
function kind(t: Tile): Tile {
  return t[0] === '0' ? `5${t[1]}` : t;
}

/** The key a practice success is counted under: the seed and the discards that reach the position. */
export function practiceKey(s: SessionState): string {
  // A tsumo keeps the discards of the position it was made from: told apart by its status.
  return `practice:${s.seed}:${s.discards.map(kind).join('')}${s.status === 'tsumo' ? ':tsumo' : ''}`;
}

/** The key a game success is counted under: the game and the round's index in it. */
export function gameRoundKey(gameId: string, round: number): string {
  return `game:${gameId}:${round}`;
}

function won(r: RoundRecord): boolean {
  return r.result.kind !== 'draw' && r.result.kind !== 'abort' && r.result.winner === r.you;
}

function wonWith(r: RoundRecord, keys: readonly string[]): boolean {
  return won(r) && r.result.yaku.some((y) => keys.includes(y.key));
}

function dealtIn(r: RoundRecord): boolean {
  return r.result.kind === 'ron' && r.result.from === r.you;
}

function called(r: RoundRecord, type: 'pon' | 'chii' | 'kan'): boolean {
  return r.events.some((e) => e.seat === r.you && e.type === type);
}

function normalShanten(s: SessionState): number | null {
  return s.analysis.find((r) => r.key === 'normal')?.shanten ?? null;
}

// The 役牌 yaku key of an honor kind: the winds 1z-4z, the dragons 5z-7z.
const HONOR_YAKU: Record<Tile, string> = { '1z': 'ton', '2z': 'nan', '3z': 'shaa', '4z': 'pei', '5z': 'haku', '6z': 'hatsu', '7z': 'chun' };

/** Whether you called a pon (or a kan) of an honor and won with its 役牌. */
function wonWithCalledYakuhai(r: RoundRecord): boolean {
  if (!won(r)) return false;
  return r.events.some((e) => {
    if (e.seat !== r.you || (e.type !== 'pon' && e.type !== 'kan') || e.tile === undefined) return false;
    const key = HONOR_YAKU[kind(e.tile)];
    return key !== undefined && r.result.yaku.some((y) => y.key === key);
  });
}

/**
 * Whether the tile is suji against a seat's safe kinds: a 1-3 whose +3 is
 * safe, a 7-9 whose -3 is, a 4-6 whose both are (an honor never is).
 */
export function isSuji(tile: Tile, safe: readonly Tile[]): boolean {
  const { suit, rank } = parseTile(tile);
  if (suit === 'z') return false;
  const has = (n: number) => safe.includes(`${n}${suit}`);
  if (rank <= 3) return has(rank + 3);
  if (rank >= 7) return has(rank - 3);
  return has(rank - 3) && has(rank + 3);
}

/**
 * Your discards after another seat's riichi, each with the safe kinds of
 * every seat in riichi at that moment, as the 危険度 assist counts them
 * (docs/api.md "danger"): the kinds in that seat's own river, and those any
 * seat discarded after its riichi. Your discards after your own riichi are
 * left out (a hand in riichi has no choice); the riichi tile itself is in.
 * Empty when nobody else declared.
 */
export function discardsAgainstRiichi(r: RoundRecord): { tile: Tile; safe: Tile[][] }[] {
  const rivers = new Map<number, Set<Tile>>();
  const passed = new Map<number, Set<Tile>>(); // by seat in riichi: the kinds discarded since
  let youInRiichi = false;
  const out: { tile: Tile; safe: Tile[][] }[] = [];
  for (const e of r.events) {
    if ((e.type !== 'discard' && e.type !== 'riichi') || e.tile === undefined) continue;
    const k = kind(e.tile);
    if (e.seat === r.you && !youInRiichi && passed.size > 0) {
      out.push({ tile: k, safe: [...passed.keys()].map((s) => [...(rivers.get(s) ?? []), ...(passed.get(s) ?? [])]) });
    }
    for (const set of passed.values()) set.add(k);
    rivers.set(e.seat, (rivers.get(e.seat) ?? new Set()).add(k));
    if (e.type === 'riichi') {
      if (e.seat === r.you) youInRiichi = true;
      else passed.set(e.seat, new Set());
    }
  }
  return out;
}

type AgainstRiichi = { tile: Tile; safe: Tile[][] };
const genbutsu = (d: AgainstRiichi) => d.safe.every((safe) => safe.includes(d.tile));
const sujiOrGenbutsu = (d: AgainstRiichi) => d.safe.every((safe) => safe.includes(d.tile) || isSuji(d.tile, safe));

/**
 * The waits (kinds) of each discard of the step's `before` that leaves the
 * hand at tenpai, and whether they are furiten: one of them among your
 * discards, the one made included.
 */
export function tenpaiDiscards(before: SessionState): { tile: Tile; furiten: boolean }[] {
  const river = before.discards.map(kind);
  return Object.entries(before.by_discard).flatMap(([t, rs]) => {
    const n = rs.find((r) => r.key === 'normal');
    if (!n || n.shanten !== 0) return [];
    const discarded = [...river, kind(t)];
    return [{ tile: kind(t), furiten: n.ukeire.some((w) => discarded.includes(kind(w))) }];
  });
}

// ---- The lessons ----

/** A lesson of winning with a yaku (or a higher one of its kind: 二盃口 for 一盃口, say); the first key is the one taught. */
function handYaku(
  id: string,
  stage: 2 | 5,
  keys: string[],
  title: string,
  text: string,
  example: string,
  requires: string[],
  reward: Lesson['reward'],
): Lesson {
  return {
    id, stage, title, text, example, form: 'game', assists: stage === 2 ? NOYAKU : [],
    tempYaku: stage === 5 ? [keys[0]] : [], reward, requires, guide: keys[0],
    judge: (r) => wonWith(r, keys),
  };
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'shape-win', stage: 0, title: '和了形を作る', form: 'practice',
    text: '和了の形は4面子1雀頭（3+3+3+3+2）。面子は順子（123のような続き）か刻子（同じ牌3枚）、雀頭は同じ牌2枚。練習モードで、シャンテン数を見ながらツモ和了まで手を進めよう。',
    example: '123m456p789s111z55p',
    assists: [], tempYaku: [], reward: { coins: LESSON_COINS }, requires: [],
    // Judged when the practice ends: won by tsumo, or not (exhausted). A discard that goes on is not judged.
    judge: (s) => (s.after.status === 'playing' ? null : s.after.status === 'tsumo' && s.after.win !== null),
  },
  {
    id: 'ryanmen-tenpai', stage: 1, title: '両面で聴牌する', form: 'practice',
    text: '待ちの形には両面・嵌張・辺張・単騎・双碰がある。両面（34 で 2・5 を待つ）は待ちの牌が2種8枚と最も広い。両面の待ちで聴牌しよう。',
    example: '123m456p789s34m55z',
    assists: UKEIRE, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['shape-win'],
    // At the start (no step yet) a hand dealt at tenpai was not made by you.
    // Judged on a discard that leaves the hand at tenpai; others (and a hand dealt at tenpai) are not.
    judge: (s) =>
      s.before === null || s.discard === null || normalShanten(s.after) !== 0 ? null : s.after.hand_groups.some((g) => g.type === 'ryanmen'),
  },
  {
    id: 'max-ukeire', stage: 1, title: '受け入れの多い方を残す', form: 'practice', times: 5,
    text: '有効牌（引けばシャンテン数が進む牌）が多いほど、早く聴牌できる。シャンテン数を下げず、有効牌が最も多く残る牌を切ろう（5回）。',
    assists: UKEIRE, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['shape-win'],
    // Judged on each discard (a tsumo or the start is not one).
    judge: (s) => (s.before === null || s.discard === null ? null : bestDiscards(s.before).includes(kind(s.discard))),
  },
  {
    id: 'furiten', stage: 1, title: '振聴を避けて聴牌する', form: 'practice',
    text: '自分の捨て牌に待ちの牌が1枚でもあると振聴で、ロンできない（ツモなら和了れる）。聴牌を取る打牌が2つ以上あり、そのどれかが振聴の待ちになるとき、振聴にならない方を選ぼう。',
    assists: UKEIRE, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['ryanmen-tenpai'],
    // Counted only where both kinds of tenpai could be taken; elsewhere the step is not judged.
    judge: (s) => {
      if (s.before === null || s.discard === null) return null;
      const options = tenpaiDiscards(s.before);
      if (!options.some((o) => o.furiten) || !options.some((o) => !o.furiten)) return null;
      return options.some((o) => !o.furiten && o.tile === kind(s.discard!));
    },
  },
  handYaku('riichi-win', 2, ['riichi', 'double_riichi'], '立直して和了する',
    '和了には役が1つ以上要る（1翻縛り）。立直は、門前で聴牌して宣言すれば、手の形を問わず役になる。',
    '234m567m345p678s22s', ['shape-win'], { coins: LESSON_COINS }),
  handYaku('tsumo-win', 2, ['tsumo'], '門前でツモ和了する',
    '鳴かずに（門前で）自分で引いて和了すれば、門前清自摸和という役になる。ロンでは付かない。',
    '234m567m345p678s22s', ['shape-win'], { coins: LESSON_COINS }),
  handYaku('tanyao-win', 2, ['tanyao'], '断么九で和了する',
    '2〜8の数牌だけで作れば断么九。1・9と字牌を使わない、という決まりだけで、鳴いても付く。',
    '234m567m345p678s22s', ['shape-win'], { coins: LESSON_COINS }),
  {
    id: 'yakuhai-pon', stage: 3, title: '役牌をポンして和了する', form: 'game',
    text: '白・發・中と、場風・自風の刻子は1翻。ポンしても役が残るので、鳴くならまず役牌から。鳴くと立直はできなくなる。',
    example: '234m567p789s22p555z',
    assists: NOYAKU, tempYaku: YAKUHAI_KEYS, reward: { item: 'yakuhai', coins: 0 }, requires: ['riichi-win', 'tanyao-win'], guide: 'yakuhai',
    judge: (r) => wonWithCalledYakuhai(r),
  },
  {
    id: 'kuitan', stage: 3, title: 'チーして喰いタンで和了する', form: 'game',
    text: '断么九は鳴いても付く（喰いタン）。2〜8だけの手なら、チーして早く和了れる。',
    example: '234m567m345p678s22s',
    assists: NOYAKU, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['yakuhai-pon'],
    judge: (r) => called(r, 'chii') && wonWith(r, ['tanyao']),
  },
  {
    id: 'kan-win', stage: 3, title: 'カンして和了する', form: 'game',
    text: '同じ牌4枚でカンすると、嶺上牌を引き、ドラが1枚増える。カンした局で和了しよう。嶺上牌で和了すれば嶺上開花。',
    assists: NOYAKU, tempYaku: ['rinshan'], reward: { item: 'rinshan', coins: 0 }, requires: ['yakuhai-pon'], guide: 'rinshan',
    judge: (r) => called(r, 'kan') && won(r),
  },
  {
    id: 'genbutsu', stage: 4, title: '現物を切る', form: 'game',
    text: 'リーチした人の捨て牌と、リーチの後に誰かが捨てて通った牌（現物）では、その人にロンされない。他家のリーチの後は、現物だけを切って局を終えよう。字牌が4枚見えているなど、現物でなくても安全な牌はここでは数えない。',
    assists: DANGER, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['riichi-win'],
    judge: (r) => {
      const ds = discardsAgainstRiichi(r);
      return ds.length === 0 ? null : ds.every(genbutsu) && !dealtIn(r);
    },
  },
  {
    id: 'suji', stage: 4, title: 'スジを使う', form: 'game',
    text: '両面待ちは、現物に4があれば1・7では待てない（スジ）。現物がないときは、スジの牌が比較的安全。他家のリーチの後、現物かスジだけを切り、スジを1枚以上使って局を終えよう。壁（見えている4枚）や字牌の見え方はここでは数えない。',
    assists: DANGER, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['genbutsu', 'ryanmen-tenpai'],
    judge: (r) => {
      const ds = discardsAgainstRiichi(r);
      if (ds.length === 0) return null;
      return ds.some((d) => !genbutsu(d)) && ds.every(sujiOrGenbutsu) && !dealtIn(r);
    },
  },
  {
    id: 'fold', stage: 4, title: 'リーチを受けて降りきる', form: 'game', times: 3,
    text: '降りの目安: 2向聴以下なら降りる、1向聴ならスジまで、聴牌なら押す。他家のリーチの後、現物かスジだけを切って、和了も放銃もせずに局を終えよう（3回）。',
    assists: DANGER, tempYaku: [], reward: { item: 'assist:danger', coins: 0 }, requires: ['suji'],
    judge: (r) => {
      const ds = discardsAgainstRiichi(r);
      if (ds.length === 0) return null;
      return ds.every(sujiOrGenbutsu) && !dealtIn(r) && !won(r);
    },
  },
  handYaku('pinfu-win', 5, ['pinfu'], '平和で和了する',
    '門前で、面子がすべて順子、雀頭が役牌でなく、両面待ちで和了すると平和。段1の両面待ちが前提。',
    '123m678m345p789s55p', ['ryanmen-tenpai', 'riichi-win'], { item: 'pinfu', coins: 0 }),
  handYaku('honitsu-win', 5, ['honitsu', 'chinitsu'], '混一色で和了する',
    '1種類の数牌と字牌だけで作ると混一色。門前で3翻、鳴いても2翻。',
    '123m456m789m111z55z', ['pinfu-win', 'yakuhai-pon'], { item: 'honitsu', coins: 0 }),
  handYaku('iipeikou-win', 5, ['iipeikou', 'ryanpeikou'], '一盃口で和了する',
    '同じ順子を2つ（223344 のように）作ると一盃口。門前限定。',
    '223344m567p678s55s', ['honitsu-win'], { item: 'iipeikou', coins: 0 }),
  handYaku('sanshoku-win', 5, ['sanshoku'], '三色同順で和了する',
    '萬子・筒子・索子で同じ数の順子をそろえると三色同順。門前で2翻、鳴くと1翻。',
    '123m123p123s789m55z', ['iipeikou-win'], { item: 'sanshoku', coins: 0 }),
  handYaku('chiitoitsu-win', 5, ['chiitoitsu'], '七対子で和了する',
    '対子を7つ（すべて違う牌）そろえると七対子。4面子1雀頭ではない、例外の和了形。',
    '1133m5577p2299s11z', ['sanshoku-win'], { item: 'chiitoitsu', coins: 0 }),
  handYaku('toitoi-win', 5, ['toitoi'], '対々和で和了する',
    '面子をすべて刻子にすると対々和。ポンしても2翻のまま。',
    '111m555p999s222z33z', ['chiitoitsu-win'], { item: 'toitoi', coins: 0 }),
  handYaku('ittsu-win', 5, ['ittsu'], '一気通貫で和了する',
    '同じ色で123・456・789をそろえると一気通貫。門前で2翻、鳴くと1翻。',
    '123456789m234p55s', ['chiitoitsu-win'], { item: 'ittsu', coins: 0 }),
];

/** The discards (as kinds) with the lowest normal-form shanten and, among them, the most ukeire. */
export function bestDiscards(s: SessionState): Tile[] {
  const rows = Object.entries(s.by_discard).flatMap(([t, rs]) => {
    const n = rs.find((r) => r.key === 'normal');
    return n && n.shanten !== null ? [{ t: kind(t), shanten: n.shanten, count: n.ukeire_total }] : [];
  });
  if (rows.length === 0) return [];
  const low = Math.min(...rows.map((r) => r.shanten));
  const most = Math.max(...rows.filter((r) => r.shanten === low).map((r) => r.count));
  return rows.filter((r) => r.shanten === low && r.count === most).map((r) => r.t);
}

export function findLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

// ---- Progress ----

export type LessonStage = 'locked' | 'assisted' | 'unassisted' | 'done';

/** Where the lesson stands: locked until its prerequisites are passed, then with the assists, without, and done. */
export function lessonStage(p: DojoProgress, id: string): LessonStage {
  const lesson = findLesson(id);
  if (!lesson) return 'locked';
  const l = p.lessons[id];
  if (l?.done) return 'done';
  if (!lesson.requires.every((r) => p.lessons[r]?.done)) return 'locked';
  return l?.assisted || lesson.assists.length === 0 ? 'unassisted' : 'assisted';
}

/** Whether the lesson is being learned: unlocked and not done. Only then does its game or practice judge it and add its aids. */
export function lessonActive(p: DojoProgress, id: string): boolean {
  const stage = lessonStage(p, id);
  return stage === 'assisted' || stage === 'unassisted';
}

/**
 * The seed a lesson is dealt on by default (lessonSeeds.json, which internal/match's
 * TestLessonSeeds finds and checks): one where a simulated player passes it soon; none for a
 * lesson without one found (dealt at random).
 */
export function lessonSeed(id: string): number | undefined {
  return (seedData.seeds as Record<string, { seed: number } | undefined>)[id]?.seed;
}

/**
 * The seed the curriculum deals a lesson on: the hub URL's for a game lesson if it has one; else
 * the lesson's own (lessonSeed). A game lesson's own seed was found in a 東風戦 against weak CPUs,
 * so it is used only when the hub plays that game, and only once (a settled seed pays nothing).
 */
export function lessonDealSeed(p: DojoProgress, lesson: Lesson, hubSeed?: number): number | undefined {
  if (lesson.form === 'practice') return lessonSeed(lesson.id);
  if (hubSeed !== undefined) return hubSeed;
  const seed = lessonSeed(lesson.id);
  const g = dojoGame(p);
  return seed !== undefined && !p.settled.includes(String(seed)) && g.length === 'tonpuu' && g.cpu === 'weak' ? seed : undefined;
}

/**
 * Where a lesson is played: a dojo game (?mode=dojo&play=1&lesson=[&seed=]) or
 * practice mode (?seed=&turns=18&lesson=); a random seed if none is given.
 */
export function lessonHref(lesson: Lesson, seed?: number): string {
  const id = encodeURIComponent(lesson.id);
  if (lesson.form === 'game') return `?mode=dojo&play=1&lesson=${id}${seed === undefined ? '' : `&seed=${seed}`}`;
  return `?${seed === undefined ? '' : `seed=${seed}&`}turns=18&lesson=${id}`;
}

/**
 * The yaku and the assists a lesson's game or practice adds for now: none
 * unless the lesson is being learned, its assists at the assisted stage only.
 */
export function lessonAids(p: DojoProgress, id: string): { yaku: string[]; assists: string[] } {
  const lesson = findLesson(id);
  if (!lesson || !lessonActive(p, id)) return { yaku: [], assists: [] };
  return { yaku: [...lesson.tempYaku], assists: lessonStage(p, id) === 'assisted' ? [...lesson.assists] : [] };
}

/**
 * Counts one success of a lesson at its stage, under its key (practiceKey or
 * gameRoundKey): a key counted before is not counted again. Enough successes
 * pass the stage: the assisted one moves on to the unassisted one, which
 * completes the lesson and pays its reward. Nothing changes for a lesson
 * locked or done. A failure is not recorded: it costs nothing.
 */
export function recordSuccess(p: DojoProgress, id: string, key: string): { progress: DojoProgress; passed: boolean; completed: boolean } {
  const lesson = findLesson(id);
  const stage = lessonStage(p, id);
  const unchanged = { progress: p, passed: false, completed: false };
  if (!lesson || stage === 'locked' || stage === 'done') return unchanged;
  const cur: LessonProgress = p.lessons[id] ?? { assisted: false, count: 0, done: false, seen: [] };
  if (cur.seen.includes(key)) return unchanged;
  const count = cur.count + 1;
  const seen = [...cur.seen, key];
  if (count < (lesson.times ?? 1)) {
    return { progress: { ...p, lessons: { ...p.lessons, [id]: { ...cur, count, seen } } }, passed: false, completed: false };
  }
  if (stage === 'assisted') {
    return { progress: { ...p, lessons: { ...p.lessons, [id]: { ...cur, assisted: true, count: 0, seen } } }, passed: true, completed: false };
  }
  return { progress: completeLesson(p, lesson), passed: true, completed: true };
}

/**
 * Passes the lesson and pays its reward. Only recordSuccess calls it, on a
 * lesson unlocked and not done, so the reward is paid once; the item is
 * granted whatever the level its shop entry asks for (a lesson is not
 * gated by level), as a purchase would grant it (its yaku with it). An
 * item owned already pays its price in coins instead.
 */
function completeLesson(p: DojoProgress, lesson: Lesson): DojoProgress {
  const lessons = { ...p.lessons, [lesson.id]: { assisted: true, count: 0, done: true, seen: [] } };
  let coins = p.coins + lesson.reward.coins;
  let { ownedItems, ownedYaku } = p;
  const item = lesson.reward.item === undefined ? undefined : findItem(lesson.reward.item);
  if (item) {
    const grants = item.grants ?? [];
    const owned = ownedItems.includes(item.id) || (grants.length > 0 && grants.every((k) => ownedYaku.includes(k)));
    if (owned) coins += item.price;
    else {
      ownedItems = [...ownedItems, item.id];
      ownedYaku = [...ownedYaku, ...grants.filter((k) => !ownedYaku.includes(k))];
    }
  }
  return { ...p, coins, ownedItems, ownedYaku, lessons };
}
