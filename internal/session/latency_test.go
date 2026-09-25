package session

import (
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/wall"
)

// requestBudget is a generous per-request latency ceiling for the tests
// below: not a target (both run several ms/request in practice, see
// docs/api.md "Memory"), just high enough to absorb CI/machine noise while
// still catching an accidental return to O(tree size) work per request.
const requestBudget = 300 * time.Millisecond

// TestLargeTreeRequestLatency measures per-request latency (Goto, and
// Discard where the tree's node cap allows one more) on an already-built,
// maximally branched MaxNodes-node session tree — every node reachable in
// one request, the worst case for pruneAnalysisCache's eviction (docs/api.md
// "Memory") forcing a node's analysis to be recomputed instead of served
// from cache.
func TestLargeTreeRequestLatency(t *testing.T) {
	if testing.Short() {
		t.Skip("grows a session to a 2000-node tree; run without -short")
	}
	st := NewStore()
	s, err := st.CreateWithWall(wall.New(1), wall.LiveDraws)
	if err != nil {
		t.Fatal(err)
	}
	fillTree(t, s)
	if len(s.nodes) < MaxNodes {
		t.Fatalf("only reached %d nodes, want %d", len(s.nodes), MaxNodes)
	}

	// Visit every node once as current (Goto), then discard its drawn
	// tile if it can accept one more (most can't: the tree is already at
	// the node cap, so this mostly exercises Goto's state() build, the
	// worst case for a large history path near a leaf).
	start := time.Now()
	calls := 0
	for id := range s.nodes {
		if _, err := s.Goto(id); err != nil {
			t.Fatal(err)
		}
		calls++
		v := s.State()
		if v.Drawn != nil {
			if _, err := s.Discard(*v.Drawn); err == nil {
				calls++
			}
		}
	}
	elapsed := time.Since(start)
	perCall := elapsed / time.Duration(calls)
	t.Logf("%d requests over a %d-node tree: %v total, %v/request", calls, len(s.nodes), elapsed, perCall)
	if perCall > requestBudget {
		t.Fatalf("%v/request exceeds the %v budget", perCall, requestBudget)
	}
}

// TestTypicalTreeRequestLatency measures the same thing as
// TestLargeTreeRequestLatency, but for a shape closer to typical single-user
// play: mostly one long line (a full practice game), with a handful of
// local rewinds, instead of fillTree's exhaustive breadth-first branching
// into every discard at every node.
func TestTypicalTreeRequestLatency(t *testing.T) {
	if testing.Short() {
		t.Skip("plays and rewinds a full session several times; run without -short")
	}
	st := NewStore()
	s, err := st.CreateWithWall(wall.New(1), wall.LiveDraws)
	if err != nil {
		t.Fatal(err)
	}

	// Play forward to the end, then rewind to a few earlier points and
	// branch into a different discard, playing forward again each time —
	// a session that has been played with, not one deliberately grown to
	// the node cap.
	play := func() {
		for {
			v := s.State()
			if v.Drawn == nil {
				return
			}
			if _, err := s.Discard(*v.Drawn); err != nil {
				t.Fatal(err)
			}
		}
	}
	play()
	for rewind := 10; rewind <= 50; rewind += 10 {
		if _, err := s.Goto(rewind); err != nil {
			t.Fatal(err)
		}
		v := s.State()
		tiles := append(append([]string{}, v.Hand...), *v.Drawn)
		if _, err := s.Discard(tiles[0]); err != nil { // an alternate discard, branching here
			t.Fatal(err)
		}
		play()
	}

	start := time.Now()
	calls := 0
	for rep := 0; rep < 10; rep++ {
		for id := range s.nodes {
			if _, err := s.Goto(id); err != nil {
				t.Fatal(err)
			}
			calls++
		}
	}
	elapsed := time.Since(start)
	perCall := elapsed / time.Duration(calls)
	t.Logf("%d requests over a %d-node typical tree (x10): %v total, %v/request", calls, len(s.nodes), elapsed, perCall)
	if perCall > requestBudget {
		t.Fatalf("%v/request exceeds the %v budget", perCall, requestBudget)
	}
}
