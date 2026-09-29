import type { YakuRow } from '../api';

// Readings used by the name search, in katakana (queries are normalised to
// katakana, so hiragana input matches too).
const READINGS: Record<string, string> = {
  normal: 'イッパンケイ',
  tanyao: 'タンヤオ タンヤオチュー',
  pinfu: 'ピンフ',
  iipeikou: 'イーペーコー',
  ryanpeikou: 'リャンペーコー',
  sanshoku: 'サンショク サンショクドウジュン',
  sanshoku_doukou: 'サンショクドウコー',
  ittsu: 'イッツー イッキツウカン',
  chanta: 'チャンタ',
  junchan: 'ジュンチャン',
  honroutou: 'ホンロートー',
  honitsu: 'ホンイツ ホンイーソー ソメ',
  chinitsu: 'チンイツ チンイーソー ソメ',
  toitoi: 'トイトイ',
  sanankou: 'サンアンコー',
  shousangen: 'ショウサンゲン',
  haku: 'ヤクハイ ハク',
  hatsu: 'ヤクハイ ハツ',
  chun: 'ヤクハイ チュン',
  ton: 'ヤクハイ トン ダブトン',
  nan: 'ヤクハイ ナン',
  shaa: 'ヤクハイ シャー',
  pei: 'ヤクハイ ペー',
  chiitoitsu: 'チートイツ',
  kokushi: 'コクシムソウ',
  suuankou: 'スーアンコー',
  daisangen: 'ダイサンゲン',
  tsuuiisou: 'ツーイーソー',
  shousuushii: 'ショウスーシー',
  daisuushii: 'ダイスーシー',
  ryuuiisou: 'リューイーソー',
  chinroutou: 'チンロートー',
  chuuren: 'チューレンポートー',
};

export type Category = '1' | '2' | '3' | 'yakuman';
export type SortOrder = 'default' | 'shanten' | 'ukeire';

export const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: '1', label: '1翻' },
  { key: '2', label: '2翻' },
  { key: '3', label: '3翻以上' },
  { key: 'yakuman', label: '役満' },
];

export interface YakuFilter {
  query: string;
  maxShanten: number | null; // null = no limit
  categories: Category[]; // shown categories
  sort: SortOrder;
}

export const DEFAULT_FILTER: YakuFilter = {
  query: '',
  maxShanten: null,
  categories: ['1', '2', '3', 'yakuman'],
  sort: 'default',
};

export function isDefaultFilter(f: YakuFilter): boolean {
  return (
    f.query.trim() === '' &&
    f.maxShanten === null &&
    f.sort === 'default' &&
    DEFAULT_FILTER.categories.every((c) => f.categories.includes(c))
  );
}

function categoryOf(row: YakuRow): Category {
  if (row.yakuman) return 'yakuman';
  if (row.han >= 3) return '3';
  return row.han === 2 ? '2' : '1';
}

function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

function matchesQuery(row: YakuRow, query: string): boolean {
  const q = toKatakana(query.trim().toLowerCase());
  if (q === '') return true;
  return `${row.name} ${READINGS[row.key] ?? ''} ${row.key}`.toLowerCase().includes(q);
}

// Impossible (null) sorts after every finite shanten.
const shantenKey = (r: YakuRow) => (r.shanten === null ? Infinity : r.shanten);

function compare(sort: SortOrder, order: Map<string, number>) {
  const byDefault = (a: YakuRow, b: YakuRow) => order.get(a.key)! - order.get(b.key)!;
  if (sort === 'shanten') {
    return (a: YakuRow, b: YakuRow) =>
      shantenKey(a) - shantenKey(b) || b.ukeire_total - a.ukeire_total || byDefault(a, b);
  }
  if (sort === 'ukeire') {
    return (a: YakuRow, b: YakuRow) =>
      b.ukeire_total - a.ukeire_total || shantenKey(a) - shantenKey(b) || byDefault(a, b);
  }
  return byDefault;
}

export interface FilteredKeys {
  keys: string[]; // yaku rows (yakuman included), filtered and sorted
  total: number; // number of yaku rows (excluding "normal")
}

/** Filters and sorts rows by the given (current, not preview) values. The
 * "normal" row is not a yaku and is never filtered; callers show it first. */
export function applyYakuFilter(rows: YakuRow[], f: YakuFilter): FilteredKeys {
  const order = new Map(rows.map((r, i) => [r.key, i]));
  const yakuRows = rows.filter((r) => r.key !== 'normal');
  const kept = yakuRows.filter(
    (r) =>
      f.categories.includes(categoryOf(r)) &&
      matchesQuery(r, f.query) &&
      (f.maxShanten === null || (r.shanten !== null && r.shanten <= f.maxShanten)),
  );
  const cmp = compare(f.sort, order);
  return { keys: kept.sort(cmp).map((r) => r.key), total: yakuRows.length };
}

const STORAGE_KEY = 'mhj-dojo.yakuFilter';

/** Reads the saved filter; storage may be unavailable (private mode etc.). */
export function loadFilter(): YakuFilter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTER;
    const v = JSON.parse(raw) as Partial<YakuFilter>;
    return {
      query: typeof v.query === 'string' ? v.query : '',
      maxShanten: typeof v.maxShanten === 'number' ? v.maxShanten : null,
      categories: Array.isArray(v.categories)
        ? v.categories.filter((c): c is Category => CATEGORIES.some((x) => x.key === c))
        : DEFAULT_FILTER.categories,
      sort: v.sort === 'shanten' || v.sort === 'ukeire' ? v.sort : 'default',
    };
  } catch {
    return DEFAULT_FILTER;
  }
}

export function saveFilter(f: YakuFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Storage unavailable: the filter just won't persist.
  }
}

const OPEN_KEY = 'mhj-dojo.yakuFilterOpen';

/** Whether the filter bar was last left open ('1') or closed ('0'); null
 * until the player first toggles it, and whenever storage fails. */
export function loadFilterOpen(): boolean | null {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function saveFilterOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable: the choice just won't persist.
  }
}
