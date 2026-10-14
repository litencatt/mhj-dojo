// The dojo's yaku guide (yakuGuide.ts), run by `npm test` in plain Node. That the examples are complete
// hands scoring the yaku and that each seed allows the yaku is checked against the engine in
// internal/session/yakuguide_test.go; this checks the data is whole and well-formed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, INITIAL_YAKU, YAKUHAI_KEYS } from './catalog.ts';
import guideData from './yakuGuide.json' with { type: 'json' };
import { GUIDE_KEYS, expandTiles, guideFor, guideKeyOf, practiceHref } from './yakuGuide.ts';

// Yaku practice mode (discards and tsumo only) cannot reproduce: no seed, no 練習 link. 対々和 needs
// a call there: four concealed triplets won by tsumo are 四暗刻.
const NO_PRACTICE = ['haitei', 'houtei', 'rinshan', 'chankan', 'sankantsu', 'toitoi'];

const rawHand = (id: string) => (guideData as Record<string, { example: { hand: string } }>)[id].example.hand;
// The initial yaku with a guide: 立直 kept the one it had when it was sold (#321), so its chip in
// 習得役 still opens it. 断么九 and 門前清自摸和 never had one. Listed by hand on purpose: a guide
// for an initial yaku is a choice, and this is where it is made.
const GUIDED_INITIAL = ['riichi'];
const SOLD = [...CATALOG.filter((it) => it.kind === 'yaku').map((it) => it.id), ...GUIDED_INITIAL];

test('every yaku sold in the shop (and the guided initial ones) has a guide, and the guide has nothing else', () => {
  for (const k of GUIDED_INITIAL) assert.ok(INITIAL_YAKU.includes(k), k);
  assert.deepEqual([...GUIDE_KEYS].sort(), [...SOLD].sort());
  for (const id of SOLD) {
    const g = guideFor(id);
    assert.ok(g, id);
    assert.ok(g.name && g.condition && g.hanLabel, `${id}: name, condition and han`);
  }
});

test('every sold yaku has practice seeds, but the ones practice mode cannot reach', () => {
  for (const id of SOLD) {
    const g = guideFor(id)!;
    if (NO_PRACTICE.includes(id)) {
      assert.equal(g.practice, null, id);
      assert.equal(practiceHref(g), undefined, id);
    } else {
      assert.ok(g.practice, id);
      const { seeds, goal } = g.practice;
      assert.ok(seeds.length >= 3, `${id}: several seeds`);
      assert.ok(seeds.every((s) => Number.isInteger(s) && s >= 1), `${id}: seeds`);
      assert.equal(new Set(seeds).size, seeds.length, `${id}: distinct seeds`);
      // Practice mode cannot declare 立直: those yaku train reaching tenpai on the normal form.
      assert.equal(goal, ['riichi', 'ippatsu', 'double_riichi'].includes(id) ? 'tenpai' : 'win', id);
    }
  }
});

test('the practice link picks one of the seeds at random', () => {
  const g = guideFor('iipeikou')!;
  const seeds = g.practice!.seeds;
  assert.equal(practiceHref(g, () => 0), `?seed=${seeds[0]}&turns=18`);
  assert.equal(practiceHref(g, () => 0.999999), `?seed=${seeds[seeds.length - 1]}&turns=18`);
  assert.equal(practiceHref(g, () => 1), `?seed=${seeds[seeds.length - 1]}&turns=18`); // never past the end
  const hrefs = new Set(seeds.map((_, i) => practiceHref(g, () => (i + 0.5) / seeds.length)));
  assert.equal(hrefs.size, seeds.length, 'every seed can be picked');
  assert.match(practiceHref(g)!, /^\?seed=\d+&turns=18$/);
});

test('an example hand has the tiles of a winning hand', () => {
  for (const id of SOLD) {
    const g = guideFor(id)!;
    const { hand, melds, win } = g.example;
    // guideFor drops the winning tile from the hand; it must have been there.
    assert.ok(expandTiles(rawHand(id)).includes(win), `${id}: the hand holds its winning tile`);
    assert.equal(hand.length + 1, 14 - 3 * melds.length, `${id}: concealed tiles`);
    for (const m of melds) assert.deepEqual(new Set(m).size, 1, `${id}: a kan is four of a kind`);
    assert.ok(expandTiles(win).length === 1, `${id}: one winning tile`);
  }
});

test('the dragons and the winds share the 役牌 guide', () => {
  for (const k of YAKUHAI_KEYS) assert.equal(guideKeyOf(k), 'yakuhai');
  assert.equal(guideFor('haku')?.key, 'yakuhai');
  assert.equal(guideFor('yakuhai')?.name, '役牌');
  assert.equal(guideKeyOf('riichi'), 'riichi');
  assert.equal(guideFor('tanyao'), undefined);
  assert.equal(guideFor('yakuman-pack'), undefined);
});

test('han labels say what an open hand scores', () => {
  assert.equal(guideFor('riichi')!.hanLabel, '1翻（門前限定）');
  assert.equal(guideFor('sanshoku')!.hanLabel, '2翻（鳴くと1翻）');
  assert.equal(guideFor('toitoi')!.hanLabel, '2翻（鳴いても同じ）');
});

test('expandTiles reads compact notation', () => {
  assert.deepEqual(expandTiles('123m55z'), ['1m', '2m', '3m', '5z', '5z']);
  assert.deepEqual(expandTiles('2222p'), ['2p', '2p', '2p', '2p']);
});
