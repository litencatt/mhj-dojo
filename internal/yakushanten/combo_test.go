package yakushanten

import (
	"math/rand/v2"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj2/internal/testmode"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
)

// satisfiesCombo is the oracle of a combo: the tile-set yaku hold for the
// whole hand, and with seven pairs the hand is seven pairs; otherwise one
// 4 melds + pair decomposition satisfies every other yaku.
func satisfiesCombo(keys []string, c tile.Counts) bool {
	suits, honors, yaochu, allYaochu := map[int]bool{}, false, false, true
	for k, n := range c {
		if n == 0 {
			continue
		}
		kk := tile.Kind(k)
		if kk.IsHonor() {
			honors = true
		} else {
			suits[kk.Suit()] = true
		}
		yaochu = yaochu || kk.IsYaochu()
		allYaochu = allYaochu && kk.IsYaochu()
	}
	var shape []string
	for _, k := range keys {
		switch k {
		case "tanyao", "honitsu", "chinitsu", "honroutou":
			if !map[string]bool{"tanyao": !yaochu, "honitsu": len(suits) <= 1, "chinitsu": len(suits) <= 1 && !honors, "honroutou": allYaochu}[k] {
				return false
			}
		case "chiitoitsu":
		default:
			shape = append(shape, k)
		}
	}
	if slices.Contains(keys, "chiitoitsu") {
		return len(shape) == 0 && yaku.IsChiitoitsu(c)
	}
	if !quickComplete(c) {
		return false
	}
	for _, d := range yaku.Decompose(c) {
		if !slices.ContainsFunc(shape, func(k string) bool { return !readingSatisfies(k, d) }) {
			return true
		}
	}
	return false
}

// randomComboHand returns a random complete hand of one of d's targets (or
// seven pairs from one of its kind sets); ok is false if none was found.
func randomComboHand(r *rand.Rand, d *comboDef) (tile.Counts, bool) {
	for range 10000 {
		var c tile.Counts
		if d.pairs != nil {
			m := d.pairs[r.IntN(len(d.pairs))]
			var kinds []tile.Kind
			for k := tile.Kind(0); k < tile.NumKinds; k++ {
				if m>>k&1 == 1 {
					kinds = append(kinds, k)
				}
			}
			for _, i := range r.Perm(len(kinds))[:7] {
				c[kinds[i]] += 2
			}
			return c, true
		}
		t := d.targets[r.IntN(len(d.targets))]
		type group struct {
			k    tile.Kind
			seq  bool
			pair bool
		}
		var groups, pairs []group
		for s := 0; s < 4; s++ {
			for rank := 0; rank < 9; rank++ {
				k := tile.Kind(9*s + rank)
				if k >= tile.NumKinds {
					break
				}
				c[k] += int(t.Rules[s].Forced[rank])
				if t.Rules[s].Seq>>rank&1 == 1 && rank <= 6 {
					groups = append(groups, group{k: k, seq: true})
				}
				if t.Rules[s].Trip>>rank&1 == 1 {
					groups = append(groups, group{k: k})
				}
				if t.Rules[s].Pair>>rank&1 == 1 {
					pairs = append(pairs, group{k: k, pair: true})
				}
			}
		}
		for range t.Melds {
			g := groups[r.IntN(len(groups))]
			if g.seq {
				addSeq(&c, g.k.Suit(), g.k.Num()-1, 1)
			} else {
				c[g.k] += 3
			}
		}
		c[pairs[r.IntN(len(pairs))].k] += 2
		if valid(c) {
			return c, true
		}
	}
	return tile.Counts{}, false
}

// bruteComboPinfuWaits returns the kinds t with a decomposition of H+t that
// satisfies every yaku of the combo with t on a two-sided wait.
func bruteComboPinfuWaits(keys []string, c tile.Counts) []tile.Kind {
	var out []tile.Kind
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if c[k] >= 4 {
			continue
		}
		c[k]++
		if satisfiesCombo(keys, c) {
			for _, d := range yaku.Decompose(c) {
				if slices.ContainsFunc(keys, func(y string) bool {
					return !slices.Contains([]string{"tanyao", "honitsu", "chinitsu", "honroutou"}, y) && !readingSatisfies(y, d)
				}) {
					continue
				}
				if slices.ContainsFunc(d.Melds[:], func(m yaku.Meld) bool {
					return m.Type == yaku.Seq && ((k == m.Kind && m.Kind.Num() <= 6) || (k == m.Kind+2 && m.Kind.Num() >= 2))
				}) {
					out = append(out, k)
					break
				}
			}
		}
		c[k]--
	}
	return out
}

// TestCombosMatchBruteForce compares every combo's shanten and ukeire with
// the brute-force definition on near-target and random hands; pinfu combos
// are compared on the relaxed shape and, at tenpai, on the exact waits.
func TestCombosMatchBruteForce(t *testing.T) {
	r := rand.New(rand.NewPCG(31, 32))
	a := NewAnalyzer()
	defs := combosFor(EastEast)
	if len(defs) < 100 {
		t.Fatalf("only %d combos", len(defs))
	}
	per := testmode.N(6, 2, 1)
	for i := range defs {
		d := &defs[i]
		key := strings.Join(d.keys, "+")
		for j := 0; j < per; j++ {
			w, ok := randomComboHand(r, d)
			if !ok {
				t.Fatalf("%s: no complete hand found", key)
			}
			if !satisfies(key, w) {
				t.Fatalf("%s: target hand %s does not satisfy the combo", key, w)
			}
			c := perturb(r, w)
			if (i+j)%5 == 4 {
				c = randomHand(r)
			}
			cd, ok := a.evalCombo(d, d.targets, c, &c)
			if !ok {
				t.Fatalf("%s %s: impossible", key, c)
			}
			got, gotU := cd.shanten, a.comboUkeire(&cd, c, &c)
			if d.has("pinfu") {
				rel := a.target(c, d.targets)
				got, gotU = rel.Shanten, rel.Ukeire
				if rel.Shanten == 0 {
					waits := bruteComboPinfuWaits(d.keys, c)
					want := 0
					if len(waits) == 0 {
						want = 1
					}
					if cd.shanten != want || (want == 0 && !slices.Equal(cd.waits, waits)) || cd.approx != (want == 1) {
						t.Fatalf("%s %s: exact %d approx=%v waits %v, brute waits %v", key, c, cd.shanten, cd.approx, names(cd.waits), names(waits))
					}
				}
			}
			want := bruteDist(key, c)
			if min(got+1, 3) != want {
				t.Fatalf("%s %s: shanten %d, brute dist %d", key, c, got, want)
			}
			if want <= 2 {
				if wantU := bruteUkeire(key, c, want); !slices.Equal(gotU, wantU) {
					t.Fatalf("%s %s: ukeire %v, brute %v", key, c, names(gotU), names(wantU))
				}
			}
		}
	}
}

// TestCombosPruneMatchesFull checks that the best-first search returns what
// evaluating every combo returns, for closed and open hands.
func TestCombosPruneMatchesFull(t *testing.T) {
	r := rand.New(rand.NewPCG(33, 34))
	n := testmode.N(400, 100, 30)
	for i := 0; i < n; i++ {
		a := NewAnalyzerFor([]Winds{EastEast, {Round: tile.South, Seat: tile.West}}[i%2])
		c, melds := random14(r), []yaku.Meld(nil)
		if i%3 == 2 {
			c, melds = randomOpen14(r)
		}
		for k := range c {
			if c[k] == 0 {
				continue
			}
			c[k]--
			rows := a.AnalyzeWith(c, melds)
			pruned, full := a.combos(c, melds, rows, true), a.combos(c, melds, rows, false)
			if !reflect.DeepEqual(pruned, full) {
				t.Fatalf("%s %v: pruned %+v, full %+v", c, melds, pruned, full)
			}
			if len(full) == 0 || len(full) > MaxCombos {
				t.Fatalf("%s %v: %d combos", c, melds, len(full))
			}
			c[k]++
		}
	}
}

func TestCombosHandWritten(t *testing.T) {
	a := NewAnalyzer()
	for _, tc := range []struct {
		hand, name   string
		han, shanten int
		ukeire       string
	}{
		// 234 in three suits, 23s waits on 1s/4s: only 4s keeps tanyao and sanshoku.
		{"234m234p23678s55p", "断么九＋平和＋三色同順", 4, 0, "4s"},
		// the second 123m makes iipeikou; the 6s-9s wait is two-sided.
		{"112233m456p78s99p", "平和＋一盃口", 2, 0, "6s9s"},
		// honitsu with a triplet of haku, waiting on 1m or 6z: only 6z adds hatsu.
		{"123456m11m555z66z", "混一色＋役牌 白＋役牌 發", 5, 0, "6z"},
		// six pairs of manzu and honors and a single honor.
		{"1133557799m112z", "混一色＋七対子", 5, 0, "2z"},
	} {
		c := tile.MustCounts(tc.hand)
		combos := a.Combos(c, nil, a.Analyze(c))
		i := slices.IndexFunc(combos, func(x Combo) bool { return x.Name == tc.name })
		if i < 0 {
			t.Errorf("%s: no %s in %+v", tc.hand, tc.name, combos)
			continue
		}
		got := combos[i]
		if got.Han != tc.han || got.Shanten != tc.shanten || !slices.Equal(got.Ukeire, expectedUkeire(c, tc.ukeire)) {
			t.Errorf("%s %s: got %d han %d shanten %v, want %d %d %s", tc.hand, tc.name, got.Han, got.Shanten, names(got.Ukeire), tc.han, tc.shanten, tc.ukeire)
		}
	}
}

// TestCombosOpenHand: an open meld drops the closed-only yaku and lowers the
// kuisagari ones.
func TestCombosOpenHand(t *testing.T) {
	a := NewAnalyzer()
	melds := []yaku.Meld{mustMeld(t, yaku.Trip, "6z", true, false)}
	c := tile.MustCounts("12345678m99m")
	combos := a.Combos(c, melds, a.AnalyzeWith(c, melds))
	for _, co := range combos {
		for _, k := range co.Keys {
			if needClosed[k] || needNoMelds[k] {
				t.Errorf("open hand combo %s has closed-only %s", co.Name, k)
			}
		}
	}
	i := slices.IndexFunc(combos, func(x Combo) bool { return x.Name == "一気通貫＋混一色＋役牌 發" })
	if i < 0 {
		t.Fatalf("no ittsu honitsu hatsu in %+v", combos)
	}
	if co := combos[i]; co.Han != 1+2+1 || co.Shanten != 0 || !slices.Equal(co.Ukeire, expectedUkeire(c, "9m")) {
		t.Errorf("got %+v, want 4 han tenpai on 9m", co)
	}
}

// TestComboList: combos that share groups exist, and redundant or
// impossible ones do not.
func TestComboList(t *testing.T) {
	have := map[string]bool{}
	for _, d := range combosFor(EastEast) {
		have[strings.Join(d.keys, "+")] = true
	}
	for _, key := range []string{
		"tanyao+pinfu+iipeikou+sanshoku", // iipeikou shares a sequence of sanshoku
		"pinfu+iipeikou+ittsu",           // and of ittsu
		"iipeikou+sanshoku+chanta",
		"honitsu+toitoi+ton",
		"honitsu+toitoi+shousangen",
		"tanyao+chinitsu+chiitoitsu",
		"honroutou+honitsu+chiitoitsu",
	} {
		if !have[key] {
			t.Errorf("missing combo %s", key)
		}
	}
	for _, key := range []string{
		"haku+hatsu+chun",         // daisangen
		"junchan+chinitsu+toitoi", // chinroutou
		"tanyao+honitsu",          // a chinitsu
		"shousangen+haku",         // counted with shousangen
		"chanta+junchan",
		"pinfu+toitoi",
		"tanyao+honroutou+chiitoitsu",
	} {
		if have[key] {
			t.Errorf("unexpected combo %s", key)
		}
	}
}
