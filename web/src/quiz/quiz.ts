// The practice problems' page (?mode=quiz, issue #239): what it reads from
// and writes to its URL, and the names it shows. Pure, so `npm test` runs it
// in plain Node (quiz.test.ts).

import type { Problem, ProblemKind, ProblemResult, Tile } from '../apiTypes';

/** The kinds the page asks. */
export type QuizKind = ProblemKind;

/** The problem a URL asks for: no seed lets the engine pick one (written back into the URL once known). */
export interface QuizParams {
  kind: QuizKind;
  level: number;
  seed: number | undefined;
}

// Each kind's page: its heading and its question.
export const KINDS: Record<QuizKind, { title: string; prompt: string }> = {
  nanikiru: { title: '何切る', prompt: '何を切る？' },
  machi: { title: '待ち当て', prompt: '待ちの牌をすべて選ぶ' },
  oshihiki: { title: '押し引き', prompt: 'リーチに対して、いちばん安全な牌は？' },
};

// The levels a kind offers, as the 設定 names them (docs/problems.md).
export const LEVEL_NAMES: Record<QuizKind, Record<string, string>> = {
  nanikiru: { '1': '1向聴', '2': '2向聴', '3': '上級' },
  machi: { '1': '基本形', '2': '複合形', '3': '清一色' },
  oshihiki: { '1': '現物あり', '2': '現物なし', '3': '複数リーチ' },
};

/** The kinds as the 設定 names them. */
export const KIND_NAMES: Record<QuizKind, string> = { nanikiru: KINDS.nanikiru.title, machi: KINDS.machi.title, oshihiki: KINDS.oshihiki.title };

/** A tile's kind, as a tile: a red five as its plain copy. */
export function kindKey(t: Tile): Tile {
  return t[0] === '0' ? `5${t[1]}` : t;
}

/** The other seats as you see them: 下家, 対面, 上家 (seat 0 is yours). */
export function seatName(seat: number): string {
  return ['自分', '下家', '対面', '上家'][((seat % 4) + 4) % 4];
}

/** The tile kinds a many-tile answer picks from, a row per suit: 萬子, 筒子, 索子, then the honors. */
export const PICKER_ROWS: readonly (readonly Tile[])[] = [
  ...(['m', 'p', 's'] as const).map((suit) => Array.from({ length: 9 }, (_, i) => `${i + 1}${suit}`)),
  Array.from({ length: 7 }, (_, i) => `${i + 1}z`),
];

// The most kinds an answer holds: the engine asks no wider wait (九面待ち, docs/problems.md).
export const MAX_PICKS = 9;

const PICK_ORDER = PICKER_ROWS.flat();

/** picked with t added or, if there, taken out, in the picker's order; past MAX_PICKS nothing is added. */
export function togglePick(picked: readonly Tile[], t: Tile): Tile[] {
  if (picked.includes(t)) return picked.filter((p) => p !== t);
  if (picked.length >= MAX_PICKS) return [...picked];
  return [...picked, t].sort((a, b) => PICK_ORDER.indexOf(a) - PICK_ORDER.indexOf(b));
}

const isKind = (s: string | null): s is QuizKind => s !== null && Object.hasOwn(KINDS, s);

/**
 * The problem asked for by a URL's query: an unknown kind or level falls
 * back to the first (nanikiru, 1), and a seed counts only as the engine
 * would take it (a decimal 0 … 2^53−1, no sign or leading zero), else the
 * engine picks one.
 */
export function parseQuizParams(search: string): QuizParams {
  const q = new URLSearchParams(search);
  const kindParam = q.get('kind');
  const kind: QuizKind = isKind(kindParam) ? kindParam : 'nanikiru';
  const levelParam = q.get('level') ?? '';
  const level = Object.hasOwn(LEVEL_NAMES[kind], levelParam) ? Number(levelParam) : 1;
  const s = q.get('seed') ?? '';
  const seed = /^(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined;
  return { kind, level, seed };
}

/** The URL of a problem: url with mode, kind, level and seed set (other params kept). */
export function quizUrl(url: string, p: { kind: ProblemKind; level: number; seed: number }): string {
  const u = new URL(url);
  u.searchParams.set('mode', 'quiz');
  u.searchParams.set('kind', p.kind);
  u.searchParams.set('level', String(p.level));
  u.searchParams.set('seed', String(p.seed));
  return u.toString();
}

/** The seed after seed (次の問題), back to 0 past the largest the engine takes. */
export function nextSeed(seed: number): number {
  return seed >= Number.MAX_SAFE_INTEGER ? 0 : seed + 1;
}

/** The dora an indicator points to: the next of its suit (9 → 1, 北 → 東, 中 → 白); a red five points to 6. */
export function doraOf(indicator: Tile): Tile {
  const suit = indicator[1];
  const rank = indicator[0] === '0' ? 5 : Number(indicator[0]);
  if (suit !== 'z') return `${(rank % 9) + 1}${suit}`;
  return rank <= 4 ? `${(rank % 4) + 1}z` : `${((rank - 4) % 3) + 5}z`;
}

/** 向聴 as the ranking shows it: 0 is 聴牌. */
export function shantenLabel(s: number): string {
  return s === 0 ? '聴牌' : `${s}向聴`;
}

/** A tile's mark once graded: its class (raised as correct, or outlined red) and what it says. */
export interface AnswerMark {
  className: 'tile-advice' | 'tile-quiz-wrong';
  text: string;
}

/**
 * The marks of a graded answer, by tile: the correct tiles raised (in the
 * hand, or in the picker for machi, where a wait left out says so), the
 * answer's wrong tiles outlined in red. oshihiki is graded by kind, so every
 * tile of a correct kind in the hand is marked, a red five as its plain copy.
 */
export function answerMarks(problem: Problem, result: ProblemResult, answer: readonly Tile[]): Record<Tile, AnswerMark> {
  const marks: Record<Tile, AnswerMark> = {};
  const correct = (mine: boolean): AnswerMark => ({ className: 'tile-advice', text: mine ? '正解、あなたの答え' : '正解' });
  const wrong: AnswerMark = { className: 'tile-quiz-wrong', text: 'あなたの答え' };
  if (problem.kind === 'oshihiki') {
    const bestKinds = result.best.map(kindKey);
    const { hand, drawn } = problem.position;
    for (const t of drawn ? [...hand, drawn] : hand) {
      if (bestKinds.includes(kindKey(t))) marks[t] = correct(answer.includes(t));
      else if (answer.includes(t)) marks[t] = wrong;
    }
    return marks;
  }
  for (const t of answer) if (!result.best.includes(t)) marks[t] = wrong;
  for (const t of result.best) {
    marks[t] = answer.includes(t) || problem.choose === 'one' ? correct(answer.includes(t)) : { className: 'tile-advice', text: '正解、見逃し' };
  }
  return marks;
}
