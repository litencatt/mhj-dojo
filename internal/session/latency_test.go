package session

import (
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/wall"
)

// requestBudget is a generous per-request latency ceiling: not a target
// (real runs are several ms/request at most, see docs/api.md "Memory"),
// just high enough to absorb CI/machine noise while still catching an
// accidental return to O(tree size) work per request.
const requestBudget = 300 * time.Millisecond

// TestTreeRequestLatency is a fast regression guard for pruneAnalysisCache
// (docs/api.md "Memory"): requests against a modestly branched tree must
// stay cheap. It's sized to run in a couple of seconds so it can stay in
// the regular `go test ./...` run; BenchmarkLargeTreeRequestLatency and
// BenchmarkTypicalTreeRequestLatency below have the full MaxNodes-sized
// measurements (not run by `go test ./...`, like the memory benchmarks).
// It's single-goroutine, CPU-bound work with nothing concurrency-specific
// to check, and the race detector's instrumentation overhead alone pushes
// it close to the latency budget, so -short skips it like the other
// CPU-heavy tests the race job doesn't need.
func TestTreeRequestLatency(t *testing.T) {
	if testing.Short() {
		t.Skip("CPU-bound, no concurrency to check; skip under the race job's -short")
	}
	const n = 120
	st := NewStore()
	s, err := st.CreateWithWall(wall.New(1), wall.LiveDraws)
	if err != nil {
		t.Fatal(err)
	}
	fillTree(t, s, n)
	if len(s.nodes) < n {
		t.Fatalf("only reached %d nodes, want %d", len(s.nodes), n)
	}

	start := time.Now()
	calls := 0
	for id := range s.nodes {
		if _, err := s.Goto(id); err != nil {
			t.Fatal(err)
		}
		calls++
	}
	elapsed := time.Since(start)
	perCall := elapsed / time.Duration(calls)
	t.Logf("%d requests over a %d-node tree: %v total, %v/request", calls, len(s.nodes), elapsed, perCall)
	if perCall > requestBudget {
		t.Fatalf("%v/request exceeds the %v budget", perCall, requestBudget)
	}
}

// BenchmarkLargeTreeRequestLatency measures per-request latency (Goto) on
// an already-built, maximally branched MaxNodes-node session tree — every
// node reachable in one request, the worst case for pruneAnalysisCache's
// eviction forcing a node's analysis to be recomputed instead of served
// from cache. See docs/api.md "Memory" for the resulting numbers.
//
// It does not run under `go test ./...` (only -bench matches Benchmark
// functions); run it explicitly:
//
//	go test ./internal/session -run '^$' -bench BenchmarkLargeTreeRequestLatency
func BenchmarkLargeTreeRequestLatency(b *testing.B) {
	st := NewStore()
	s, err := st.CreateWithWall(wall.New(1), wall.LiveDraws)
	if err != nil {
		b.Fatal(err)
	}
	fillTree(b, s, MaxNodes)
	if len(s.nodes) < MaxNodes {
		b.Fatalf("only reached %d nodes, want %d", len(s.nodes), MaxNodes)
	}
	n := len(s.nodes)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.Goto(i % n); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkTypicalTreeRequestLatency measures the same thing as
// BenchmarkLargeTreeRequestLatency, but for a shape closer to typical
// single-user play: mostly one long line (a full practice game), with a
// handful of local rewinds, instead of fillTree's exhaustive breadth-first
// branching into every discard at every node.
func BenchmarkTypicalTreeRequestLatency(b *testing.B) {
	st := NewStore()
	s, err := st.CreateWithWall(wall.New(1), wall.LiveDraws)
	if err != nil {
		b.Fatal(err)
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
				b.Fatal(err)
			}
		}
	}
	play()
	for rewind := 10; rewind <= 50; rewind += 10 {
		if _, err := s.Goto(rewind); err != nil {
			b.Fatal(err)
		}
		v := s.State()
		tiles := append(append([]string{}, v.Hand...), *v.Drawn)
		if _, err := s.Discard(tiles[0]); err != nil { // an alternate discard, branching here
			b.Fatal(err)
		}
		play()
	}
	n := len(s.nodes)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := s.Goto(i % n); err != nil {
			b.Fatal(err)
		}
	}
}
