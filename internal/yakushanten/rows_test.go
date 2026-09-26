package yakushanten

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"

	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// Every row's han comes from the win evaluator, so the table and the
// scoring cannot disagree.
func TestRowsHaveClosedHan(t *testing.T) {
	for _, r := range Rows {
		h := yaku.HanFor(r.Key, yaku.EastEast)
		switch {
		case r.Key == "normal":
			if h != 0 {
				t.Errorf("normal: han %d, want 0", h)
			}
		case r.Yakuman:
			if h != 13 {
				t.Errorf("%s: yakuman han %d, want 13", r.Key, h)
			}
		case h < 1 || h > 6:
			t.Errorf("%s: han %d, want 1..6", r.Key, h)
		}
	}
	for key, want := range map[string]int{"tanyao": 1, "chiitoitsu": 2, "ryanpeikou": 3, "chinitsu": 6, "ton": 2} {
		if got := yaku.HanFor(key, yaku.EastEast); got != want {
			t.Errorf("%s: han %d, want %d", key, got, want)
		}
	}
}

func TestRowsForWinds(t *testing.T) {
	if len(Rows) != 30 || Rows[19].Key != "ton" || Rows[19].Name != "役牌 東（場風・自風）" {
		t.Fatalf("East/East rows changed: %d rows, row 19 = %+v", len(Rows), Rows[19])
	}
	rows := RowsFor(Winds{Round: tile.South, Seat: tile.West})
	if len(rows) != 31 {
		t.Fatalf("South/West: %d rows, want 31", len(rows))
	}
	if rows[19] != (RowDef{"nan", "役牌 南（場風）", false}) || rows[20] != (RowDef{"shaa", "役牌 西（自風）", false}) {
		t.Fatalf("South/West wind rows = %+v, %+v", rows[19], rows[20])
	}
	for key, want := range map[string]int{"nan": 1, "shaa": 1, "ton": 0, "pei": 0} {
		if got := yaku.HanFor(key, yaku.Winds{Round: tile.South, Seat: tile.West}); got != want {
			t.Errorf("HanFor(%s, 南, 西) = %d, want %d", key, got, want)
		}
	}
}

func TestAnalyzerFollowsWinds(t *testing.T) {
	// 234m 567m 34p 678s + 東東: two-sided wait, but 東 is a value pair only
	// when East is the round or seat wind.
	c := tile.MustCounts("234m567m34p678s11z")
	ee := NewAnalyzer().Row(c, "pinfu")
	sw := NewAnalyzerFor(Winds{Round: tile.South, Seat: tile.West}).Row(c, "pinfu")
	if ee.Shanten == 0 {
		t.Errorf("East/East: pinfu tenpai with an East pair")
	}
	if !sw.Possible || sw.Shanten != 0 || len(sw.Ukeire) != 2 {
		t.Errorf("South/West: pinfu = %+v, want tenpai on 2p/5p", sw)
	}
	// a South triplet counts toward the South round wind row
	h := tile.MustCounts("222z234m567p78s99s")
	a := NewAnalyzerFor(Winds{Round: tile.South, Seat: tile.West})
	if r := a.Row(h, "nan"); !r.Possible || r.Shanten != 0 {
		t.Errorf("South/West nan row = %+v", r)
	}
	if r := a.Row(h, "ton"); r.Key != "ton" || r.Possible {
		t.Errorf("South/West has no ton row, got %+v", r)
	}
}
