// The dojo's yaku guide: what a bought yaku asks for, its han, an example hand and a practice seed.
// The han and the examples are in yakuGuide.json and the seeds in yakuSeeds.json; internal/session's
// yakuguide_test.go checks both against the engine (the examples are complete hands that score the
// yaku, the seeds are the best of 1..range for the yaku's row), so they cannot drift.
import { YAKU_CONDITIONS } from '../components/yakuInfo.ts';
import { YAKUHAI_KEYS, yakuName } from './catalog.ts';
import guideData from './yakuGuide.json' with { type: 'json' };
import seedData from './yakuSeeds.json' with { type: 'json' };

interface GuideEntry {
  han: number;
  openHan: number | null; // null: needs a closed hand
  example: { hand: string; melds?: string[]; win: string; note?: string };
}

interface SeedEntry {
  seed: number;
  row: string; // the analysis row (key) the seed's shanten is of
  shanten: number;
}

const GUIDE = guideData as Record<string, GuideEntry>;
const SEEDS = (seedData as { seeds: Record<string, SeedEntry> }).seeds;

// The conditions yakuInfo.ts (the yaku table's tooltips, which are about the table's rows) lacks.
const CONDITIONS: Record<string, string> = {
  riichi: '門前で聴牌し、1000点を供託して立直を宣言する。以後は手を変えず、ツモ牌を切り続ける。',
  double_riichi: '配牌から最初の打牌で立直を宣言する（それまでに誰も鳴いていないこと）。',
  ippatsu: '立直の宣言から自分の次の打牌までに和了する。その間に誰かが鳴くと付かない。',
  haitei: '山の最後の牌をツモって和了する。',
  houtei: '最後の捨て牌でロンする。',
  rinshan: 'カンして引いた嶺上牌で和了する。',
  chankan: '他家が加槓した牌でロンする。',
  sankantsu: 'カンを3回して、槓子（4枚の組）を3つ作る。',
  yakuhai: '白・發・中の刻子、または場風・自風の刻子。それぞれ1翻（東場の東家の東は2翻）。',
};

export interface YakuGuide {
  key: string; // the shop item's id (the 役牌 bundle's is 'yakuhai')
  name: string;
  condition: string;
  /** "1翻（門前限定）", "2翻（鳴くと1翻）" or "2翻（鳴いても同じ）". */
  hanLabel: string;
  /** The tiles in hand (without the winning tile), the called or concealed kans, and the winning tile. */
  example: { hand: string[]; melds: string[][]; win: string; note?: string };
  /** The practice seed, and what the starting hand is at in its row; none where practice mode cannot reach the yaku. */
  practice: { seed: number; rowName: string; shanten: number } | null;
}

/** The guide key of an owned yaku key: the dragons and the winds are one item, 役牌. */
export function guideKeyOf(yakuKey: string): string {
  return YAKUHAI_KEYS.includes(yakuKey) ? 'yakuhai' : yakuKey;
}

/** Tile codes of compact notation: "123m55z" gives 1m 2m 3m 5z 5z. */
export function expandTiles(notation: string): string[] {
  const out: string[] = [];
  let digits = '';
  for (const ch of notation) {
    if (ch >= '0' && ch <= '9') digits += ch;
    else {
      for (const d of digits) out.push(d + ch);
      digits = '';
    }
  }
  return out;
}

function hanLabel(han: number, openHan: number | null): string {
  if (openHan === null) return `${han}翻（門前限定）`;
  if (openHan === han) return `${han}翻（鳴いても同じ）`;
  return `${han}翻（鳴くと${openHan}翻）`;
}

/** The ids of the shop items that have a guide. */
export const GUIDE_KEYS: readonly string[] = Object.keys(GUIDE);

/** The guide of a shop item (or an owned yaku key), or undefined for an item without one. */
export function guideFor(key: string): YakuGuide | undefined {
  const k = guideKeyOf(key);
  const g = GUIDE[k];
  if (!g) return undefined;
  const win = g.example.win;
  const hand = expandTiles(g.example.hand);
  hand.splice(hand.indexOf(win), 1);
  const s = SEEDS[k];
  return {
    key: k,
    name: k === 'yakuhai' ? '役牌' : yakuName(k),
    condition: CONDITIONS[k] ?? YAKU_CONDITIONS[k] ?? '',
    hanLabel: hanLabel(g.han, g.openHan),
    example: { hand, melds: (g.example.melds ?? []).map(expandTiles), win, note: g.example.note },
    practice: s ? { seed: s.seed, rowName: s.row === 'normal' ? '一般形' : yakuName(s.row), shanten: s.shanten } : null,
  };
}

/** The practice mode (?seed=&turns=) on a guide's seed, or undefined where there is none. */
export function practiceHref(g: YakuGuide): string | undefined {
  return g.practice ? `?seed=${g.practice.seed}&turns=18` : undefined;
}
