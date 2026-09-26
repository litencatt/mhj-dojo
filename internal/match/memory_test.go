package match

import (
	"runtime"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/game"
)

// BenchmarkGameMemory estimates the heap held by one finished 半荘 Match —
// the game state, the human's per-turn history, and the capped shanten/CPU
// memos — to project the worst case for MaxGames games kept in the store.
// See docs/api.md "Memory" for the method and the resulting estimate.
//
// It does not run under `go test ./...` (only -bench matches Benchmark
// functions); run it explicitly with a single iteration:
//
//	go test ./internal/match -run '^$' -bench BenchmarkGameMemory -benchtime=1x
func BenchmarkGameMemory(b *testing.B) {
	if testing.Short() {
		b.Skip("plays whole games on one goroutine; run without -short")
	}
	const n = 30
	matches := make([]*Match, n)

	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)

	for i := range matches {
		m := newMatch(game.NewHanchan(int64(i), game.HanchanRule), Options{Length: Hanchan}, true)
		playGame(b, m)
		matches[i] = m
	}

	runtime.GC()
	runtime.ReadMemStats(&after)

	perGame := float64(after.HeapAlloc-before.HeapAlloc) / n
	b.ReportMetric(perGame, "bytes/game")
	b.Logf("%d finished 半荘 matches: %.0f bytes/game (HeapAlloc %d -> %d)", n, perGame, before.HeapAlloc, after.HeapAlloc)
	runtime.KeepAlive(matches)
}
