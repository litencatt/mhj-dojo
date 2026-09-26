package yaku

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Rules audit for the yaku and fu evaluation (the round flow is audited in
// the game package).

// Wind values follow the round and the seat: value pairs block pinfu and give
// 2 fu each; a guest wind pair is pinfu; wind triplets score 1 han each way.
func TestAuditWindValuesFollowTheSeat(t *testing.T) {
	south := Winds{Round: tile.East, Seat: tile.South}
	cases := []struct {
		name, hand, win string
		winds           Winds
		keys            string
		han, fu         int
	}{
		{"round wind pair blocks pinfu", "234m567m345p678s11z", "4m", south, "", 0, 40},
		{"seat wind pair blocks pinfu", "234m567m345p678s22z", "4m", south, "", 0, 40},
		{"guest wind pair is pinfu", "234m567m345p678s33z", "4m", south, "pinfu", 1, 30},
		{"round wind triplet", "111z234m567p789s55m", "5m", south, "ton", 1, 40},
		{"seat wind triplet", "222z234m567p789s55m", "5m", south, "nan", 1, 40},
		{"guest wind triplet", "333z234m567p789s55m", "5m", south, "", 0, 40},
		{"double wind triplet", "111z234m567p789s55m", "5m", EastEast, "ton", 2, 40},
	}
	for _, tc := range cases {
		w := eval(t, tc.hand, Context{Winds: tc.winds, Ron: true}, tc.win)
		if keys(w) != tc.keys || w.HanTotal != tc.han || w.Fu != tc.fu {
			t.Errorf("%s: got [%s] han=%d fu=%d, want [%s] han=%d fu=%d", tc.name, keys(w), w.HanTotal, w.Fu, tc.keys, tc.han, tc.fu)
		}
	}
}

// Fu details: a double wind pair is 4 fu (house rule: some rules give 2) and
// seven pairs stays 25 on a tsumo.
func TestAuditFuDetails(t *testing.T) {
	cases := []struct {
		name, hand, win string
		keys            string
		fu              int
	}{
		// 20 + tsumo 2 + kanchan 2 + concealed 555m 4 + double wind pair 4 = 32 -> 40 (30 with a 2-fu pair)
		{"double wind pair is 4 fu", "555m234p678s456s11z", "5s", "tsumo", 40},
		{"seven pairs tsumo", "22m44m66p88p33s55s77s", "7s", "tsumo,tanyao,chiitoitsu", 25},
	}
	for _, tc := range cases {
		w := eval(t, tc.hand, Context{}, tc.win)
		if keys(w) != tc.keys || w.Fu != tc.fu {
			t.Errorf("%s: got [%s] fu=%d, want [%s] fu=%d", tc.name, keys(w), w.Fu, tc.keys, tc.fu)
		}
	}
}

// Yakuman details: 緑一色 without 發 (closed and open), 四槓子 stacked with
// 四暗刻単騎, and no 九蓮宝燈 once a kan is declared.
func TestAuditYakumanDetails(t *testing.T) {
	cases := []struct {
		name, hand, win string
		melds           []Meld
		keys            string
		han             int
	}{
		{"ryuuiisou without hatsu", "222s333s444s666s88s", "8s", nil, "suuankou,ryuuiisou", 39},
		{"ryuuiisou open", "234s666s88s", "8s", []Meld{chii("2s"), pon("6z")}, "ryuuiisou", 13},
		{"suukantsu with suuankou tanki", "5s5s", "5s", []Meld{ankan("1m"), ankan("9p"), ankan("3s"), ankan("7z")}, "suuankou,suukantsu", 39},
		{"no chuuren with a kan", "2345678999m5m", "5m", []Meld{ankan("1m")}, "tsumo,chinitsu", 7},
	}
	for _, tc := range cases {
		ctx := east()
		ctx.WinTile = kind(tc.win)
		ctx.Melds = tc.melds
		w, ok := Evaluate(tile.MustParseHand(tc.hand), ctx)
		if !ok || keys(w) != tc.keys || w.HanTotal != tc.han {
			t.Errorf("%s: got [%s] han=%d ok=%v, want [%s] han=%d", tc.name, keys(w), w.HanTotal, ok, tc.keys, tc.han)
		}
	}
}

// A concealed kan keeps the hand closed: iipeikou still scores, pinfu never.
func TestAuditAnkanKeepsIipeikou(t *testing.T) {
	ctx := east()
	ctx.WinTile = kind("8s")
	ctx.Melds = []Meld{ankan("1z")}
	w, ok := Evaluate(tile.MustParseHand("223344m567p88s"), ctx)
	if !ok || keys(w) != "tsumo,iipeikou,ton" || w.HanTotal != 4 {
		t.Fatalf("got [%s] han=%d ok=%v", keys(w), w.HanTotal, ok)
	}
}

// An open all-terminal-and-honor hand is toitoi + honroutou, never chanta.
func TestAuditOpenHonroutou(t *testing.T) {
	ctx := east()
	ctx.WinTile = kind("1p")
	ctx.Ron = true
	ctx.Melds = []Meld{pon("1m"), pon("9p")}
	w, ok := Evaluate(tile.MustParseHand("111z999m11p"), ctx)
	if !ok || keys(w) != "honroutou,toitoi,ton" || w.HanTotal != 6 {
		t.Fatalf("got [%s] han=%d ok=%v", keys(w), w.HanTotal, ok)
	}
}
