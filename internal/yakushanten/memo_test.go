package yakushanten

import (
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/shanten"
)

// TestMemoTurnover checks an analyzer whose memos have turned over many
// times against a fresh one: dropping tables and folds (see internal/memo)
// must only cost recomputation. It also checks the bounds docs/api.md
// "Memory" relies on.
func TestMemoTurnover(t *testing.T) {
	r := rand.New(rand.NewPCG(41, 42))
	a := NewAnalyzer()
	// The memo's size first drops at its second turnover (the first only
	// moves the full generation to the old one).
	prev, dropped := 0, false
	for i := 0; !dropped; i++ {
		c := randomHand(r)
		rows := a.Analyze(c)
		combos := a.Combos(c, nil, rows)
		if i%50 == 0 {
			f := NewAnalyzer()
			wantRows := f.Analyze(c)
			if !reflect.DeepEqual(rows, wantRows) || !reflect.DeepEqual(combos, f.Combos(c, nil, wantRows)) {
				t.Fatalf("%s: results differ from a fresh analyzer's after %d hands", c, i)
			}
		}
		n := a.MemoSize()
		dropped, prev = n < prev, n
		if n > 2*shanten.MemoGen || a.folds.Len() > 2*foldGen {
			t.Fatalf("after %d hands: %d tables, %d folds", i+1, n, a.folds.Len())
		}
	}
}
