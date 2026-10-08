// The dojo's shop and the economy's constants. Every number that tunes the
// economy lives here; progress.ts and the tests read them from here.
//
// Economy targets (economy.test.ts checks them). "The core" is the yaku, the
// assists and the tile themes; the cheats and the other looks (the tile backs,
// the table cloths, the riichi sticks and the win effects) are left out.
// - What a game is worth goes up as the yaku are bought. The engine measured
//   it (docs/dojo-economy.md: seat 0 played by the weak CPU, 400 東風戦 a stage):
//     S0 the initial yaku    1st-4th 8.0/25.5/29.0/37.5%, 0.74 han, 0.58 wins: about 43 XP, 41 coins
//     S1 + 立直・役牌          22.2/22.8/26.0/29.0%,         1.66 han, 1.02 wins: about 63 XP, 60 coins
//     S2 + every 2-han yaku  24.5/24.5/24.2/26.8%,         2.0 han,  1.11 wins: about 69 XP, 66 coins
//     S3 every yaku          27.8/23.5/23.5/25.2%,         2.37 han, 1.11 wins: about 75 XP, 71 coins
//   (the rank's base, the won han x 10 and the 和了祝儀's 10 coins a win).
//   The 和了祝儀 makes a win worth more than playing safe for a rank.
//   The measurement above is the slow bound. Seat 0 played human-like (the
//   normal CPU without calls, folding against a riichi; #273) is the fast one:
//   about 61 / 88 / 96 / 106 XP a game at S0 to S3, Lv10 in 40 to 60 games and
//   the whole shop in 110 to 150 (economy.test.ts checks both).
// - 立直 is affordable within 1-2 games: the first-game bonus alone covers it.
// - Lv10 (4500 XP) comes after about 70 games, by which time 80% or more of
//   the core's coin cost (the yakuman pack aside) has been bought.
// - The yakuman pack costs at most 40 more games after Lv10, the core bought first.
// - The cheats and the other looks too: the whole shop is bought in about 175 games.

/** XP and coins by final rank (1st to 4th). */
export const RANK_XP = [100, 60, 30, 10] as const;
export const RANK_COINS = [60, 40, 25, 15] as const;
/** XP and coins per han of the counted yaku (dora not included). */
export const XP_PER_HAN = 10;
export const COINS_PER_HAN = 10;
/** Coins per won round (和了祝儀), whatever its han; no XP. */
export const WIN_BONUS_COINS = 10;
/** The coins one redraw (引き直し) costs, settled at the end of the game. */
export const REDRAW_COST = 20;
/** The coins one summon (牌寄せ) costs, settled at the end of the game like a redraw. */
export const SUMMON_COST = 50;
/** Coins for the first finished game. */
export const FIRST_GAME_BONUS = 40;

/** The yaku a new dojo owns: 断么九, 平和 and 門前清自摸和. 役牌 is bought. */
export const WIND_KEYS = ['ton', 'nan', 'shaa', 'pei'] as const; // internal/yaku WindKeys
export const INITIAL_YAKU: readonly string[] = ['tanyao', 'pinfu', 'tsumo'];

/** The keys the 役牌 item grants: the dragons and the value winds. */
export const YAKUHAI_KEYS: readonly string[] = ['haku', 'hatsu', 'chun', ...WIND_KEYS];

/** The yakuman an owned 役満パック grants: all of them. */
export const YAKUMAN_KEYS: readonly string[] = [
  'kokushi', 'suuankou', 'daisangen', 'tsuuiisou', 'shousuushii', 'daisuushii',
  'ryuuiisou', 'chinroutou', 'chuuren', 'suukantsu', 'tenhou', 'chiihou',
];

export const YAKUMAN_PACK = 'yakuman-pack';
export const DEFAULT_THEME = 'default';
export const DEFAULT_BACK = 'default';
export const DEFAULT_CLOTH = 'default';
export const DEFAULT_STICK = 'default';
export const DEFAULT_EFFECT = 'default';

export type ItemKind = 'yaku' | 'theme' | 'back' | 'cloth' | 'stick' | 'effect' | 'assist' | 'cheat' | 'pack';

export interface ShopItem {
  /** A yaku's key, or 'theme:*', 'back:*', 'cloth:*', 'stick:*', 'effect:*', 'assist:*', 'cheat:*', 'yakuman-pack'. */
  id: string;
  kind: ItemKind;
  name: string;
  price: number;
  level: number;
  /** Ids (a yaku key or an item id) that must be owned first. */
  requires?: string[];
  /** The yaku keys an owned item adds: the item's own key, or a group's (役牌, the pack's yakuman). */
  grants?: readonly string[];
}

function yaku(id: string, name: string, level: number, price: number, requires?: string[]): ShopItem {
  return { id, kind: 'yaku', name, price, level, requires, grants: [id] };
}

export const CATALOG: readonly ShopItem[] = [
  yaku('riichi', '立直', 1, 40),
  { id: 'yakuhai', kind: 'yaku', name: '役牌（白・發・中・場風・自風）', price: 40, level: 1, grants: YAKUHAI_KEYS },
  yaku('iipeikou', '一盃口', 1, 40),
  { id: 'assist:noyaku', kind: 'assist', name: '補助: 役なし警告', price: 40, level: 1 },
  { id: 'assist:speed-fast', kind: 'assist', name: '補助: 再生速度「速い」', price: 40, level: 1 },
  { id: 'cloth:midori', kind: 'cloth', name: '卓布: 緑', price: 40, level: 1 },
  { id: 'stick:tenbou', kind: 'stick', name: 'リーチ棒: 千点棒', price: 40, level: 1 },

  yaku('ippatsu', '一発', 2, 30, ['riichi']),
  yaku('haitei', '海底摸月', 2, 30),
  yaku('houtei', '河底撈魚', 2, 30),
  yaku('rinshan', '嶺上開花', 2, 30),
  yaku('chankan', '槍槓', 2, 30),
  { id: 'theme:wafuu', kind: 'theme', name: '牌テーマ: 和風', price: 50, level: 2 },
  { id: 'theme:mono', kind: 'theme', name: '牌テーマ: モノクロ', price: 50, level: 2 },
  { id: 'back:shima', kind: 'back', name: '裏柄: 縞', price: 40, level: 2 },
  { id: 'cloth:kon', kind: 'cloth', name: '卓布: 紺', price: 60, level: 2 },
  { id: 'effect:kamifubuki', kind: 'effect', name: '和了演出: 紙吹雪', price: 80, level: 2 },
  { id: 'assist:waits', kind: 'assist', name: '補助: 待ち牌表示', price: 60, level: 2 },
  { id: 'assist:autowin', kind: 'assist', name: '補助: 自動和了', price: 30, level: 2 },
  { id: 'assist:tsumogiri', kind: 'assist', name: '補助: 自動ツモ切り', price: 30, level: 2 },
  { id: 'assist:nocall', kind: 'assist', name: '補助: 鳴きなし', price: 30, level: 2 },

  yaku('sanshoku', '三色同順', 3, 80),
  yaku('ittsu', '一気通貫', 3, 80),
  yaku('chanta', '混全帯么九', 3, 80),
  yaku('chiitoitsu', '七対子', 3, 80),
  yaku('toitoi', '対々和', 3, 80),
  yaku('sanankou', '三暗刻', 3, 80),
  yaku('sanshoku_doukou', '三色同刻', 3, 80),
  yaku('sankantsu', '三槓子', 3, 80),
  yaku('shousangen', '小三元', 3, 80),
  yaku('honroutou', '混老頭', 3, 80),
  yaku('double_riichi', 'ダブル立直', 3, 80, ['riichi']),
  { id: 'theme:sakura', kind: 'theme', name: '牌テーマ: 桜', price: 80, level: 3 },
  { id: 'back:ichimatsu', kind: 'back', name: '裏柄: 市松', price: 60, level: 3 },
  { id: 'cloth:enji', kind: 'cloth', name: '卓布: えんじ', price: 60, level: 3 },
  { id: 'stick:take', kind: 'stick', name: 'リーチ棒: 竹', price: 60, level: 3 },
  { id: 'assist:preview', kind: 'assist', name: '補助: 打牌プレビュー・複合役', price: 100, level: 3 },
  { id: 'assist:speed-instant', kind: 'assist', name: '補助: 再生速度「なし」（一括表示）', price: 80, level: 3, requires: ['assist:speed-fast'] },

  { id: 'assist:advice', kind: 'assist', name: '補助: アドバイスパネル', price: 120, level: 4 },
  { id: 'assist:danger', kind: 'assist', name: '補助: 危険牌の印', price: 120, level: 4 },
  { id: 'theme:yonshoku', kind: 'theme', name: '牌テーマ: 四色牌', price: 100, level: 4 },
  { id: 'effect:sakura', kind: 'effect', name: '和了演出: 桜吹雪', price: 120, level: 4 },

  yaku('honitsu', '混一色', 5, 200),
  yaku('junchan', '純全帯么九', 5, 200),
  yaku('ryanpeikou', '二盃口', 5, 200),
  { id: 'theme:hisui', kind: 'theme', name: '牌テーマ: 翡翠', price: 120, level: 5 },
  { id: 'back:asanoha', kind: 'back', name: '裏柄: 麻の葉', price: 100, level: 5 },
  { id: 'stick:kogane', kind: 'stick', name: 'リーチ棒: 金', price: 100, level: 5 },
  { id: 'effect:kinkou', kind: 'effect', name: '和了演出: 金の光', price: 150, level: 5 },
  { id: 'assist:ukeire', kind: 'assist', name: '補助: 有効牌ハイライト', price: 150, level: 5 },

  { id: 'cheat:ura', kind: 'cheat', name: 'イカサマ: 裏ドラ透視', price: 600, level: 6 },

  yaku('chinitsu', '清一色', 7, 400),
  { id: 'theme:kogane', kind: 'theme', name: '牌テーマ: 黄金', price: 200, level: 7 },
  { id: 'cheat:riichiwaits', kind: 'cheat', name: 'イカサマ: リーチ者の待ち透視', price: 800, level: 7 },

  { id: 'cheat:peek', kind: 'cheat', name: 'イカサマ: 透視', price: 1000, level: 8 },
  { id: 'cheat:redraw', kind: 'cheat', name: 'イカサマ: 引き直し', price: 600, level: 8 },

  { id: 'cheat:wallpeek', kind: 'cheat', name: 'イカサマ: 山読み（次のツモ3枚）', price: 1200, level: 9 },

  { id: 'cheat:summon', kind: 'cheat', name: 'イカサマ: 牌寄せ（指定牌を手牌に、1局1回・50銭/回）', price: 1500, level: 10 },

  // 七対子 first: a 字一色 seven pairs would be thrown out with its 七対子 reading.
  { id: YAKUMAN_PACK, kind: 'pack', name: '役満パック', price: 2000, level: 10, requires: ['chiitoitsu'], grants: YAKUMAN_KEYS },
];

export function findItem(id: string): ShopItem | undefined {
  return CATALOG.find((it) => it.id === id);
}

const BASE_NAMES: Record<string, string> = {
  tanyao: '断么九', pinfu: '平和', tsumo: '門前清自摸和', haku: '役牌 白', hatsu: '役牌 發', chun: '役牌 中',
  ton: '役牌 東', nan: '役牌 南', shaa: '役牌 西', pei: '役牌 北',
  kokushi: '国士無双', suuankou: '四暗刻', daisangen: '大三元', tsuuiisou: '字一色',
  shousuushii: '小四喜', daisuushii: '大四喜', ryuuiisou: '緑一色', chinroutou: '清老頭',
  chuuren: '九蓮宝燈', suukantsu: '四槓子', tenhou: '天和', chiihou: '地和',
};

/** The name of a yaku key, as the engine names it; the key itself if unknown. */
export function yakuName(key: string): string {
  return findItem(key)?.name ?? BASE_NAMES[key] ?? key;
}
