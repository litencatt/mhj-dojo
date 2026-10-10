package match

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
)

// BenchmarkGameStep times one human action in a CPU game — the action
// itself plus the CPU turns that follow it, up to the next human decision.
// The human wins when it can, skips calls and discards the last legal tile
// (never riichi), as wasm-bench.mjs's game mode does; the next round starts
// when one ends, and a new 半荘 with the next seed (1 to 30) when one ends.
// Creating a game and starting a round are not timed. steps/game, the
// length of a 半荘, averages the ones finished: -benchtime 6000x goes round
// all 30 seeds. BenchmarkGameStepMaster is the same against three masters
// (cpu.Master), BenchmarkGameStepUra against three urashihan (cpu.Ura, in a
// dojo game with every yaku).
//
//	go test ./internal/match -run '^$' -bench BenchmarkGameStep -benchtime 6000x
func BenchmarkGameStep(b *testing.B) { benchGameStep(b, Options{Length: Hanchan}) }

func BenchmarkGameStepMaster(b *testing.B) {
	benchGameStep(b, Options{Length: Hanchan, CPU: cpu.Master})
}

func BenchmarkGameStepUra(b *testing.B) {
	benchGameStep(b, Options{Length: Hanchan, CPU: cpu.Ura, Dojo: &DojoOptions{Yaku: allYaku}})
}

func benchGameStep(b *testing.B, o Options) {
	if testing.Short() {
		b.Skip("plays whole games on one goroutine; run without -short")
	}
	s := NewStore(1)
	newGame := func(seed int64) *Match {
		m, err := s.Create(&seed, o)
		if err != nil {
			b.Fatal(err)
		}
		return m
	}
	seed := int64(1)
	m := newGame(seed)
	st := m.State()
	games, gameSteps, steps := 0, 0, 0 // finished games, their steps, this game's steps
	declared := true                   // move's riichi flag, set so it never declares one
	for b.Loop() {
		// A round can end before the human has a say (a CPU's tenhou or
		// ron): start rounds, and games, until the human is to act.
		for st.Result != nil {
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
		if st, err = m.Act(move(st, &declared)); err != nil {
			b.Fatal(err)
		}
		steps++
	}
	if games > 0 {
		b.ReportMetric(float64(gameSteps)/float64(games), "steps/game")
	}
}
