package session

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// TestViewLeavesOut plays random branching games twice, one session
// always asking for the whole state and the other leaving the advice and
// the tree nodes it already has out, as a client with the advice panel
// minimized does. The slim states must be the whole ones without those
// parts, and once asked for, the advice and the reviews of discards made
// without it must be the same as if they had been computed all along.
func TestViewLeavesOut(t *testing.T) {
	reviews := 0
	for seed := int64(1); seed <= testmode.N(int64(12), 3, 2); seed++ {
		rng := rand.New(rand.NewPCG(uint64(seed), 1))
		st := NewStore()
		full, slim := mustCreate(t, st, seed, 8), mustCreate(t, st, seed, 8)
		known := len(slim.State(View{NoAdvice: true}).Tree)
		check := func(want, got State, v View) {
			t.Helper()
			if !v.NoAdvice && (got.Advice == nil) != (got.Status != StatusPlaying) {
				t.Fatalf("seed %d node %d: advice %v at a %s node", seed, got.NodeID, got.Advice, got.Status)
			}
			if v.NoAdvice {
				if got.Advice != nil || got.DiscardReview != nil {
					t.Fatalf("seed %d node %d: advice left in", seed, got.NodeID)
				}
				want.Advice, want.DiscardReview = nil, nil
			}
			if got.NodeCount != len(want.Tree) || !slices.EqualFunc(got.Tree, want.Tree[v.TreeFrom:], treeNodeEqual) {
				t.Fatalf("seed %d node %d: tree from %d differs", seed, got.NodeID, v.TreeFrom)
			}
			got.Tree, want.Tree = nil, nil
			if stateJSON(t, got) != stateJSON(t, want) {
				t.Fatalf("seed %d node %d (%+v): states differ\n got %.400s\nwant %.400s", seed, got.NodeID, v, stateJSON(t, got), stateJSON(t, want))
			}
			known = got.NodeCount
		}
		for range testmode.N(50, 25, 10) {
			v := View{NoAdvice: rng.IntN(3) > 0, TreeFrom: known}
			cur := full.State(View{})
			var want, got State
			var err error
			switch {
			case cur.Status != StatusPlaying || rng.IntN(5) == 0:
				id := rng.IntN(len(cur.Tree))
				want, _ = full.Goto(id, View{})
				got, err = slim.Goto(id, v)
			default:
				tiles := append(append([]string{}, cur.Hand...), *cur.Drawn)
				tile := tiles[rng.IntN(len(tiles))]
				want, _ = full.Discard(tile, nil, View{})
				got, err = slim.Discard(tile, nil, v)
			}
			if err != nil {
				t.Fatal(err)
			}
			check(want, got, v)
			if got.DiscardReview == nil && want.DiscardReview != nil {
				// The advice panel opened: the review is filled in.
				v = View{TreeFrom: known}
				check(want, slim.State(v), v)
				reviews++
			}
		}
	}
	if reviews == 0 {
		t.Fatal("no review was left for later")
	}
}

func treeNodeEqual(a, b TreeNode) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// TestNoAdviceSkipsAdvice checks that a discard made without the advice
// computes none: neither the new node's nor, for its review, its parent's.
func TestNoAdviceSkipsAdvice(t *testing.T) {
	s := mustCreate(t, NewStore(), 3, 0)
	v := View{NoAdvice: true}
	st := s.State(v)
	st, err := s.Discard(*st.Drawn, nil, v)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range s.nodes {
		if n.advice != nil || n.review != nil {
			t.Fatalf("node %d has its advice or review", n.id)
		}
	}
	if n := s.nodes[st.NodeID]; !n.reviewPending {
		t.Fatal("the review is not pending")
	}
	if got := s.State(View{}); got.DiscardReview == nil || got.Advice == nil {
		t.Fatal("asked for, the advice and review are missing")
	}
}
