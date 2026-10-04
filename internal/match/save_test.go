package match

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
)

// restored rebuilds m from its save, sent through JSON as the WebAssembly
// build does, and requires the same state, the game id aside.
func restored(t *testing.T, st *Store, m *Match) *Match {
	t.Helper()
	b, err := json.Marshal(m.Save())
	if err != nil {
		t.Fatal(err)
	}
	var s Save
	if err := json.Unmarshal(b, &s); err != nil {
		t.Fatal(err)
	}
	r, err := st.Restore(s)
	if err != nil {
		t.Fatalf("restore: %v (save %.300s)", err, b)
	}
	if r.ID() == m.ID() || r.ID() == "" {
		t.Fatalf("restored game id %q (was %q)", r.ID(), m.ID())
	}
	if got, _ := st.Get(r.ID()); got != r {
		t.Fatal("restored game not stored")
	}
	want, got := m.State(), r.State()
	want.GameID, got.GameID = "", ""
	a, _ := json.Marshal(want)
	c, _ := json.Marshal(got)
	if string(a) != string(c) {
		t.Fatalf("restored state differs after %d actions:\n got %.400s\nwant %.400s", len(s.Actions), c, a)
	}
	return r
}

// caller picks the human's move like move, but takes every call and kan it
// is offered and declares 九種九牌, so that saves hold them.
func caller(st State, riichi *bool) game.Action {
	l := st.Legal
	switch {
	case l.Ron:
		return game.Action{Type: game.Ron}
	case l.Tsumo:
		return game.Action{Type: game.Tsumo}
	case l.Kyuushu:
		return game.Action{Type: game.Kyuushu}
	case len(l.Kan) > 0 && l.Skip:
		return game.Action{Type: game.Kan}
	case len(l.Kan) > 0:
		return game.Action{Type: game.Kan, Tile: l.Kan[0]}
	case l.Pon:
		return game.Action{Type: game.Pon}
	case len(l.Chii) > 0:
		return game.Action{Type: game.Chii, Tiles: l.Chii[0]}
	}
	return move(st, riichi)
}

// TestSaveRestoresAWholeGame plays whole games with calls, kans, riichi,
// skips, 九種九牌 and next, and rebuilds each from its save after the first
// of each of those moves in each game, after every next and at the end: the
// rebuilt state is the same.
func TestSaveRestoresAWholeGame(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	seen := map[game.ActionType]bool{}
	for _, c := range []struct {
		seed  int64
		o     Options
		calls bool // take every call (else riichi when offered)
	}{
		{0, Options{Length: Tonpuu, FirstDealer: DealerYou, CPU: cpu.Normal}, true},   // pon, chii, kan, riichi
		{0, Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: cpu.Weak}, false}, // riichi, skip
		{23, Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: cpu.Weak}, true}, // kyuushu
	} {
		st := NewStore(256)
		m, err := st.Create(&c.seed, c.o)
		if err != nil {
			t.Fatal(err)
		}
		s := m.State()
		riichi := false
		played := map[game.ActionType]bool{}
		for steps := 0; !s.GameOver; steps++ {
			if steps > 2000 {
				t.Fatal("game does not end")
			}
			a := game.Action{Type: ActionNext}
			if s.CanNext {
				riichi = false
				s, err = m.Next()
			} else {
				if c.calls {
					a = caller(s, &riichi)
				} else {
					a = move(s, &riichi)
				}
				s, err = m.Act(a)
			}
			if err != nil {
				t.Fatalf("seed %d: %+v: %v", c.seed, a, err)
			}
			switch a.Type {
			case game.Pon, game.Chii, game.Kan, game.Riichi, game.Skip, game.Kyuushu:
				if played[a.Type] {
					break
				}
				fallthrough
			case ActionNext:
				played[a.Type], seen[a.Type] = true, true
				restored(t, st, m)
			}
		}
		if r := restored(t, st, m); !r.State().GameOver {
			t.Fatal("restored game not over")
		}
	}
	for _, a := range []game.ActionType{game.Pon, game.Chii, game.Kan, game.Riichi, game.Skip, game.Kyuushu, ActionNext} {
		if !seen[a] {
			t.Errorf("no %s played; pick other seeds", a)
		}
	}
}

// A random seed stays hidden in the rebuilt game, while its save carries it.
func TestRestoreKeepsTheSeedHidden(t *testing.T) {
	st := NewStore(256)
	m, err := st.Create(nil, Options{FirstDealer: DealerYou})
	if err != nil {
		t.Fatal(err)
	}
	s := m.State()
	if _, err := m.Act(game.Action{Type: game.Discard, Tile: s.Legal.Discards[0]}); err != nil {
		t.Fatal(err)
	}
	save := m.Save()
	if save.SeedKnown || save.Seed != m.game.H.Seed() || len(save.Actions) != 1 {
		t.Fatalf("save %+v, seed %d", save, m.game.H.Seed())
	}
	if r := restored(t, st, m); r.State().Seed != nil {
		t.Fatalf("restored seed %d shown", *r.State().Seed)
	}
}

// Failed moves are not saved, and a save that does not replay is refused
// without storing anything.
func TestSaveSkipsFailedMoves(t *testing.T) {
	st := NewStore(1)
	seed := int64(4)
	m, err := st.Create(&seed, Options{FirstDealer: DealerYou})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Act(game.Action{Type: game.Ron}); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("ron: %v", err)
	}
	if _, err := m.Next(); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("next: %v", err)
	}
	save := m.Save()
	if len(save.Actions) != 0 {
		t.Fatalf("saved actions %+v", save.Actions)
	}
	save.Actions = []SavedAction{{Type: game.Ron}}
	if _, err := st.Restore(save); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("restore: %v", err)
	}
	if got, err := st.Get(m.ID()); err != nil || got != m {
		t.Fatalf("a refused restore evicted the game: %v", err)
	}
	if _, err := st.Restore(Save{Seed: 1, Length: "x"}); !errors.Is(err, game.ErrInvalid) {
		t.Fatalf("bad length: %v", err)
	}
}

// A save whose check does not match the replay is refused; one without a
// check is taken as it is.
func TestRestoreChecksTheSave(t *testing.T) {
	st := NewStore(256)
	seed := int64(4)
	m, err := st.Create(&seed, Options{FirstDealer: DealerYou})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Act(game.Action{Type: game.Discard, Tile: m.State().Legal.Discards[0]}); err != nil {
		t.Fatal(err)
	}
	save := m.Save()
	if save.Check == "" {
		t.Fatal("no check")
	}
	tampered := save
	tampered.Check = "0"
	if _, err := st.Restore(tampered); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("tampered check: %v", err)
	}
	// The same moves on another seed are another game.
	other := save
	other.Seed = 5
	if _, err := st.Restore(other); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("another seed: %v", err)
	}
	unchecked := save
	unchecked.Check = ""
	if _, err := st.Restore(unchecked); err != nil {
		t.Fatalf("no check: %v", err)
	}
}
