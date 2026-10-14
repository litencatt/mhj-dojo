// The practice problems' page (?mode=quiz, issue #239): what it reads from
// and writes to its URL, and the names it shows. Pure, so `npm test` runs it
// in plain Node (quiz.test.ts).

import type { ProblemKind, Tile } from '../apiTypes';

/** The kinds the page asks so far: machi (#242) needs a many-tile answer, oshihiki (#241) the rivers. */
export type QuizKind = Extract<ProblemKind, 'nanikiru'>;

/** The problem a URL asks for: no seed lets the engine pick one (written back into the URL once known). */
export interface QuizParams {
  kind: QuizKind;
  level: number;
  seed: number | undefined;
}

// Each kind's page: its heading and its question. Later kinds (machi #242,
// oshihiki #241) add theirs here.
export const KINDS: Record<QuizKind, { title: string; prompt: string }> = {
  nanikiru: { title: '何切る', prompt: '何を切る？' },
};

// The levels a kind offers, as the 設定 names them (docs/problems.md).
export const LEVEL_NAMES: Record<QuizKind, Record<string, string>> = {
  nanikiru: { '1': '1向聴', '2': '2向聴', '3': '上級' },
};

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
