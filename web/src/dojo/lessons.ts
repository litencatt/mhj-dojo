// The dojo's curriculum (#316): lessons in stages 0 to 5, each teaching one
// thing, in the order of what they rest on. A lesson is played in practice
// mode or in a dojo game, judged by a pure function of what the engine
// returns, first with its assists and then without them; passing it without
// them pays its reward, once. A failure costs nothing. No page plays them yet
// (#318); plain Node runs the tests, so imports carry the .ts extension.
import type { GameEvent, GameResult, SessionState, Tile } from '../apiTypes.ts';
import { parseTile } from '../tiles.ts';
import { YAKUHAI_KEYS, findItem } from './catalog.ts';
import type { DojoProgress, LessonProgress } from './progress.ts';

/** A practice-mode step: the state reached, and the state and discard that led to it (none at the start). */
export interface PracticeStep {
  before: SessionState | null;
  discard: Tile | null;
  after: SessionState;
}

/** A dojo game's round once it has ended: its result and every move of the round. */
export interface RoundRecord {
  you: number;
  result: GameResult;
  events: GameEvent[];
}

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
}

export type Lesson =
  | (LessonBase & { form: 'practice'; judge: (s: PracticeStep) => boolean })
  | (LessonBase & { form: 'game'; judge: (r: RoundRecord) => boolean });

// The coins of a lesson that grants no item: small and provisional. The rewards
// are not in the economy yet (economy.test.ts leaves them out); #320 sets them.
const LESSON_COINS = 20;

const NOYAKU = ['assist:noyaku'];
const UKEIRE = ['assist:ukeire'];
const DANGER = ['assist:danger'];

// ---- Judging helpers ----

/** The tile's kind: a red five as a five. */
function kind(t: Tile): Tile {
  return t[0] === '0' ? `5${t[1]}` : t;
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

/**
 * Whether the tile is suji against a river: a 1-3 whose +3 is in it, a 7-9
 * whose -3 is, a 4-6 whose both are (an honor never is).
 */
export function isSuji(tile: Tile, river: readonly Tile[]): boolean {
  const { suit, rank } = parseTile(tile);
  if (suit === 'z') return false;
  const has = (n: number) => river.includes(`${n}${suit}`);
  if (rank <= 3) return has(rank + 3);
  if (rank >= 7) return has(rank - 3);
  return has(rank - 3) && has(rank + 3);
}

/**
 * Your discards after another seat's riichi, each with the rivers (as kinds)
 * of the seats in riichi at that moment. Empty when nobody else declared.
 */
export function discardsAgainstRiichi(r: RoundRecord): { tile: Tile; rivers: Tile[][] }[] {
  const rivers = new Map<number, Tile[]>();
  const inRiichi = new Set<number>();
  const out: { tile: Tile; rivers: Tile[][] }[] = [];
  for (const e of r.events) {
    if ((e.type !== 'discard' && e.type !== 'riichi') || e.tile === undefined) continue;
    if (e.seat === r.you && inRiichi.size > 0) out.push({ tile: kind(e.tile), rivers: [...inRiichi].map((s) => [...(rivers.get(s) ?? [])]) });
    rivers.set(e.seat, [...(rivers.get(e.seat) ?? []), kind(e.tile)]);
    if (e.type === 'riichi' && e.seat !== r.you) inRiichi.add(e.seat);
  }
  return out;
}

const genbutsu = (d: { tile: Tile; rivers: Tile[][] }) => d.rivers.every((river) => river.includes(d.tile));
const sujiOrGenbutsu = (d: { tile: Tile; rivers: Tile[][] }) =>
  d.rivers.every((river) => river.includes(d.tile) || isSuji(d.tile, river));

/** Whether another seat declared riichi in the round. */
function otherRiichi(r: RoundRecord): boolean {
  return r.events.some((e) => e.type === 'riichi' && e.seat !== r.you);
}

// ---- The lessons ----

function handYaku(
  id: string,
  stage: 2 | 5,
  key: string,
  title: string,
  text: string,
  example: string,
  requires: string[],
  reward: Lesson['reward'],
): Lesson {
  return {
    id, stage, title, text, example, form: 'game', assists: stage === 2 ? NOYAKU : [],
    tempYaku: stage === 5 ? [key] : [], reward, requires,
    judge: (r) => wonWith(r, [key]),
  };
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'shape-win', stage: 0, title: '和了形を作る', form: 'practice',
    text: '和了の形は4面子1雀頭（3+3+3+3+2）。面子は順子（123のような続き）か刻子（同じ牌3枚）、雀頭は同じ牌2枚。練習モードで、シャンテン数を見ながらツモ和了まで手を進めよう。',
    example: '123m456p789s111z55p',
    assists: [], tempYaku: [], reward: { coins: LESSON_COINS }, requires: [],
    judge: (s) => s.after.status === 'tsumo' && s.after.win !== null,
  },
  {
    id: 'ryanmen-tenpai', stage: 1, title: '両面で聴牌する', form: 'practice',
    text: '待ちの形には両面・嵌張・辺張・単騎・双碰がある。両面（34 で 2・5 を待つ）は待ちの牌が2種8枚と最も広い。両面の待ちで聴牌しよう。',
    example: '123m456p789s34m55z',
    assists: UKEIRE, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['shape-win'],
    judge: (s) => normalShanten(s.after) === 0 && s.after.hand_groups.some((g) => g.type === 'ryanmen'),
  },
  {
    id: 'max-ukeire', stage: 1, title: '受け入れの多い方を残す', form: 'practice', times: 5,
    text: '有効牌（引けばシャンテン数が進む牌）が多いほど、早く聴牌できる。シャンテン数を下げず、有効牌が最も多く残る牌を切ろう（5回）。',
    assists: UKEIRE, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['shape-win'],
    judge: (s) => s.before !== null && s.discard !== null && bestDiscards(s.before).includes(kind(s.discard)),
  },
  {
    id: 'furiten', stage: 1, title: '振聴を避けてロンする', form: 'game',
    text: '自分の捨て牌に待ちの牌が1枚でもあると振聴で、ロンできない（ツモなら和了れる）。待ちの牌を捨てていない形で聴牌し、ロンで和了しよう。振聴ではロンが出ないので、ロンできたことが振聴を避けた証になる。',
    assists: NOYAKU, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['ryanmen-tenpai'],
    judge: (r) => won(r) && r.result.kind === 'ron',
  },
  handYaku('riichi-win', 2, 'riichi', '立直して和了する',
    '和了には役が1つ以上要る（1翻縛り）。立直は、門前で聴牌して宣言すれば、手の形を問わず役になる。',
    '234m567m345p678s22s', ['shape-win'], { coins: LESSON_COINS }),
  handYaku('tsumo-win', 2, 'tsumo', '門前でツモ和了する',
    '鳴かずに（門前で）自分で引いて和了すれば、門前清自摸和という役になる。ロンでは付かない。',
    '234m567m345p678s22s', ['shape-win'], { coins: LESSON_COINS }),
  handYaku('tanyao-win', 2, 'tanyao', '断么九で和了する',
    '2〜8の数牌だけで作れば断么九。1・9と字牌を使わない、という決まりだけで、鳴いても付く。',
    '234m567m345p678s22s', ['shape-win'], { coins: LESSON_COINS }),
  {
    id: 'yakuhai-pon', stage: 3, title: '役牌をポンして和了する', form: 'game',
    text: '白・發・中と、場風・自風の刻子は1翻。ポンしても役が残るので、鳴くならまず役牌から。鳴くと立直はできなくなる。',
    example: '234m567p789s22p555z',
    assists: NOYAKU, tempYaku: YAKUHAI_KEYS, reward: { item: 'yakuhai', coins: 0 }, requires: ['riichi-win', 'tanyao-win'],
    judge: (r) => called(r, 'pon') && wonWith(r, YAKUHAI_KEYS),
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
    assists: NOYAKU, tempYaku: ['rinshan'], reward: { item: 'rinshan', coins: 0 }, requires: ['yakuhai-pon'],
    judge: (r) => called(r, 'kan') && won(r),
  },
  {
    id: 'genbutsu', stage: 4, title: '現物を切る', form: 'game',
    text: 'リーチした人が捨てた牌（現物）では、その人にロンされない。他家のリーチの後は、現物だけを切って局を終えよう。',
    assists: DANGER, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['riichi-win'],
    judge: (r) => {
      const ds = discardsAgainstRiichi(r);
      return ds.length > 0 && ds.every(genbutsu) && !dealtIn(r);
    },
  },
  {
    id: 'suji', stage: 4, title: 'スジを使う', form: 'game',
    text: '両面待ちは、捨て牌に4があれば1・7では待てない（スジ）。現物がないときは、スジの牌が比較的安全。他家のリーチの後、現物かスジだけを切り、スジを1枚以上使って局を終えよう。',
    assists: DANGER, tempYaku: [], reward: { coins: LESSON_COINS }, requires: ['genbutsu', 'ryanmen-tenpai'],
    judge: (r) => {
      const ds = discardsAgainstRiichi(r);
      return ds.some((d) => !genbutsu(d)) && ds.every(sujiOrGenbutsu) && !dealtIn(r);
    },
  },
  {
    id: 'fold', stage: 4, title: 'リーチを受けて降りきる', form: 'game', times: 3,
    text: '降りの目安: 2向聴以下なら降りる、1向聴ならスジまで、聴牌なら押す。他家のリーチの後、放銃せずに局を終えよう（3回）。',
    assists: DANGER, tempYaku: [], reward: { item: 'assist:danger', coins: 0 }, requires: ['suji'],
    judge: (r) => otherRiichi(r) && !dealtIn(r),
  },
  handYaku('pinfu-win', 5, 'pinfu', '平和で和了する',
    '門前で、面子がすべて順子、雀頭が役牌でなく、両面待ちで和了すると平和。段1の両面待ちが前提。',
    '123m678m345p789s55p', ['ryanmen-tenpai', 'riichi-win'], { item: 'pinfu', coins: 0 }),
  handYaku('honitsu-win', 5, 'honitsu', '混一色で和了する',
    '1種類の数牌と字牌だけで作ると混一色。門前で3翻、鳴いても2翻。',
    '123m456m789m111z55z', ['pinfu-win', 'yakuhai-pon'], { item: 'honitsu', coins: 0 }),
  handYaku('iipeikou-win', 5, 'iipeikou', '一盃口で和了する',
    '同じ順子を2つ（223344 のように）作ると一盃口。門前限定。',
    '223344m567p678s55s', ['honitsu-win'], { item: 'iipeikou', coins: 0 }),
  handYaku('sanshoku-win', 5, 'sanshoku', '三色同順で和了する',
    '萬子・筒子・索子で同じ数の順子をそろえると三色同順。門前で2翻、鳴くと1翻。',
    '123m123p123s789m55z', ['iipeikou-win'], { item: 'sanshoku', coins: 0 }),
  handYaku('chiitoitsu-win', 5, 'chiitoitsu', '七対子で和了する',
    '対子を7つ（すべて違う牌）そろえると七対子。4面子1雀頭ではない、例外の和了形。',
    '1133m5577p2299s11z', ['sanshoku-win'], { item: 'chiitoitsu', coins: 0 }),
  handYaku('toitoi-win', 5, 'toitoi', '対々和で和了する',
    '面子をすべて刻子にすると対々和。ポンしても2翻のまま。',
    '111m555p999s222z33z', ['chiitoitsu-win'], { item: 'toitoi', coins: 0 }),
  handYaku('ittsu-win', 5, 'ittsu', '一気通貫で和了する',
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

/** The yaku and the assists a lesson's game or practice adds for now, at the lesson's stage. */
export function lessonAids(p: DojoProgress, id: string): { yaku: string[]; assists: string[] } {
  const lesson = findLesson(id);
  if (!lesson) return { yaku: [], assists: [] };
  return { yaku: [...lesson.tempYaku], assists: lessonStage(p, id) === 'assisted' ? [...lesson.assists] : [] };
}

/**
 * Counts one success of a lesson at its stage. Enough of them pass the stage:
 * the assisted one moves on to the unassisted one, which completes the lesson
 * (completeLesson). Nothing changes for a lesson locked or done.
 */
export function recordSuccess(p: DojoProgress, id: string): { progress: DojoProgress; passed: boolean; completed: boolean } {
  const lesson = findLesson(id);
  const stage = lessonStage(p, id);
  if (!lesson || stage === 'locked' || stage === 'done') return { progress: p, passed: false, completed: false };
  const cur: LessonProgress = p.lessons[id] ?? { assisted: false, count: 0, done: false };
  const count = cur.count + 1;
  if (count < (lesson.times ?? 1)) {
    return { progress: { ...p, lessons: { ...p.lessons, [id]: { ...cur, count } } }, passed: false, completed: false };
  }
  if (stage === 'assisted') {
    return { progress: { ...p, lessons: { ...p.lessons, [id]: { ...cur, assisted: true, count: 0 } } }, passed: true, completed: false };
  }
  return { progress: completeLesson(p, id), passed: true, completed: true };
}

/**
 * Passes the lesson and pays its reward, once: a lesson done already changes
 * nothing. The item is granted as a purchase would (its yaku with it); an
 * item owned already pays its price in coins instead.
 */
export function completeLesson(p: DojoProgress, id: string): DojoProgress {
  const lesson = findLesson(id);
  if (!lesson || p.lessons[id]?.done) return p;
  const lessons = { ...p.lessons, [id]: { assisted: true, count: 0, done: true } };
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
