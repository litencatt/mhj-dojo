package yakushanten

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// TestAnkouRowsCountTsumo pins the win the sanankou and suuankou rows count:
// ukeire are draws, so a triplet completed by the winning tile is concealed.
// On a ron the same tile completes an open triplet (yaku.Evaluate), so a
// shanpon wait scores the yaku only by tsumo, while a wait on a sequence or
// the pair scores it either way.
func TestAnkouRowsCountTsumo(t *testing.T) {
	a := NewAnalyzer()
	for _, tc := range []struct {
		key, hand, ukeire string
		ron               string // ukeire that also score the yaku by ron
	}{
		{"suuankou", "111m222p333s44z55z", "45z", ""},      // shanpon: tsumo only
		{"suuankou", "111m222p333s444z5z", "5z", "5z"},     // tanki
		{"sanankou", "111m222p345s4455z", "45z", ""},       // two ankou + shanpon
		{"sanankou", "111m222p333s456m7z", "7z", "7z"},     // tanki
		{"sanankou", "111222333m45p55z", "36p", "36p"},     // ryanmen
		{"sanankou", "111m222p333s5578m", "69m", "69m"},    // ryanmen on 78m, 55m the pair
		{"sanankou", "111m222p33s345s55z", "36s5z", "36s"}, // ron 3s reads as 345s
	} {
		hand := tile.MustParseHand(tc.hand)
		c := tile.CountsOf(hand)
		r := a.Analyze(c)[slices.IndexFunc(a.Rows(), func(d RowDef) bool { return d.Key == tc.key })]
		if !r.Possible || r.Shanten != 0 || !slices.Equal(r.Ukeire, expectedUkeire(c, tc.ukeire)) {
			t.Errorf("%s %s: possible %v shanten %d ukeire %v, want tenpai on %s",
				tc.key, tc.hand, r.Possible, r.Shanten, names(r.Ukeire), tc.ukeire)
			continue
		}
		var ron []tile.Kind
		for _, w := range r.Ukeire {
			scores := func(isRon bool) bool {
				win, ok := yaku.Evaluate(append(slices.Clone(hand), tile.Tile{Kind: w}),
					yaku.Context{WinTile: w, Ron: isRon, Winds: EastEast})
				return ok && slices.ContainsFunc(win.Yaku, func(y yaku.Yaku) bool { return y.Key == tc.key })
			}
			if !scores(false) {
				t.Errorf("%s %s: tsumo %s does not score it", tc.key, tc.hand, w)
			}
			if scores(true) {
				ron = append(ron, w)
			}
		}
		if !slices.Equal(ron, expectedUkeire(c, tc.ron)) {
			t.Errorf("%s %s: ron scores it on %v, want %s", tc.key, tc.hand, names(ron), tc.ron)
		}
	}
}
