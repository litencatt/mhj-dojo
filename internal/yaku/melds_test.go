package yaku

import (
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
)

func kind(s string) tile.Kind {
	t, _ := tile.Parse(s)
	return t.Kind
}

// pon, chii, minkan and ankan build called melds.
func pon(s string) Meld    { return Meld{Type: Trip, Kind: kind(s), Open: true} }
func chii(s string) Meld   { return Meld{Type: Seq, Kind: kind(s), Open: true} }
func minkan(s string) Meld { return Meld{Type: Trip, Kind: kind(s), Open: true, Kan: true} }
func ankan(s string) Meld  { return Meld{Type: Trip, Kind: kind(s), Kan: true} }

func TestEvaluateWithMelds(t *testing.T) {
	cases := []struct {
		name, hand, win string
		melds           []Meld
		ron             bool
		keys            string
		han, fu         int
	}{
		// open tanyao (kuitan); no closed ron fu; 20 + open simple pon 2 -> 30
		{"kuitan ron", "234m567m34s66s5s", "5s", []Meld{pon("8p")}, true, "tanyao", 1, 30},
		// no 門前清自摸和 when open; 22 -> 30
		{"open tsumo", "234m567m34s66s5s", "5s", []Meld{pon("8p")}, false, "tanyao", 1, 30},
		// open pinfu shape: no pinfu, 20 fu becomes 30
		{"open pinfu shape ron", "567m234s78s55m6s", "6s", []Meld{chii("2p")}, true, "tanyao", 1, 30},
		// kuisagari: honitsu 3->2, ittsu 2->1; the East pon is a double wind (2)
		{"kuisagari", "123m456m789m5m5m", "5m", []Meld{pon("1z")}, true, "ittsu,honitsu,ton", 5, 30},
		// an ankan keeps the hand closed: 門前清自摸和; 20+2 tsumo +2 tanki +4 double wind pair +32 ankan 9s -> 60
		{"ankan closed tsumo", "123m456m789p1z1z", "1z", []Meld{ankan("9s")}, false, "tsumo", 1, 60},
		// ankan counts toward sanankou; 20+2+2 tanki+2 chun pair+32+4+4 = 66 -> 70
		{"ankan sanankou", "222p333s456m7z7z", "7z", []Meld{ankan("1m")}, false, "tsumo,sanankou", 3, 70},
		// minkan: open, 16 fu for a terminal
		{"minkan fu", "234m567m34s66s5s", "5s", []Meld{minkan("9p")}, true, "tanyao", 0, 0},
		// a pon does not count toward sanankou and the open hand has no yaku here
		{"pon breaks sanankou", "222p333s456m7z7z", "7z", []Meld{pon("1m")}, false, "", 0, 40},
		// open iipeikou does not count; open sanshoku 1 + open junchan 2
		{"open sanshoku no iipeikou", "123m123m123s99s", "9s", []Meld{chii("1p")}, true, "sanshoku,junchan", 3, 30},
		// open chanta 1, junchan 2
		{"open chanta", "123m789m11s111z", "1z", []Meld{chii("7p")}, true, "chanta,ton", 3, 30},
		{"open junchan", "123m789m11s99p9p", "9p", []Meld{chii("7p")}, true, "junchan", 2, 30},
		// chinitsu 6->5
		{"open chinitsu", "123m456m789m55m", "5m", []Meld{chii("1m")}, true, "ittsu,chinitsu", 6, 30},
		// toitoi counts called triplets; 20 + tanki 2 + chun pair 2 + 4 + 4 + pon 4 + 4 = 40
		{"toitoi with pon", "222p333s77z", "7z", []Meld{pon("1m"), pon("9m")}, true, "toitoi", 2, 40},
	}
	for _, tc := range cases {
		ctx := east()
		ctx.WinTile = kind(tc.win)
		ctx.Ron = tc.ron
		ctx.Melds = tc.melds
		w, ok := Evaluate(tile.MustParseHand(tc.hand), ctx)
		if !ok {
			t.Errorf("%s: not complete", tc.name)
			continue
		}
		if tc.name == "minkan fu" {
			// tanyao is broken by the terminal kan; check the fu alone:
			// 20 + open terminal kan 16 = 36 -> 40
			if w.HasYaku() || w.Fu != 40 {
				t.Errorf("%s: got [%s] fu=%d", tc.name, keys(w), w.Fu)
			}
			continue
		}
		if keys(w) != tc.keys || w.HanTotal != tc.han || w.Fu != tc.fu {
			t.Errorf("%s: got [%s] han=%d fu=%d, want [%s] han=%d fu=%d",
				tc.name, keys(w), w.HanTotal, w.Fu, tc.keys, tc.han, tc.fu)
		}
	}
}

func TestMeldTilesCountForDora(t *testing.T) {
	ctx := east()
	ctx.WinTile = kind("5s")
	ctx.Ron = true
	ctx.Melds = []Meld{pon("5p")}
	ctx.MeldTiles = tile.MustParseHand("055p") // one red five
	ctx.DoraIndicators = []tile.Tile{{Kind: kind("4p")}}
	w, ok := Evaluate(tile.MustParseHand("234m567m34s66s5s"), ctx)
	if !ok || w.Dora != 4 { // red 1 + three 5p
		t.Fatalf("dora %d", w.Dora)
	}
}

func TestCompleteWithMelds(t *testing.T) {
	if !IsCompleteWith(tile.MustCounts("234m567m345s66s"), []Meld{pon("8p")}) {
		t.Error("11 tiles + pon not complete")
	}
	if IsCompleteWith(tile.MustCounts("234m567m345s66s"), nil) {
		t.Error("11 tiles complete without melds")
	}
	if IsCompleteWith(tile.MustCounts("11223344556677m"), []Meld{pon("8p")}) {
		t.Error("seven pairs with a meld")
	}
}

func TestKanAndReplacementYaku(t *testing.T) {
	cases := []struct {
		name, hand, win string
		melds           []Meld
		ctx             Context
		keys            string
	}{
		{"rinshan", "234m567m34s66s5s", "5s", []Meld{minkan("8p")}, Context{Rinshan: true}, "rinshan,tanyao"},
		{"rinshan is tsumo only", "234m567m34s66s5s", "5s", []Meld{minkan("8p")}, Context{Ron: true, Rinshan: true}, "tanyao"},
		{"chankan", "234m567m34s66s5s", "5s", []Meld{pon("8p")}, Context{Ron: true, Chankan: true}, "chankan,tanyao"},
		{"sankantsu", "234m5s5s", "5s", []Meld{ankan("8p"), minkan("2s"), minkan("7m")}, Context{Ron: true}, "tanyao,sankantsu"},
		{"suukantsu", "5s5s", "5s", []Meld{ankan("8p"), minkan("2s"), minkan("7m"), minkan("1z")}, Context{Ron: true}, "suukantsu"},
	}
	for _, tc := range cases {
		ctx := tc.ctx
		ctx.Winds = EastEast
		ctx.WinTile = kind(tc.win)
		ctx.Melds = tc.melds
		w, ok := Evaluate(tile.MustParseHand(tc.hand), ctx)
		if !ok || keys(w) != tc.keys {
			t.Errorf("%s: got [%s] ok=%v, want [%s]", tc.name, keys(w), ok, tc.keys)
		}
	}
}

// HanOpenFor must agree with the han the evaluator scores in open wins.
func TestHanOpenForMatchesEvaluate(t *testing.T) {
	for _, tc := range []struct {
		hand, win string
		melds     []Meld
	}{
		{"123m456m789m5m5m", "5m", []Meld{pon("1z")}},       // ittsu, honitsu, ton
		{"123m123m123s99s", "9s", []Meld{chii("1p")}},       // sanshoku, junchan
		{"123m789m11s111z", "1z", []Meld{chii("7p")}},       // chanta
		{"123m456m789m55m", "5m", []Meld{chii("1m")}},       // chinitsu
		{"234m567m34s66s5s", "5s", []Meld{pon("8p")}},       // tanyao
		{"222p333s77z", "7z", []Meld{pon("1m"), pon("9m")}}, // toitoi
		{"123p789s77z", "7z", []Meld{pon("5z"), pon("6z")}}, // shousangen, haku, hatsu
	} {
		ctx := east()
		ctx.WinTile = kind(tc.win)
		ctx.Ron = true
		ctx.Melds = tc.melds
		w, ok := Evaluate(tile.MustParseHand(tc.hand), ctx)
		if !ok || !w.HasYaku() {
			t.Fatalf("%s: no win", tc.hand)
		}
		for _, y := range w.Yaku {
			if got := HanOpenFor(y.Key, EastEast, true); got != y.Han {
				t.Errorf("%s: %s han %d, HanOpenFor %d", tc.hand, y.Key, y.Han, got)
			}
		}
	}
	for _, key := range []string{"pinfu", "iipeikou", "riichi", "tsumo", "suuankou"} {
		if got := HanOpenFor(key, EastEast, true); got != 0 {
			t.Errorf("%s: open han %d, want 0", key, got)
		}
	}
	if HanOpenFor("chinitsu", EastEast, false) != 6 || HanOpenFor("ton", EastEast, true) != 2 {
		t.Error("closed or value-wind han changed")
	}
}
