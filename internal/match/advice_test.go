package match

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
)

// Advice comes on your turn with a drawn tile and a concealed hand out of
// riichi and with no tsumo, its best candidate a legal discard, junme your
// discards so far + 1 and draws_left a quarter of the wall; danger rates every tile you
// hold against each other seat in riichi, on your turn only.
func TestAdviceAndDanger(t *testing.T) {
	var advised, warned int
	for seed := int64(0); seed < 4; seed++ {
		m, err := NewStore(4).Create(&seed, Options{CPU: cpu.Weak})
		if err != nil {
			t.Fatal(err)
		}
		st, riichi := m.State(), false
		for steps := 0; st.Result == nil; steps++ {
			if steps > 100 {
				t.Fatal("round does not end")
			}
			me := st.Seats[Human]
			yourTurn := st.Phase == game.PhaseDiscard && st.Actor == Human
			if want := yourTurn && me.Drawn != nil && len(me.Melds) == 0 && !me.Riichi && !st.Legal.Tsumo; (st.Advice != nil) != want {
				t.Fatalf("seed %d: advice %v, want %v", seed, st.Advice != nil, want)
			}
			if st.Advice != nil {
				advised++
				if c := st.Advice.Candidates; len(c) == 0 || !slices.Contains(st.Legal.Discards, c[0].Tile) {
					t.Fatalf("seed %d: candidates %+v not among %v", seed, c, st.Legal.Discards)
				}
				if a := st.Advice; a.Junme != len(me.River)+1 || a.DrawsLeft != st.WallRemaining/4 {
					t.Fatalf("seed %d: junme %d, draws_left %d; want %d, %d", seed, a.Junme, a.DrawsLeft, len(me.River)+1, st.WallRemaining/4)
				}
			}
			var riichiSeats []int
			for _, s := range st.Seats[1:] {
				if s.Riichi && yourTurn {
					riichiSeats = append(riichiSeats, s.Seat)
				}
			}
			if st.Danger == nil || len(st.Danger) != len(riichiSeats) {
				t.Fatalf("seed %d: danger %+v, want seats %v", seed, st.Danger, riichiSeats)
			}
			held := slices.Clone(me.Hand)
			if me.Drawn != nil {
				held = append(held, *me.Drawn)
			}
			for i, d := range st.Danger {
				warned++
				for _, h := range held {
					if l, ok := d.Tiles[h]; d.Seat != riichiSeats[i] || !ok || l < cpu.DangerSafe || l > cpu.DangerHigh {
						t.Fatalf("seed %d: danger %+v for %s", seed, d, h)
					}
				}
			}
			if st, err = m.Act(move(st, &riichi)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if advised == 0 || warned == 0 {
		t.Errorf("advised %d times, warned %d: want both", advised, warned)
	}
}
