package yakushanten

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// completeWithMelds builds a complete hand of four groups and a pair and moves
// up to three groups out as called melds (open, or concealed kan-free).
func completeWithMelds(r *rand.Rand) (conc tile.Counts, melds []yaku.Meld, ok bool) {
	var groups [4]yaku.Meld
	var c tile.Counts
	for i := range groups {
		if r.IntN(3) == 0 {
			k := tile.Kind(r.IntN(tile.NumKinds))
			groups[i] = yaku.Meld{Type: yaku.Trip, Kind: k}
			c[k] += 3
		} else {
			k := tile.MakeKind(r.IntN(3), 1+r.IntN(7))
			groups[i] = yaku.Meld{Type: yaku.Seq, Kind: k}
			c[k]++
			c[k+1]++
			c[k+2]++
		}
	}
	c[r.IntN(tile.NumKinds)] += 2
	if slices.ContainsFunc(c[:], func(n int) bool { return n > 4 }) {
		return c, nil, false
	}
	conc = c
	if r.IntN(2) == 0 {
		for _, i := range r.Perm(4)[:r.IntN(4)] {
			m := groups[i]
			m.Open = true
			for j := range 3 {
				if m.Type == yaku.Seq {
					conc[m.Kind+tile.Kind(j)]--
				} else {
					conc[m.Kind]--
				}
			}
			melds = append(melds, m)
		}
	}
	return conc, melds, true
}

// Every yaku that Evaluate scores for a winning hand must be satisfied by that
// hand in the per-yaku analysis (shanten -1), and tanyao must agree both ways.
func TestAnalysisAgreesWithEvaluate(t *testing.T) {
	r := rand.New(rand.NewPCG(41, 42))
	a := NewAnalyzer()
	checked := 0
	for range testmode.N(20000, 4000, 800) {
		conc, melds, ok := completeWithMelds(r)
		if !ok {
			continue
		}
		var ts []tile.Tile
		for k, n := range conc {
			for range n {
				ts = append(ts, tile.Tile{Kind: tile.Kind(k)})
			}
		}
		win := ts[r.IntN(len(ts))].Kind
		ctx := yaku.Context{WinTile: win, Winds: yaku.EastEast, Melds: melds}
		w, ok := yaku.Evaluate(ts, ctx)
		if !ok {
			t.Fatalf("%s %+v: complete hand rejected", conc, melds)
		}
		rows := map[string]Result{}
		for _, res := range a.AnalyzeWith(conc, melds) {
			rows[res.Key] = res
		}
		for _, y := range w.Yaku {
			key := y.Key
			if key == "tsumo" || key == "pinfu" { // not shape rows / relaxed
				continue
			}
			row, found := rows[key]
			if !found {
				continue // yaku without a row (e.g. a situational one)
			}
			if !row.Possible || row.Shanten != -1 {
				t.Fatalf("%s melds %+v: Evaluate scores %s but its row is %+v", conc, melds, key, row)
			}
		}
		if len(w.Yaku) > 0 && w.Yaku[0].Han >= 13 {
			continue // yakuman replace the other yaku
		}
		tanyao := rows["tanyao"]
		if has := slices.ContainsFunc(w.Yaku, func(y yaku.Yaku) bool { return y.Key == "tanyao" }); has != (tanyao.Possible && tanyao.Shanten == -1) {
			t.Fatalf("%s melds %+v: tanyao scored=%v, row %+v", conc, melds, has, tanyao)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no hands checked")
	}
}
