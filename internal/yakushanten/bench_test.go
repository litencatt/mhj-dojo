package yakushanten

import (
	"math/rand/v2"
	"slices"
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
)

func random14(r *rand.Rand) tile.Counts {
	set := wall.FullSet()
	r.Shuffle(len(set), func(i, j int) { set[i], set[j] = set[j], set[i] })
	return tile.CountsOf(set[:14])
}

// analyzeAllDiscards is the per-turn workload: every row for every discard
// candidate of a 14-tile hand, with a fresh memo.
func analyzeAllDiscards(c tile.Counts) int {
	a := NewAnalyzer()
	n := 0
	for k := range c {
		if c[k] == 0 {
			continue
		}
		c[k]--
		n += len(a.Analyze(c))
		c[k]++
	}
	return n
}

func BenchmarkAnalyzeAllDiscards(b *testing.B) {
	r := rand.New(rand.NewPCG(7, 8))
	hands := make([]tile.Counts, 64)
	for i := range hands {
		hands[i] = random14(r)
	}
	b.ResetTimer()
	for i := 0; b.Loop(); i++ {
		analyzeAllDiscards(hands[i%len(hands)])
	}
}

// p95Limit is the per-move budget from the plan: every discard candidate x every row.
const p95Limit = 100 * time.Millisecond

func TestAnalyzeAllDiscardsP95(t *testing.T) {
	if raceEnabled {
		t.Skip("timing is not meaningful under the race detector")
	}
	r := rand.New(rand.NewPCG(9, 10))
	n := 200
	if testing.Short() {
		n = 40
	}
	durs := make([]time.Duration, n)
	for i := range durs {
		c := random14(r)
		start := time.Now()
		analyzeAllDiscards(c)
		durs[i] = time.Since(start)
	}
	slices.Sort(durs)
	p95 := durs[n*95/100]
	t.Logf("all discards x all rows: p50=%v p95=%v max=%v (limit %v)", durs[n/2], p95, durs[n-1], p95Limit)
	if p95 > p95Limit {
		t.Fatalf("p95 %v exceeds %v", p95, p95Limit)
	}
}
