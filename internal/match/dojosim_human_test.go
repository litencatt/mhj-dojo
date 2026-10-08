package match

import (
	"fmt"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// The dojo's economy against human-like play (docs/dojo-economy.md): the
// normal CPU plays your seat. It folds against a riichi and calls, as a
// person who has learned to would; the owned-yaku restriction still decides
// which wins and riichi are legal. Run it with MHJDOJO_FULL=1, as
// TestDojoEconomySim (see the doc for the command): 400 games for each of
// your policy, the opponents' level, the length and the stage, the cells in
// parallel. It prints one SIM line a cell.

// menzenPlayer is the normal CPU that never calls: it folds against a
// riichi but keeps the hand closed, as a person with only closed-hand yaku does.
type menzenPlayer struct{ *cpu.Player }

func (p menzenPlayer) Decide(v game.View, l game.Legal) game.Action {
	if l.Skip && !l.Ron {
		return game.Action{Type: game.Skip}
	}
	return p.Player.Decide(v, l)
}

func TestDojoEconomySimHuman(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games; run without -short")
	}
	n := testmode.N(400, 2, 0)
	policies := []struct {
		name string
		new  func() game.Decider
	}{
		{"weak", func() game.Decider { return cpu.NewWeak() }},
		{"normal", func() game.Decider { return cpu.New() }},
		{"menzen", func() game.Decider { return menzenPlayer{cpu.New()} }},
	}
	settings := []struct{ cpu, length string }{
		{cpu.Weak, Tonpuu}, {cpu.Normal, Tonpuu}, {cpu.Weak, Hanchan}, {cpu.Normal, Hanchan},
	}
	t.Run("sim", func(t *testing.T) {
		for _, pol := range policies {
			for _, set := range settings {
				for _, stage := range simStages(t) {
					name := fmt.Sprintf("%s/%s-%s/%s", pol.name, set.cpu, set.length, strings.Fields(stage.name)[0])
					t.Run(name, func(t *testing.T) {
						t.Parallel()
						var s simStats
						st := NewStore(4)
						for seed := int64(1); seed <= int64(n); seed++ {
							simGameWith(t, st, seed, stage.yaku, Options{CPU: set.cpu, Length: set.length}, pol.new(), &s)
						}
						t.Logf("SIM seat0=%s opp=%s len=%s stage=%s games=%d rounds=%d wins=%d dealins=%d han=%d ranks=%d,%d,%d,%d",
							pol.name, set.cpu, set.length, strings.Fields(stage.name)[0], s.games, s.rounds, s.wins, s.dealIns, s.han,
							s.ranks[0], s.ranks[1], s.ranks[2], s.ranks[3])
					})
				}
			}
		}
	})
}
