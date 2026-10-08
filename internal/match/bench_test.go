package match

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/game"
)

// BenchmarkGameStep times one human action in a CPU game — the action
// itself plus the CPU turns that follow it, up to the next human decision.
// The human wins when it can, skips calls and discards the last legal tile
// (never riichi); the next round starts when one ends, and a new game with
// the next seed starts when a 半荘 ends. Creating a game and starting a
// round are not timed.
//
//	go test ./internal/match -run '^$' -bench BenchmarkGameStep
func BenchmarkGameStep(b *testing.B) {
	if testing.Short() {
		b.Skip("plays whole games on one goroutine; run without -short")
	}
	newGame := func(seed int64) *Match {
		return newMatch(game.NewHanchan(seed, game.HanchanRule), Options{Length: Hanchan}, true)
	}
	seed := int64(1)
	games, gameSteps, steps := 0, 0, 0 // finished games, their steps, this game's steps
	m := newGame(seed)
	st := m.State()
	riichi := true // never declare it
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if st.Result != nil {
			b.StopTimer()
			if st.GameOver {
				seed, games, gameSteps, steps = seed%30+1, games+1, gameSteps+steps, 0
				m = newGame(seed)
				st = m.State()
			} else {
				var err error
				if st, err = m.Next(); err != nil {
					b.Fatal(err)
				}
			}
			b.StartTimer()
		}
		var err error
		if st, err = m.Act(move(st, &riichi)); err != nil {
			b.Fatal(err)
		}
		steps++
	}
	// The length of a whole 半荘 in steps, once one has finished.
	if games > 0 {
		b.ReportMetric(float64(gameSteps)/float64(games), "steps/game")
	}
}
