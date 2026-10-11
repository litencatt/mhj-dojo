package match

import (
	"fmt"
	"math"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// The master CPU's strength (docs/dojo-economy.md): the master and, for
// comparison, the normal CPU play your seat against three normal CPUs in
// 4000 半荘戦 (seeds 1 to 4000, the same for both), every yaku counted. Run
// it with MHJDOJO_FULL=1, as TestDojoEconomySim; it prints a MASTER line
// for each player and the difference, and fails unless the master's average
// rank is lower by masterMargin and by 2.5 standard errors of the
// difference, paired by seed. 400 seeds are too few: their standard error
// (~0.06) is about half the difference.

// masterMargin is how much lower the master's average rank must be.
const masterMargin = 0.05

// masterChunks splits each player's seeds into parallel subtests.
const masterChunks = 8

func TestMasterStronger(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games; run without -short")
	}
	n := testmode.N(4000, 2, 0)
	policies := []struct {
		name string
		new  func() game.Decider
	}{
		{cpu.Master, func() game.Decider { return cpu.NewMaster() }},
		{cpu.Normal, func() game.Decider { return cpu.New() }},
	}
	var stats [2][masterChunks]simStats
	ranks := [2][]int{make([]int, n), make([]int, n)} // by seed - 1
	t.Run("sim", func(t *testing.T) {
		for i, pol := range policies {
			for c := range masterChunks {
				t.Run(fmt.Sprintf("%s/%d", pol.name, c), func(t *testing.T) {
					t.Parallel()
					st := NewStore(4)
					for seed := 1 + c; seed <= n; seed += masterChunks {
						var s simStats
						simGameWith(t, st, int64(seed), allYaku, Options{CPU: cpu.Normal, Length: Hanchan}, pol.new(), &s)
						stats[i][c].add(s)
						ranks[i][seed-1] = slices.Index(s.ranks[:], 1) + 1
					}
				})
			}
		}
	})
	if t.Failed() {
		return
	}
	var avg [2]float64
	for i, pol := range policies {
		var s simStats
		for _, c := range stats[i] {
			s.add(c)
		}
		avg[i] = float64(s.ranks[0]+2*s.ranks[1]+3*s.ranks[2]+4*s.ranks[3]) / float64(s.games)
		pct := func(x int) float64 { return 100 * float64(x) / float64(s.games) }
		t.Logf("MASTER seat0=%s games=%d rounds=%d avg_rank=%.3f first=%.1f%% last=%.1f%% win=%.1f%% dealin=%.1f%% ranks=%d,%d,%d,%d",
			pol.name, s.games, s.rounds, avg[i], pct(s.ranks[0]), pct(s.ranks[3]),
			100*float64(s.wins)/float64(s.rounds), 100*float64(s.dealIns)/float64(s.rounds),
			s.ranks[0], s.ranks[1], s.ranks[2], s.ranks[3])
	}
	// The standard error of the mean difference, paired by seed.
	diff := avg[1] - avg[0]
	var ss float64
	for seed := range n {
		d := float64(ranks[1][seed]-ranks[0][seed]) - diff
		ss += d * d
	}
	se := math.Sqrt(ss / float64(max(1, n-1)) / float64(n))
	t.Logf("MASTER avg_rank master=%.3f normal=%.3f diff=%.3f se=%.3f", avg[0], avg[1], diff, se)
	if testmode.Full() && (diff < masterMargin || diff < 2.5*se) {
		t.Errorf("the master is not clearly stronger: average rank %.3f vs normal %.3f (diff %.3f, se %.3f)", avg[0], avg[1], diff, se)
	}
}

// add sums o into s.
func (s *simStats) add(o simStats) {
	s.games += o.games
	s.rounds += o.rounds
	s.wins += o.wins
	s.dealIns += o.dealIns
	s.han += o.han
	for r := range s.ranks {
		s.ranks[r] += o.ranks[r]
	}
}
