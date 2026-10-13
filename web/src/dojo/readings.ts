// Readings of the mahjong terms in the curriculum's texts (lessons.ts), shown as furigana on a
// term's first use in a text (Furigana.tsx). Run by `npm test` (readings.test.ts).

/** A run of a text: plain, or a term with its reading. */
export interface Segment {
  text: string;
  reading?: string;
}

// Term → reading, longest first so that 嶺上開花 wins over 嶺上牌's 嶺上 and 門前清自摸和 over 門前.
// A term whose reading changes with how it is used (和了 as ホーラ, 和了る as あがる) lists the
// verb's forms before the noun.
const READINGS: readonly (readonly [string, string])[] = [
  ['門前清自摸和', 'メンゼンチンツモホー'],
  ['三色同順', 'サンショクドウジュン'],
  ['一気通貫', 'イッキツウカン'],
  ['嶺上開花', 'リンシャンカイホー'],
  ['嶺上牌', 'リンシャンパイ'],
  ['断么九', 'タンヤオ'],
  ['混一色', 'ホンイツ'],
  ['清一色', 'チンイツ'],
  ['一盃口', 'イーペーコー'],
  ['二盃口', 'リャンペーコー'],
  ['七対子', 'チートイツ'],
  ['対々和', 'トイトイ'],
  ['有効牌', 'ゆうこうはい'],
  ['么九牌', 'ヤオチューハイ'],
  ['聴牌', 'テンパイ'],
  ['向聴', 'シャンテン'],
  ['振聴', 'フリテン'],
  ['面子', 'メンツ'],
  ['雀頭', 'ジャントウ'],
  ['順子', 'シュンツ'],
  ['刻子', 'コーツ'],
  ['対子', 'トイツ'],
  ['両面', 'リャンメン'],
  ['嵌張', 'カンチャン'],
  ['辺張', 'ペンチャン'],
  ['単騎', 'タンキ'],
  ['双碰', 'シャンポン'],
  ['役牌', 'ヤクハイ'],
  ['場風', 'ばかぜ'],
  ['自風', 'じかぜ'],
  ['立直', 'リーチ'],
  ['門前', 'メンゼン'],
  ['平和', 'ピンフ'],
  ['現物', 'げんぶつ'],
  ['放銃', 'ホウジュウ'],
  ['打牌', 'ダハイ'],
  ['巡目', 'じゅんめ'],
  ['和了', 'ホーラ'],
  ['翻', 'ハン'],
  ['發', 'ハツ'],
];

// 和了 followed by these is the verb あがる (和了る, 和了れる, 和了り…): read あが.
const VERB_TAIL = /^[るれりろらっ]/;

/**
 * Splits text into plain runs and terms, each term with its reading on its first use only (seen
 * carries the terms already read across texts shown together, as a lesson's goal and text).
 */
export function segments(text: string, seen: Set<string> = new Set()): Segment[] {
  const out: Segment[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const hit = READINGS.find(([term]) => text.startsWith(term, i));
    if (!hit) {
      plain += text[i];
      i++;
      continue;
    }
    const [term, noun] = hit;
    const verb = term === '和了' && VERB_TAIL.test(text.slice(i + term.length));
    const key = verb ? '和了る' : term;
    if (seen.has(key)) {
      plain += term;
    } else {
      seen.add(key);
      if (plain) out.push({ text: plain });
      plain = '';
      out.push({ text: term, reading: verb ? 'あが' : noun });
    }
    i += term.length;
  }
  if (plain) out.push({ text: plain });
  return out;
}
