package session

import (
	"runtime"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/wall"
)

// fillTree grows a session's branch tree to target nodes (at most MaxNodes)
// by breadth-first exploring every distinct discard reachable from the
// root, so a caller can measure a session at (or near) the store's
// worst-case tree size instead of one played-out line (which stops at
// maxTurns, far short of MaxNodes). It works on the unexported node list
// directly, bypassing Discard/Goto/State's JSON-view building (repeated per
// move, over an already-large tree, it would dominate the run time).
func fillTree(tb testing.TB, s *Session, target int) {
	tb.Helper()
	queue := []int{0}
	for len(queue) > 0 && len(s.nodes) < target {
		id := queue[0]
		queue = queue[1:]
		cur := s.nodes[id]
		if cur.status != StatusPlaying {
			continue
		}
		d, ok := s.drawn(cur)
		if !ok {
			continue
		}
		candidates := make(map[string]bool, len(cur.hand)+1)
		for _, t := range cur.hand {
			candidates[t.String()] = true
		}
		candidates[d.String()] = true
		for t := range candidates {
			if len(s.nodes) >= target {
				break
			}
			if childID, ok := cur.children[t]; ok {
				queue = append(queue, childID)
				continue
			}
			s.current = id
			if _, err := s.Discard(t, nil, View{}); err != nil {
				tb.Fatal(err)
			}
			queue = append(queue, s.current)
		}
	}
}

// BenchmarkSessionMemory estimates the heap held by one session whose tree
// has grown to MaxNodes, to project the worst case for MaxSessions sessions
// kept in the store. See docs/api.md "Memory" for the method and the
// resulting estimate.
//
// It does not run under `go test ./...` (only -bench matches Benchmark
// functions); run it explicitly with a single iteration:
//
//	go test ./internal/session -run '^$' -bench BenchmarkSessionMemory -benchtime=1x
func BenchmarkSessionMemory(b *testing.B) {
	if testing.Short() {
		b.Skip("grows every session to a 2000-node tree; run without -short")
	}
	const n = 2
	st := NewStore(256)
	sessions := make([]*Session, n)

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	for i := range sessions {
		s, err := st.CreateWithWall(wall.New(int64(i)), wall.LiveDraws)
		if err != nil {
			b.Fatal(err)
		}
		fillTree(b, s, MaxNodes)
		sessions[i] = s
	}

	runtime.GC()
	runtime.ReadMemStats(&after)

	perSession := float64(after.HeapAlloc-before.HeapAlloc) / n
	b.ReportMetric(perSession, "bytes/session")
	b.Logf("%d sessions at %d nodes each: %.0f bytes/session (HeapAlloc %d -> %d)", n, MaxNodes, perSession, before.HeapAlloc, after.HeapAlloc)
	runtime.KeepAlive(sessions)
}
