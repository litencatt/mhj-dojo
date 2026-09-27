package yakushanten

import (
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/memo"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
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
