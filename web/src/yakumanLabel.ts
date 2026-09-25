/** "役満", "ダブル役満", "トリプル役満", then "4倍役満" … for n yakuman. */
export function yakumanName(n: number): string {
  return n === 1 ? '役満' : n === 2 ? 'ダブル役満' : n === 3 ? 'トリプル役満' : `${n}倍役満`;
}

/** A yaku's han cell: "2翻", or its yakuman count ("役満", "ダブル役満") at 13 han per yakuman. */
export function yakuHanText(han: number): string {
  return han >= 13 ? yakumanName(Math.floor(han / 13)) : `${han}翻`;
}
