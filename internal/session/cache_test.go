package session

import (
	"math/rand/v2"
	"reflect"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// TestCachesMatchFresh plays random branching games on two sessions of the
// same wall, one with the analyzer's result memo turned off, and requires
// the same state on every request. After each request it checks what the
// nodes cache against a fresh analysis of their hands: the analysis and
// combos a discard takes from its parent's preview, and the per-row shanten
// the history is built from, the history itself included. Only nodes on the current path may hold an
// analysis (pruneAnalysisCache).
func TestCachesMatchFresh(t *testing.T) {
	requests, seeded := 0, 0
	for seed := int64(1); seed <= testmode.N(int64(16), 4, 2); seed++ {
		rng := rand.New(rand.NewPCG(uint64(seed), 1))
		st := NewStore(256)
		s, plain := mustCreate(t, st, seed, 12), mustCreate(t, st, seed, 12)
		plain.analyzer.DisableResultMemo()
		fresh := yakushanten.NewAnalyzer()
		for range testmode.N(80, 40, 15) {
			v := s.State(View{})
			var got, want State
			var err, perr error
			switch {
			case v.Status != StatusPlaying || rng.IntN(5) == 0:
				id := rng.IntN(len(v.Tree))
				got, err = s.Goto(id, View{})
				want, perr = plain.Goto(id, View{})
			case v.CanTsumo && rng.IntN(2) == 0:
				got, err = s.Tsumo(nil, View{})
				want, perr = plain.Tsumo(nil, View{})
			default:
				tiles := append(append([]string{}, v.Hand...), *v.Drawn)
				x := tiles[rng.IntN(len(tiles))]
				if rng.IntN(2) == 0 {
					x = v.Advice.Candidates[0].Tile
				}
				k, _ := tile.Parse(x)
				preview := plain.nodes[plain.current].byDiscard[k.Kind]
				got, err = s.Discard(x, nil, View{})
				want, perr = plain.Discard(x, nil, View{})
				// Without the result memo, only the seeding shares the rows.
				if a := plain.nodes[plain.current].analysis; perr == nil && len(preview) > 0 && &a[0] == &preview[0] {
					seeded++
				}
			}
			if err != nil || perr != nil {
				t.Fatalf("seed %d: %v / %v", seed, err, perr)
			}
			if stateJSON(t, got) != stateJSON(t, want) {
				t.Fatalf("seed %d node %d: state differs without the result memo", seed, got.NodeID)
			}
			requests++
			for _, h := range got.History {
				n := s.nodes[h.NodeID]
				if n.status == StatusTsumo {
					continue
				}
				if want := apiview.ShantenMap(fresh.Analyze(tile.CountsOf(n.hand))); !reflect.DeepEqual(h.Shanten, want) {
					t.Fatalf("seed %d: history of node %d differs from a fresh analysis", seed, n.id)
				}
			}
			path := s.path(s.nodes[s.current])
			for _, n := range s.nodes {
				c := tile.CountsOf(n.hand)
				rows := fresh.Analyze(c)
				if n.analysis != nil {
					if !slices.Contains(path, n) {
						t.Fatalf("seed %d: node %d off the path holds an analysis", seed, n.id)
					}
					if !reflect.DeepEqual(n.analysis, rows) {
						t.Fatalf("seed %d: node %d analysis differs from a fresh one", seed, n.id)
					}
				}
				if n.combos != nil {
					if want := fresh.Combos(c, nil, rows); !reflect.DeepEqual(n.combos, append([]yakushanten.Combo{}, want...)) {
						t.Fatalf("seed %d: node %d combos differ from fresh ones", seed, n.id)
					}
				}
				if n.rowShanten != nil && !slices.Equal(n.rowShanten, compactShanten(rows)) {
					t.Fatalf("seed %d: node %d row shanten differ from a fresh analysis", seed, n.id)
				}
			}
		}
	}
	if seeded == 0 {
		t.Fatalf("%d requests and no discard took its analysis from the parent's preview", requests)
	}
}
