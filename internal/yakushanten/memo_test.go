package yakushanten

import (
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/memo"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// sameAsFresh fails t unless a's rows and combos for c match a fresh
// analyzer's.
func sameAsFresh(t *testing.T, a *Analyzer, c tile.Counts, i int) {
	t.Helper()
	rows := a.Analyze(c)
	combos := a.Combos(c, nil, rows)
	f := NewAnalyzer()
	wantRows := f.Analyze(c)
	if !reflect.DeepEqual(rows, wantRows) || !reflect.DeepEqual(combos, f.Combos(c, nil, wantRows)) {
		t.Fatalf("hand %d %s: results differ from a fresh analyzer's", i, c)
	}
}

// TestMemoTurnover checks an analyzer whose memos have turned over against
// a fresh one: dropping tables and folds (see internal/memo) must only cost
// recomputation. It keeps going for a while after the old generation is
// first dropped, so tables get rebuilt (as new pointers) while fold keys
// still name the old ones. It also checks the bounds docs/api.md "Memory"
// relies on.
func TestMemoTurnover(t *testing.T) {
	r := rand.New(rand.NewPCG(41, 42))
	a := NewAnalyzer()
	// The memo's size first drops at its second turnover (the first only
	// moves the full generation to the old one). Before that, every 50th
	// hand is compared; after it, every 5th, for 200 hands.
	prev, left := 0, -1
	for i := 0; left != 0; i++ {
		c := randomHand(r)
		if left > 0 && i%5 == 0 || left < 0 && i%50 == 0 {
			sameAsFresh(t, a, c, i)
		} else {
			a.Combos(c, nil, a.Analyze(c))
		}
		if left > 0 {
			left--
		}
		n := a.MemoSize()
		if n < prev && left < 0 {
			left = 200
		}
		prev = n
		if n > 2*shanten.MemoGen || a.folds.Len() > 2*foldGen {
			t.Fatalf("after %d hands: %d tables, %d folds", i+1, n, a.folds.Len())
		}
	}
}

// TestTinyMemos runs an analyzer whose memos turn over every few lookups
// (64 tables and 16 folds per generation), comparing every hand with a fresh
// analyzer.
func TestTinyMemos(t *testing.T) {
	r := rand.New(rand.NewPCG(43, 44))
	a := NewAnalyzer()
	a.eng = shanten.NewEngineGen(64)
	a.folds = memo.New[[2]*shanten.Table, *shanten.Table](16)
	for i := range testmode.N(300, 100, 30) {
		sameAsFresh(t, a, randomHand(r), i)
	}
}

// TestResultMemo checks the memo of AnalyzeWith and Combos results against
// an analyzer without it, on a stream of hands that keeps coming back to
// earlier ones (as a turn's discard candidates do), with the same concealed
// tiles both with melds and without, and with the memo turning over.
func TestResultMemo(t *testing.T) {
	r := rand.New(rand.NewPCG(45, 46))
	for i, w := range []Winds{EastEast, {Round: tile.South, Seat: tile.West}} {
		a, b := NewAnalyzerFor(w), NewAnalyzerFor(w)
		b.DisableResultMemo()
		type hand struct {
			c     tile.Counts
			melds []yaku.Meld
		}
		var seen []hand
		for j := range testmode.N(600, 200, 60) {
			var h hand
			switch {
			case len(seen) > 0 && j%3 == 0: // an earlier hand, maybe evicted
				h = seen[r.IntN(len(seen))]
			case j%5 == 1:
				h.c, h.melds = randomOpen14(r)
			case j%5 == 2 && seen[len(seen)-1].melds != nil: // the open hand's concealed tiles, closed
				h.c = seen[len(seen)-1].c
			default:
				h.c = random14(r)
			}
			if k := tile.Kind(r.IntN(tile.NumKinds)); h.c[k] > 0 && j%2 == 0 {
				h.c[k]-- // 13 tiles
			}
			seen = append(seen, h)
			rows, want := a.AnalyzeWith(h.c, h.melds), b.AnalyzeWith(h.c, h.melds)
			if !reflect.DeepEqual(rows, want) {
				t.Fatalf("winds %d hand %d %s %v: rows differ", i, j, h.c, h.melds)
			}
			if got, want := a.Combos(h.c, h.melds, rows), b.Combos(h.c, h.melds, want); !reflect.DeepEqual(got, want) {
				t.Fatalf("winds %d hand %d %s %v: combos differ", i, j, h.c, h.melds)
			}
		}
	}
}
