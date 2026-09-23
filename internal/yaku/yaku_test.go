package yaku

import (
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
)

func east() Context {
	return Context{RoundWind: tile.East, SeatWind: tile.East}
}

func TestDecompose(t *testing.T) {
	cases := map[string]int{
		"11122233344455m":   4, // 55 + {1111..: 3 ways}, or 22 + 111 234 345 345
		"111222333m44455p":  2, // 111 222 333 or 123 x3
		"11122233344m55p9s": 0,
		"111222333m123p55s": 2, // 111 222 333 or 123 x3
		"11223344556677m":   3, // pair 11, 44 or 77
		"12345678999m123p":  1,
	}
	for hand, want := range cases {
		c := tile.MustCounts(hand)
		if got := len(Decompose(c)); got != want {
			t.Errorf("Decompose(%s) = %d readings, want %d", hand, got, want)
		}
	}
	if !IsChiitoitsu(tile.MustCounts("11223344556677m")) || IsChiitoitsu(tile.MustCounts("11112233445566m")) {
		t.Error("chiitoitsu detection")
	}
	if !IsKokushi(tile.MustCounts("119m19p19s1234567z")) || IsKokushi(tile.MustCounts("19m19p19s1234567z5m")) {
		t.Error("kokushi detection")
	}
}

func keys(w Win) string {
	var ks []string
	for _, y := range w.Yaku {
		ks = append(ks, y.Key)
	}
	return strings.Join(ks, ",")
}

func TestEvaluate(t *testing.T) {
	cases := []struct {
		hand, win, dora string // dora = indicator
		keys            string
		doraCount, han  int
	}{
		// ryanmen win on 4m (23m wait): pinfu tanyao tsumo
		{"234m567m345p678s22s", "4m", "1z", "tsumo,tanyao,pinfu", 0, 3},
		// 4p only completes 3_5p (kanchan): no pinfu
		{"234m567m345p678s22s", "4p", "1z", "tsumo,tanyao", 0, 2},
		// 3m completes 12_m (penchan): no pinfu
		{"123m567m345p678s22s", "3m", "1z", "tsumo", 0, 1},
		// 1m completes _23m (ryanmen)
		{"123m567m345p678s22s", "1m", "1z", "tsumo,pinfu", 0, 2},
		// a value pair (東) blocks pinfu
		{"234m567m345p678s11z", "4m", "1z", "tsumo", 0, 1},
		{"223344m567p678s55s", "2m", "7z", "tsumo,tanyao,pinfu,iipeikou", 0, 4},
		{"123m123p123s789s99p", "1m", "5z", "tsumo,pinfu,sanshoku,junchan", 0, 7},
		{"123456789m234p55s", "9m", "5z", "tsumo,pinfu,ittsu", 0, 4},
		{"123m789m123p789s11z", "3m", "5z", "tsumo,chanta", 0, 3},
		// 9m tanki: no pinfu
		{"123m123p123s789s99m", "9m", "5z", "tsumo,sanshoku,junchan", 0, 6},
		{"123456m777m555z22z", "2z", "5z", "tsumo,honitsu,haku", 0, 5},
		// four concealed triplets are reported as sanankou (suuankou is out of scope)
		{"111m222p333s666z55z", "5z", "3z", "tsumo,toitoi,sanankou,hatsu", 0, 6},
		{"111m222p333s666z55z", "5z", "5z", "tsumo,toitoi,sanankou,hatsu", 3, 9},
		// double east
		{"111z234m567p789s55m", "5m", "5z", "tsumo,ton", 0, 3},
		// indicator 1m -> dora 2m (a pair)
		{"22m44m66p88p33s55s77s", "7s", "1m", "tsumo,tanyao,chiitoitsu", 2, 6},
		{"119m19p19s1234567z", "1m", "1m", "kokushi", 0, 13},
		// red five counts as dora
		{"234m067p345s678s55s", "2m", "1z", "tsumo,tanyao,pinfu", 1, 4},
		// indicator 9s -> dora 1s; honors wrap 北 -> 東
		{"111s234m567p789p55m", "5m", "9s", "tsumo", 3, 4},
		{"111z234m567p789s55m", "5m", "4z", "tsumo,ton", 3, 6},
		{"11123455678999m", "4m", "5z", "tsumo,chinitsu", 0, 7},
	}
	for _, tc := range cases {
		ts := tile.MustParseHand(tc.hand)
		if len(ts) != 14 {
			t.Fatalf("fixture %s has %d tiles", tc.hand, len(ts))
		}
		wt, _ := tile.Parse(tc.win)
		ind, _ := tile.Parse(tc.dora)
		ctx := east()
		ctx.WinTile = wt.Kind
		ctx.DoraIndicators = []tile.Tile{ind}
		w, ok := Evaluate(ts, ctx)
		if !ok {
			t.Errorf("%s: not complete", tc.hand)
			continue
		}
		if keys(w) != tc.keys || w.Dora != tc.doraCount || w.HanTotal != tc.han {
			t.Errorf("%s win %s: got [%s] dora=%d han=%d, want [%s] dora=%d han=%d",
				tc.hand, tc.win, keys(w), w.Dora, w.HanTotal, tc.keys, tc.doraCount, tc.han)
		}
	}
	if _, ok := Evaluate(tile.MustParseHand("123m456m789m123p45s"), east()); ok {
		t.Error("incomplete hand evaluated")
	}
}

func TestChinitsuNotHonitsu(t *testing.T) {
	// Only reading: 11 + 123 456 789 999 (ittsu + chinitsu; the 999 triplet rules out pinfu).
	ts := tile.MustParseHand("11123456789999m")
	ctx := east()
	ctx.WinTile = tile.MakeKind(tile.Man, 1)
	w, ok := Evaluate(ts, ctx)
	if !ok {
		t.Fatal("not complete")
	}
	if keys(w) != "tsumo,ittsu,chinitsu" || w.HanTotal != 9 {
		t.Fatalf("got [%s] han=%d", keys(w), w.HanTotal)
	}
	if slices.ContainsFunc(w.Yaku, func(y Yaku) bool { return y.Key == "honitsu" }) {
		t.Fatal("chinitsu hand must not also be honitsu")
	}
}

func TestBestReadingByHan(t *testing.T) {
	// Winning on 3m: chiitoitsu (tsumo tanyao chinitsu chiitoitsu) and
	// 22 + 345x2 + 678x2 (tsumo tanyao pinfu iipeikou chinitsu) both give 10 han.
	ts := tile.MustParseHand("22334455667788m")
	ctx := east()
	ctx.WinTile = tile.MakeKind(tile.Man, 3)
	w, ok := Evaluate(ts, ctx)
	if !ok || w.HanTotal != 10 {
		t.Fatalf("got [%s] han=%d", keys(w), w.HanTotal)
	}
	// Sanankou reading beats the sequence reading: 111222333m + 789p + 55s.
	ts = tile.MustParseHand("111222333m789p55s")
	ctx.WinTile = tile.MakeKind(tile.Sou, 5)
	w, _ = Evaluate(ts, ctx)
	if keys(w) != "tsumo,sanankou" {
		t.Fatalf("got [%s]", keys(w))
	}
}

// Yakuman: dora is reported but does not add to han_total.
func TestKokushiDoraNotAdded(t *testing.T) {
	ind, _ := tile.Parse("9s")
	ctx := east()
	ctx.WinTile = tile.MakeKind(tile.Man, 1)
	ctx.DoraIndicators = []tile.Tile{ind}
	w, ok := Evaluate(tile.MustParseHand("119m19p19s1234567z"), ctx)
	if !ok || keys(w) != "kokushi" || w.Dora != 1 || w.HanTotal != 13 {
		t.Fatalf("got [%s] dora=%d han=%d", keys(w), w.Dora, w.HanTotal)
	}
}
