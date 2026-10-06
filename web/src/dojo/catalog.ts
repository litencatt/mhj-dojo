// The dojo's shop and the economy's constants. Every number that tunes the
// economy lives here; progress.ts and the tests read them from here.
//
// Economy targets (economy.test.ts checks them):
// - A game is worth about 65 XP and 50 coins: the average rank's base (XP 50,
//   coins 35) plus about 1.5 han of won hands x 10.
// - 立直 is affordable within 1-2 games: the first-game bonus alone covers it.
// - Lv10 (4500 XP) comes after about 70 games, by which time 80% or more of
//   the shop's coin cost (the yakuman pack aside) has been bought.
// - The yakuman pack costs about 30 more games after Lv10.

/** XP and coins by final rank (1st to 4th). */
export const RANK_XP = [100, 60, 30, 10] as const;
export const RANK_COINS = [60, 40, 25, 15] as const;
/** XP and coins per han of the counted yaku (dora not included). */
export const XP_PER_HAN = 10;
export const COINS_PER_HAN = 10;
/** The coins one redraw (引き直し) costs, settled at the end of the game. */
export const REDRAW_COST = 20;
/** Coins for the first finished game. */
export const FIRST_GAME_BONUS = 40;

/** The yaku a new dojo owns: 断么九, 平和, the dragons and the winds. */
export const WIND_KEYS = ['ton', 'nan', 'shaa', 'pei'] as const; // internal/yaku WindKeys
export const INITIAL_YAKU: readonly string[] = ['tanyao', 'pinfu', 'haku', 'hatsu', 'chun', ...WIND_KEYS];

/** The yakuman an owned 役満パック grants: all of them. */
export const YAKUMAN_KEYS: readonly string[] = [
  'kokushi', 'suuankou', 'daisangen', 'tsuuiisou', 'shousuushii', 'daisuushii',
  'ryuuiisou', 'chinroutou', 'chuuren', 'suukantsu', 'tenhou', 'chiihou',
];

export const YAKUMAN_PACK = 'yakuman-pack';
export const DEFAULT_THEME = 'default';

export type ItemKind = 'yaku' | 'theme' | 'assist' | 'cheat' | 'pack';

export interface ShopItem {
  /** A yaku's key, or 'theme:*', 'assist:*', 'cheat:*', 'yakuman-pack'. */
  id: string;
  kind: ItemKind;
  name: string;
  price: number;
  level: number;
  /** Ids (a yaku key or an item id) that must be owned first. */
  requires?: string[];
  /** The yaku keys an owned item adds: the item's own key, or the pack's yakuman. */
  grants?: readonly string[];
}

function yaku(id: string, name: string, level: number, price: number, requires?: string[]): ShopItem {
  return { id, kind: 'yaku', name, price, level, requires, grants: [id] };
}

export const CATALOG: readonly ShopItem[] = [
  yaku('riichi', '立直', 1, 40),
  yaku('tsumo', '門前清自摸和', 1, 40),
  yaku('iipeikou', '一盃口', 1, 40),

  yaku('ippatsu', '一発', 2, 30, ['riichi']),
  yaku('haitei', '海底摸月', 2, 30),
  yaku('houtei', '河底撈魚', 2, 30),
  yaku('rinshan', '嶺上開花', 2, 30),
  yaku('chankan', '槍槓', 2, 30),
  { id: 'theme:wafuu', kind: 'theme', name: '牌テーマ: 和風', price: 50, level: 2 },
  { id: 'theme:mono', kind: 'theme', name: '牌テーマ: モノクロ', price: 50, level: 2 },
  { id: 'assist:shanten', kind: 'assist', name: '補助: 役別向聴パネル', price: 60, level: 2 },

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

  { id: 'assist:advice', kind: 'assist', name: '補助: アドバイスパネル', price: 120, level: 4 },
  { id: 'assist:danger', kind: 'assist', name: '補助: 危険牌の印', price: 120, level: 4 },
  { id: 'theme:yonshoku', kind: 'theme', name: '牌テーマ: 四色牌', price: 100, level: 4 },

  yaku('honitsu', '混一色', 5, 200),
  yaku('junchan', '純全帯么九', 5, 200),
  yaku('ryanpeikou', '二盃口', 5, 200),

  yaku('chinitsu', '清一色', 7, 400),

  { id: 'cheat:peek', kind: 'cheat', name: 'イカサマ: 透視', price: 600, level: 8 },
  { id: 'cheat:redraw', kind: 'cheat', name: 'イカサマ: 引き直し', price: 400, level: 8 },

  // 七対子 first: a 字一色 seven pairs would be thrown out with its 七対子 reading.
  { id: YAKUMAN_PACK, kind: 'pack', name: '役満パック', price: 1500, level: 10, requires: ['chiitoitsu'], grants: YAKUMAN_KEYS },
];

export function findItem(id: string): ShopItem | undefined {
  return CATALOG.find((it) => it.id === id);
}

const BASE_NAMES: Record<string, string> = {
  tanyao: '断么九', pinfu: '平和', haku: '役牌 白', hatsu: '役牌 發', chun: '役牌 中',
  ton: '役牌 東', nan: '役牌 南', shaa: '役牌 西', pei: '役牌 北',
  kokushi: '国士無双', suuankou: '四暗刻', daisangen: '大三元', tsuuiisou: '字一色',
  shousuushii: '小四喜', daisuushii: '大四喜', ryuuiisou: '緑一色', chinroutou: '清老頭',
  chuuren: '九蓮宝燈', suukantsu: '四槓子', tenhou: '天和', chiihou: '地和',
};

/** The name of a yaku key, as the engine names it; the key itself if unknown. */
export function yakuName(key: string): string {
  return findItem(key)?.name ?? BASE_NAMES[key] ?? key;
}
