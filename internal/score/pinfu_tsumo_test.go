package score

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// Without 門前清自摸和 (a dojo that has not learned it), a pinfu tsumo keeps
// its 20 fu and scores 20 fu 1 han.
func TestPinfuTsumoWithoutMenzenTsumo(t *testing.T) {
	ctx := yaku.Context{WinTile: tile.MustParseHand("1m")[0].Kind, Winds: yaku.EastEast}
	w, ok := yaku.EvaluateWith(tile.MustParseHand("123m567m345p678s99s"), ctx, yaku.NewKeySet("pinfu", "tanyao"))
	if !ok || len(w.Yaku) != 1 || w.Yaku[0].Key != "pinfu" || w.HanTotal != 1 || w.Fu != 20 {
		t.Fatalf("got %+v", w)
	}
	if p := FromWin(w, false, true); p.FromDealer != 400 || p.FromNonDealer != 200 || p.Total != 800 {
		t.Errorf("non-dealer: %+v", p)
	}
	if p := FromWin(w, true, true); p.FromNonDealer != 400 || p.Total != 1200 {
		t.Errorf("dealer: %+v", p)
	}
}
