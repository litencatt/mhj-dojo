package yaku

import (
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
)

func TestFu(t *testing.T) {
	cases := []struct {
		name, hand, win string
		ron             bool
		seat            tile.Kind // round wind is East
		fu              int
	}{
		{"pinfu tsumo", "234m567m345p678s22s", "4m", false, tile.East, 20},
		{"pinfu ron", "234m567m345p678s22s", "4m", true, tile.East, 30},
		{"kanchan tsumo", "234m567m345p678s22s", "4p", false, tile.East, 30},
		{"kanchan ron", "234m567m345p678s22s", "4p", true, tile.East, 40},
		{"penchan ron", "123m567m345p678s22s", "3m", true, tile.East, 40},
		{"tanki tsumo", "123m123p123s789s99m", "9m", false, tile.East, 30},
		{"double wind pair ron", "234m567m345p678s11z", "4m", true, tile.East, 40},
		{"dragon pair ron", "234m567m345p678s55z", "4m", true, tile.East, 40},
		{"seat wind pair ron", "234m567m345p678s22z", "4m", true, tile.South, 40},
		{"guest wind pair is pinfu", "234m567m345p678s22z", "4m", true, tile.East, 30},
		{"concealed terminal triplet tsumo", "111m234p567p789s22s", "4p", false, tile.East, 30},
		{"concealed terminal triplet ron", "111m234p567p789s22s", "4p", true, tile.East, 40},
		{"ron completes terminal triplet", "111m234p567p789s22s", "1m", true, tile.East, 40},
		{"tsumo completes terminal triplet", "111m234p567p789s22s", "1m", false, tile.East, 30},
		{"concealed simple triplet tsumo", "555m234p567p789s22s", "2p", false, tile.East, 30},
		{"ron completes simple triplet", "555m234p567p789s22s", "5m", true, tile.East, 40},
		{"honor triplet + tanki tsumo", "111z234m567p789s55m", "5m", false, tile.East, 40},
		{"two terminal triplets + kanchan", "111m999p123s456s77s", "2s", false, tile.East, 40},
		{"four triplets ron on one", "111m222p333s666z55z", "1m", true, tile.East, 60},
		{"four concealed triplets tanki tsumo", "111m222p333s666z55z", "5z", false, tile.East, 50},
	}
	for _, tc := range cases {
		wt, _ := tile.Parse(tc.win)
		ctx := Context{WinTile: wt.Kind, Ron: tc.ron, Winds: Winds{tile.East, tc.seat}}
		best := 0
		for _, r := range Readings(tile.MustCounts(tc.hand), wt.Kind) {
			best = max(best, Fu(r, ctx))
		}
		if best != tc.fu {
			t.Errorf("%s: %s on %s: fu %d, want %d", tc.name, tc.hand, tc.win, best, tc.fu)
		}
	}
}

func eval(t *testing.T, hand string, ctx Context, win string) Win {
	t.Helper()
	wt, _ := tile.Parse(win)
	ctx.WinTile = wt.Kind
	if ctx.Winds == (Winds{}) {
		ctx.Winds = EastEast
	}
	w, ok := Evaluate(tile.MustParseHand(hand), ctx)
	if !ok {
		t.Fatalf("%s: not complete", hand)
	}
	return w
}

func TestEvaluateRonAndRiichi(t *testing.T) {
	ind := func(s string) []tile.Tile { x, _ := tile.Parse(s); return []tile.Tile{x} }
	cases := []struct {
		name, hand, win string
		ctx             Context
		keys            string
		ura, han, fu    int
	}{
		{"ron has no tsumo", "234m567m345p678s22s", "4m", Context{Ron: true}, "tanyao,pinfu", 0, 2, 30},
		{"riichi ippatsu ura", "234m567m345p678s22s", "4m",
			Context{Ron: true, Riichi: true, Ippatsu: true, UraIndicators: ind("1m")}, "riichi,ippatsu,tanyao,pinfu", 1, 5, 30},
		{"no ura without riichi", "234m567m345p678s22s", "4m",
			Context{Ron: true, UraIndicators: ind("1m")}, "tanyao,pinfu", 0, 2, 30},
		{"ippatsu needs riichi", "234m567m345p678s22s", "4m", Context{Ippatsu: true}, "tsumo,tanyao,pinfu", 0, 3, 20},
		{"double riichi", "234m567m345p678s22s", "4m", Context{DoubleRiichi: true}, "double_riichi,tsumo,tanyao,pinfu", 0, 5, 20},
		{"haitei", "234m567m345p678s22s", "4m", Context{Haitei: true}, "tsumo,haitei,tanyao,pinfu", 0, 4, 20},
		{"houtei", "234m567m345p678s22s", "4m", Context{Ron: true, Houtei: true}, "houtei,tanyao,pinfu", 0, 3, 30},
		{"haitei is tsumo only", "234m567m345p678s22s", "4m", Context{Ron: true, Haitei: true}, "tanyao,pinfu", 0, 2, 30},
		// ron on a shanpon triplet breaks suuankou into toitoi + sanankou
		{"ron breaks suuankou", "111m222p333s666z55z", "1m", Context{Ron: true}, "toitoi,sanankou,hatsu", 0, 5, 60},
		{"tanki ron keeps suuankou", "111m222p333s666z55z", "5z", Context{Ron: true}, "suuankou", 0, 13, 0},
		// three triplets, ron completes one: only two concealed
		{"ron shanpon has no sanankou", "111m999p555s234m77s", "1m", Context{Ron: true}, "", 0, 0, 50},
		{"tsumo shanpon has sanankou", "111m999p555s234m77s", "1m", Context{}, "tsumo,sanankou", 0, 3, 50},
		// same han, the tanki reading (40 fu) beats the ryanmen one (30 fu)
		{"more fu wins a tie", "11123m456p789s999s", "1m", Context{}, "tsumo", 0, 1, 40},
		{"seven pairs fu", "22m44m66p88p33s55s77s", "7s", Context{Ron: true}, "tanyao,chiitoitsu", 0, 3, 25},
	}
	for _, tc := range cases {
		w := eval(t, tc.hand, tc.ctx, tc.win)
		if keys(w) != tc.keys || w.UraDora != tc.ura || w.HanTotal != tc.han || w.Fu != tc.fu {
			t.Errorf("%s: got [%s] ura=%d han=%d fu=%d, want [%s] ura=%d han=%d fu=%d",
				tc.name, keys(w), w.UraDora, w.HanTotal, w.Fu, tc.keys, tc.ura, tc.han, tc.fu)
		}
	}
}

func TestNoYakuWin(t *testing.T) {
	// penchan ron with terminals: complete, but no yaku; dora does not help
	x, _ := tile.Parse("2m")
	w := eval(t, "123m567m345p789s99s", Context{Ron: true, DoraIndicators: []tile.Tile{x}}, "3m")
	if w.HasYaku() || w.HanTotal != 0 || w.Dora != 1 {
		t.Fatalf("got [%s] han=%d dora=%d", keys(w), w.HanTotal, w.Dora)
	}
	if w.Reading == nil || w.Reading.Wait != Penchan {
		t.Fatalf("reading = %+v", w.Reading)
	}
}
