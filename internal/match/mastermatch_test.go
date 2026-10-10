package match

import (
	"fmt"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// The 師範戦's difficulty (docs/dojo-economy.md): a human-like player
// (menzen or normal, see dojosim_human_test.go) plays your seat against
// three masters in 半荘戦, every yaku counted, seeds 1 to 1000. Run it with
// MHJDOJO_FULL=1, as TestDojoEconomySim; it prints a MASTERMATCH line a
// player (the 師範戦 is won by finishing first).
func TestMasterMatchSim(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games; run without -short")
	}
	n := testmode.N(1000, 2, 0)
	const chunks = 4
	cells := []struct {
		name string
		new  func() game.Decider
	}{
		{"menzen", func() game.Decider { return menzenPlayer{cpu.New()} }},
		{"normal", func() game.Decider { return cpu.New() }},
	}
	stats := make([][chunks]simStats, len(cells))
	t.Run("sim", func(t *testing.T) {
		for i, c := range cells {
			for k := range chunks {
				t.Run(fmt.Sprintf("%s/%d", c.name, k), func(t *testing.T) {
					t.Parallel()
					st := NewStore(4)
					for seed := 1 + k; seed <= n; seed += chunks {
						simGameWith(t, st, int64(seed), allYaku, Options{CPU: cpu.Master, Length: Hanchan}, c.new(), &stats[i][k])
					}
				})
			}
		}
	})
	for i, c := range cells {
		var s simStats
		for _, x := range stats[i] {
			s.add(x)
		}
		if s.games == 0 {
			continue
		}
		pct := func(x int) float64 { return 100 * float64(x) / float64(s.games) }
		t.Logf("MASTERMATCH seat0=%s games=%d rounds=%d avg_rank=%.3f ranks=%.1f%%,%.1f%%,%.1f%%,%.1f%% win=%.1f%% dealin=%.1f%%",
			c.name, s.games, s.rounds, float64(s.ranks[0]+2*s.ranks[1]+3*s.ranks[2]+4*s.ranks[3])/float64(s.games),
			pct(s.ranks[0]), pct(s.ranks[1]), pct(s.ranks[2]), pct(s.ranks[3]),
			100*float64(s.wins)/float64(s.rounds), 100*float64(s.dealIns)/float64(s.rounds))
	}
}
