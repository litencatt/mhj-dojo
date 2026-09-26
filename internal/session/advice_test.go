package session

import (
	"slices"
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/testmode"
)

func TestAdviceAndReview(t *testing.T) {
	st := NewStore()
	// 9m makes tenpai on 1s-4s; 1z breaks the pair.
	s, err := st.CreateWithWall(fixedWall(t, "123m456p789s23s11z", "9m5z7z"), 0)
	if err != nil {
		t.Fatal(err)
	}
	root := s.State()
	if root.Advice == nil || len(root.Advice.Candidates) != 3 || root.Advice.Candidates[0].Tile != "9m" {
		t.Fatalf("root advice %+v", root.Advice)
	}
	if root.DiscardReview != nil {
		t.Fatalf("root review %+v", root.DiscardReview)
	}

	bad, err := s.Discard("1z", nil)
	if err != nil {
		t.Fatal(err)
	}
	r := bad.DiscardReview
	if r == nil || r.IsBest || r.Tile != "1z" || r.Best != "9m" || r.Shanten != 1 || r.BestShanten != 0 {
		t.Fatalf("review after 1z: %+v", r)
	}
	if bad.Advice == nil || bad.Advice.Junme != 2 {
		t.Fatalf("advice at turn 1: %+v", bad.Advice)
	}

	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	good, err := s.Discard("9m", nil)
	if err != nil {
		t.Fatal(err)
	}
	if r := good.DiscardReview; r == nil || !r.IsBest || r.Text != "前巡の打 9m: 最善" {
		t.Fatalf("review after 9m: %+v", r)
	}

	// Going back to the first branch shows its own review again, and the
	// full advice of nodes off the current path is dropped.
	back, err := s.Goto(bad.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if back.DiscardReview == nil || back.DiscardReview.Tile != "1z" || back.DiscardReview.IsBest {
		t.Fatalf("review after goto: %+v", back.DiscardReview)
	}
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	for _, n := range s.nodes {
		if n.id != s.current && n.advice != nil {
			t.Errorf("node %d kept its advice", n.id)
		}
	}
}

func TestAdviceAtTerminalNodes(t *testing.T) {
	st := NewStore()
	s, err := st.CreateWithWall(fixedWall(t, "123m456p789s23s11z", "9m5z"), 1)
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.Discard("9m", nil)
	if err != nil {
		t.Fatal(err)
	}
	if v.Status != StatusExhausted || v.Advice != nil || v.DiscardReview == nil || !v.DiscardReview.IsBest {
		t.Fatalf("exhausted: advice %+v review %+v", v.Advice, v.DiscardReview)
	}

	s, err = st.CreateWithWall(fixedWall(t, "234m567p345s6788s", "5s1z"), 0)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.Tsumo(nil)
	if err != nil {
		t.Fatal(err)
	}
	if w.Advice != nil || w.DiscardReview != nil {
		t.Fatalf("tsumo: advice %+v review %+v", w.Advice, w.DiscardReview)
	}
}

// TestPracticeActionP95 plays whole practice games along the advice (so the
// hands reach 1-shanten and tenpai, where the advice does the most work) and
// checks the discard request's p95 against the 200 ms action budget.
func TestPracticeActionP95(t *testing.T) {
	if testing.Short() {
		t.Skip("CPU-bound timing; skip under the race job's -short")
	}
	st := NewStore()
	var took []time.Duration
	for seed := int64(1); seed <= testmode.N(int64(8), 3, 1); seed++ {
		s := mustCreate(t, st, seed, DefaultMaxTurns)
		v := s.State()
		for v.Status == StatusPlaying {
			start := time.Now()
			v, _ = s.Discard(v.Advice.Candidates[0].Tile, nil)
			took = append(took, time.Since(start))
		}
	}
	slices.Sort(took)
	var sum time.Duration
	for _, d := range took {
		sum += d
	}
	p95 := took[len(took)*95/100]
	t.Logf("%d discards: mean %v, p95 %v, max %v", len(took), sum/time.Duration(len(took)), p95, took[len(took)-1])
	if !raceEnabled && p95 > 200*time.Millisecond {
		t.Errorf("discard p95 %v, want < 200ms", p95)
	}
}
