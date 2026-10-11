package match

import (
	"fmt"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// The urashihan's strength (docs/dojo-economy.md): a human-like player
// (menzen or normal, see dojosim_human_test.go) plays your seat against
// three urashihan in 半荘戦, every yaku counted, with and without the
// dojo's cheats (cheater). Run it with MHJDOJO_FULL=1, as
// TestDojoEconomySim; it prints a URA line a cell and fails unless, without
// cheats, your first-place rate is at most uraPlainFirst and your average
// rank at least uraPlainRank, and with them your first-place rate lies in
// uraCheatFirst.

// The targets of issue #324, in percent and in rank.
const (
	uraPlainFirst = 10
	uraPlainRank  = 3.0
)

var uraCheatFirst = [2]float64{25, 35}

// uraChunks splits each cell's seeds into parallel subtests.
const uraChunks = 4

// roundReader is a player on your seat that reads the round itself, as a
// cheat shows it more than its view (simGameWith hands it over).
type roundReader interface{ readRound(r *game.Round) }

// uraCheats are the dojo's cheats the cheater has: 透視 (peek), 裏ドラ透視,
// 待ち透視, 山読み (wall peek), 引き直し (redraw) and 牌寄せ (summon), once a
// round each.
var uraCheats = DojoOptions{Peek: true, UraPeek: true, RiichiWaits: true, WallPeek: 3, RedrawsPerRound: 1, SummonsPerRound: 1}

// cheater plays your seat with the cheats: it sees the other hands (透視),
// so its base player never deals into a tenpai hand (cpu's peek.go), and
// when its draw does not bring it closer to tenpai it summons a tile that
// does, else redraws. The ura dora, the riichi waits and the wall peek tell
// it nothing more that it uses.
type cheater struct {
	base game.Decider
	eng  *shanten.Engine
	r    *game.Round
}

func newCheater(base game.Decider) *cheater {
	return &cheater{base: base, eng: shanten.NewEngineGen(1_000)}
}

func (c *cheater) readRound(r *game.Round) { c.r = r }

func (c *cheater) Decide(v game.View, l game.Legal) game.Action {
	for s := range v.Seats {
		if s != Human {
			v.Seats[s].Hand, v.Seats[s].Drawn = c.r.Concealed(s)
		}
	}
	me := v.Seats[Human]
	if me.Drawn != nil && (l.Redraw || len(l.Summon) > 0) && !l.Tsumo {
		useful := c.useful(me.Hand, len(me.Melds))
		if !useful[me.Drawn.Kind] {
			if i := slices.IndexFunc(l.Summon, func(s string) bool { t, _ := tile.Parse(s); return useful[t.Kind] }); i >= 0 {
				return game.Action{Type: game.Summon, Tile: l.Summon[i]}
			}
			if l.Redraw {
				return game.Action{Type: game.Redraw}
			}
		}
	}
	return c.base.Decide(v, l)
}

// useful returns the kinds that lower the shanten of the concealed hand
// (melds calls aside).
func (c *cheater) useful(hand []tile.Tile, melds int) [tile.NumKinds]bool {
	counts := tile.CountsOf(hand)
	target := shanten.NormalTarget
	target.Melds -= melds
	ev := c.eng.Evaluate(&counts, &target)
	var set [tile.NumKinds]bool
	ev.Ukeire(&set)
	if melds == 0 {
		shanten.Lowest(&counts, ev.Dist-1, &set)
	}
	return set
}

func TestUraSim(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games; run without -short")
	}
	n := testmode.N(1000, 2, 0)
	type cell struct {
		name  string
		cheat bool
		new   func() game.Decider
	}
	cells := []cell{
		{"menzen", false, func() game.Decider { return menzenPlayer{cpu.New()} }},
		{"normal", false, func() game.Decider { return cpu.New() }},
		{"menzen", true, func() game.Decider { return newCheater(menzenPlayer{cpu.New()}) }},
		{"normal", true, func() game.Decider { return newCheater(cpu.New()) }},
	}
	stats := make([][uraChunks]simStats, len(cells))
	t.Run("sim", func(t *testing.T) {
		for i, c := range cells {
			for k := range uraChunks {
				t.Run(fmt.Sprintf("%s/cheat=%v/%d", c.name, c.cheat, k), func(t *testing.T) {
					t.Parallel()
					st := NewStore(4)
					o := Options{CPU: cpu.Ura, Length: Hanchan}
					if c.cheat {
						d := uraCheats
						o.Dojo = &d
					}
					for seed := 1 + k; seed <= n; seed += uraChunks {
						simGameWith(t, st, int64(seed), allYaku, o, c.new(), &stats[i][k])
					}
				})
			}
		}
	})
	if t.Failed() {
		return
	}
	for i, c := range cells {
		var s simStats
		for _, x := range stats[i] {
			s.add(x)
		}
		avg := float64(s.ranks[0]+2*s.ranks[1]+3*s.ranks[2]+4*s.ranks[3]) / float64(s.games)
		first := 100 * float64(s.ranks[0]) / float64(s.games)
		t.Logf("URA seat0=%s cheat=%v games=%d rounds=%d avg_rank=%.3f first=%.1f%% last=%.1f%% win=%.1f%% dealin=%.1f%% ranks=%d,%d,%d,%d",
			c.name, c.cheat, s.games, s.rounds, avg, first, 100*float64(s.ranks[3])/float64(s.games),
			100*float64(s.wins)/float64(s.rounds), 100*float64(s.dealIns)/float64(s.rounds),
			s.ranks[0], s.ranks[1], s.ranks[2], s.ranks[3])
		if !testmode.Full() {
			continue
		}
		switch {
		case !c.cheat && (first > uraPlainFirst || avg < uraPlainRank):
			t.Errorf("%s without cheats: first %.1f%% (at most %d%%), average rank %.3f (at least %.1f)", c.name, first, uraPlainFirst, avg, uraPlainRank)
		case c.cheat && (first < uraCheatFirst[0] || first > uraCheatFirst[1]):
			t.Errorf("%s with cheats: first %.1f%%, want %.0f–%.0f%%", c.name, first, uraCheatFirst[0], uraCheatFirst[1])
		}
	}
}
