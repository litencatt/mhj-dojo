package yaku

import (
	"reflect"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

func evalWith(t *testing.T, hand string, ctx Context, win string, allowed *KeySet) Win {
	t.Helper()
	wt, _ := tile.Parse(win)
	ctx.WinTile = wt.Kind
	if ctx.Winds == (Winds{}) {
		ctx.Winds = EastEast
	}
	w, ok := EvaluateWith(tile.MustParseHand(hand), ctx, allowed)
	if !ok {
		t.Fatalf("%s: not complete", hand)
	}
	return w
}

func excludedKeys(w Win) string {
	var ks []string
	for _, y := range w.Excluded {
		ks = append(ks, y.Key)
	}
	return strings.Join(ks, ",")
}

func TestEvaluateWithAllowed(t *testing.T) {
	ind := func(s string) []tile.Tile { x, _ := tile.Parse(s); return []tile.Tile{x} }
	cases := []struct {
		name, hand, win string
		ctx             Context
		allowed         *KeySet
		keys, excluded  string
		han             int
	}{
		// 234 234m 567p 55 678s on a kanchan 7s; 5p is dora
		{"iipeikou excluded", "223344m567p55678s", "7s", Context{Ron: true, DoraIndicators: ind("4p")},
			NewKeySet("tanyao"), "tanyao", "iipeikou", 2},
		// seven pairs is the shape: tanyao alone cannot win with it
		{"seven pairs not allowed", "22446688m3355p77s", "7s", Context{Ron: true},
			NewKeySet("tanyao"), "", "chiitoitsu", 0},
		// The shape's own yaku not learned: no win even on the first draw,
		// and only the yaku not learned are reported.
		{"kokushi tenhou not learned", "119m19p19s1234567z", "7z", Context{Tenhou: true},
			NewKeySet("tenhou", "tsumo"), "", "kokushi", 0},
		{"seven pairs chiihou not learned", "22446688m3355p77s", "7s", Context{Chiihou: true},
			NewKeySet("chiihou", "tsumo", "tanyao"), "", "chiitoitsu", 0},
		{"kokushi not allowed", "119m19p19s1234567z", "7z", Context{Ron: true},
			NewKeySet("tanyao"), "", "kokushi", 0},
		// 四暗刻単騎 falls back to the toitoi reading
		{"suuankou falls back to toitoi", "111444m222p333s55p", "5p", Context{Ron: true},
			NewKeySet("toitoi"), "toitoi", "sanankou,suuankou", 2},
		{"daisangen falls back to yakuhai", "555666777z123m44p", "3m", Context{Ron: true},
			NewKeySet("haku", "hatsu", "chun"), "haku,hatsu,chun", "sanankou,daisangen", 3},
		{"double riichi becomes riichi", "123m567m345p678s99s", "4p", Context{Ron: true, DoubleRiichi: true},
			NewKeySet("riichi"), "riichi", "double_riichi", 1},
		{"double riichi without riichi", "123m567m345p678s99s", "4p", Context{Ron: true, DoubleRiichi: true},
			NewKeySet("tanyao"), "", "double_riichi", 0},
		// the yakuman pack with seven pairs: 字一色 on the seven pairs shape
		{"tsuuiisou seven pairs", "11223344556677z", "7z", Context{Ron: true},
			NewKeySet("chiitoitsu", "tsuuiisou"), "tsuuiisou", "", 13},
		{"seven pairs without tsuuiisou", "11223344556677z", "7z", Context{Ron: true},
			NewKeySet("chiitoitsu"), "chiitoitsu", "honroutou,tsuuiisou", 2},
		// dora alone never win
		{"dora alone", "234m567m345p678s22s", "4p", Context{Ron: true, DoraIndicators: ind("1s")},
			NewKeySet("riichi"), "", "tanyao", 0},
		{"tsumo excluded", "123m567m345p678s99s", "4p", Context{},
			NewKeySet("pinfu"), "", "tsumo", 0},
	}
	for _, tc := range cases {
		w := evalWith(t, tc.hand, tc.ctx, tc.win, tc.allowed)
		if keys(w) != tc.keys || excludedKeys(w) != tc.excluded || w.HanTotal != tc.han {
			t.Errorf("%s: got [%s] excluded [%s] han=%d, want [%s] excluded [%s] han=%d",
				tc.name, keys(w), excludedKeys(w), w.HanTotal, tc.keys, tc.excluded, tc.han)
		}
		if w.HasYaku() != (tc.keys != "") {
			t.Errorf("%s: HasYaku = %v", tc.name, w.HasYaku())
		}
	}
}

// Allowing every key is the standard evaluation, which nil also is.
func TestEvaluateWithAllKeys(t *testing.T) {
	var all []string
	for k := range byKey {
		all = append(all, k)
	}
	all = append(all, WindKeys[:]...)
	every := NewKeySet(all...)
	for _, tc := range []struct{ hand, win string }{
		{"223344m567p55678s", "7s"}, {"22446688m3355p77s", "7s"}, {"119m19p19s1234567z", "7z"},
		{"111444m222p333s55p", "5p"}, {"555666777z123m44p", "3m"}, {"11223344556677z", "7z"},
		{"11123455678999m", "5m"}, {"223344m556677p88s", "8s"},
	} {
		for _, ctx := range []Context{{Ron: true}, {}, {Riichi: true, Ippatsu: true}, {DoubleRiichi: true, Tenhou: true}} {
			ctx.WinTile = tile.MustParseHand(tc.win)[0].Kind
			ctx.Winds = EastEast
			ts := tile.MustParseHand(tc.hand)
			want, _ := Evaluate(ts, ctx)
			for _, s := range []*KeySet{nil, every} {
				got, _ := EvaluateWith(ts, ctx, s)
				if !reflect.DeepEqual(got, want) {
					t.Errorf("%s on %s %+v: got %+v, want %+v", tc.hand, tc.win, ctx, got, want)
				}
			}
		}
	}
}

func TestKeySet(t *testing.T) {
	var none *KeySet
	if !none.Has("riichi") {
		t.Error("a nil set allows every key")
	}
	s := NewKeySet("ton")
	if !s.Has("ton") || s.Has("riichi") {
		t.Error("membership")
	}
	if !IsKey("ton") || !IsKey("kokushi") || IsKey("normal") {
		t.Error("IsKey")
	}
}
