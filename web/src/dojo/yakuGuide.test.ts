// The dojo's yaku guide (yakuGuide.ts), run by `npm test` in plain Node. That the examples are complete
// hands scoring the yaku and the seeds the best ones is checked against the engine in
// internal/session/yakuguide_test.go; this checks the data is whole and well-formed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, YAKUHAI_KEYS } from './catalog.ts';
import guideData from './yakuGuide.json' with { type: 'json' };
import { GUIDE_KEYS, expandTiles, guideFor, guideKeyOf, practiceHref } from './yakuGuide.ts';

// Yaku practice mode (discards only) cannot reproduce: no seed, no 練習 link.
const NO_PRACTICE = ['haitei', 'houtei', 'rinshan', 'chankan', 'sankantsu'];

const rawHand = (id: string) => (guideData as Record<string, { example: { hand: string } }>)[id].example.hand;
const SOLD = CATALOG.filter((it) => it.kind === 'yaku').map((it) => it.id);

test('every yaku sold in the shop has a guide, and the guide has nothing else', () => {
  assert.deepEqual([...GUIDE_KEYS].sort(), [...SOLD].sort());
  for (const id of SOLD) {
    const g = guideFor(id);
    assert.ok(g, id);
    assert.ok(g.name && g.condition && g.hanLabel, `${id}: name, condition and han`);
  }
});

test('every sold yaku has a practice seed, but the ones practice mode cannot reach', () => {
  for (const id of SOLD) {
    const g = guideFor(id)!;
    if (NO_PRACTICE.includes(id)) {
      assert.equal(g.practice, null, id);
      assert.equal(practiceHref(g), undefined, id);
    } else {
      assert.ok(g.practice && Number.isInteger(g.practice.seed) && g.practice.seed >= 1, `${id}: seed`);
      assert.equal(practiceHref(g), `?seed=${g.practice.seed}&turns=18`);
      // Practice mode cannot declare 立直: those yaku train reaching tenpai on the normal form.
      assert.equal(g.practice.row === 'normal', ['riichi', 'ippatsu', 'double_riichi'].includes(id), id);
    }
  }
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
