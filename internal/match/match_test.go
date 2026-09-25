package match

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/litencatt/mhj2/internal/game"
)

// move picks the human's move: win if possible, declare riichi once when
// offered, else discard the last legal tile.
func move(st State, riichi *bool) game.Action {
	l := st.Legal
	switch {
	case l.Ron:
		return game.Action{Type: game.Ron}
	case l.Tsumo:
		return game.Action{Type: game.Tsumo}
	case !*riichi && len(l.Riichi) > 0:
		*riichi = true
		return game.Action{Type: game.Riichi, Tile: l.Riichi[0]}
	}
	return game.Action{Type: game.Discard, Tile: l.Discards[len(l.Discards)-1]}
}

// playOut plays the human with move until the round ends.
func playOut(t *testing.T, m *Match) State {
	t.Helper()
	st := m.State()
	riichi := false
	for steps := 0; st.Result == nil; steps++ {
		if steps > 100 {
			t.Fatal("round does not end")
		}
		var err error
		if st, err = m.Act(move(st, &riichi)); err != nil {
			t.Fatal(err)
		}
	}
	return st
}

func TestHiddenUntilTheEnd(t *testing.T) {
	m := newMatch(game.New(3), false)
	st := m.State()
	if st.Seed != nil || len(st.UraDoraIndicators) != 0 {
		t.Fatalf("seed %v ura %v before the end", st.Seed, st.UraDoraIndicators)
	}
	for _, s := range st.Seats[1:] {
		if s.Hand != nil || s.Drawn != nil {
			t.Fatalf("seat %d tiles visible before the end", s.Seat)
		}
	}
	st = playOut(t, m)
	if st.Seed == nil || *st.Seed != 3 || len(st.UraDoraIndicators) != 1 {
		t.Fatalf("seed %v ura %v after the end", st.Seed, st.UraDoraIndicators)
	}
	for _, s := range st.Seats {
		if s.Hand == nil {
			t.Fatalf("seat %d hand hidden after the end", s.Seat)
		}
	}
}

// History has one entry at the start and one per human discard, including
// the ones played for the human in riichi.
func TestHistoryFollowsHumanDiscards(t *testing.T) {
	riichiSeen := false
	for seed := int64(60); seed < 70; seed++ {
		m := newMatch(game.New(seed), true)
		st := playOut(t, m)
		discards := 0
		for _, a := range m.game.Round.Log() {
			if a.Seat == Human && (a.Type == game.Discard || a.Type == game.Riichi) {
				discards++
				riichiSeen = riichiSeen || a.Type == game.Riichi
			}
		}
		if len(st.History) != discards+1 {
			t.Fatalf("seed %d: %d history entries for %d discards", seed, len(st.History), discards)
		}
		for i, h := range st.History {
			if h.Turn != i || h.NodeID != i {
				t.Fatalf("seed %d: entry %d has turn %d", seed, i, h.Turn)
			}
		}
	}
	if !riichiSeen {
		t.Fatal("no seed reached riichi; pick other seeds")
	}
}

func TestFailedActLeavesStateUnchanged(t *testing.T) {
	m := newMatch(game.New(4), true) // dealer 0: the human moves first
	before, _ := json.Marshal(m.State())
	if _, err := m.Act(game.Action{Type: game.Discard, Tile: "xx"}); !errors.Is(err, game.ErrInvalid) {
		t.Fatalf("bad tile: %v", err)
	}
	if _, err := m.Act(game.Action{Type: game.Ron}); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("ron on the human's turn: %v", err)
	}
	after, _ := json.Marshal(m.State())
	if string(before) != string(after) {
		t.Fatal("state changed after failed moves")
	}
}

// Events are the moves since the human's last move, starting with it.
func TestEventsStartWithTheHumansMove(t *testing.T) {
	m := newMatch(game.New(4), true)
	st := m.State()
	tile := st.Legal.Discards[0]
	st, err := m.Act(game.Action{Type: game.Discard, Tile: tile})
	if err != nil {
		t.Fatal(err)
	}
	want := Event{Seat: Human, Type: game.Discard, Tile: tile}
	if len(st.Events) == 0 || !reflect.DeepEqual(st.Events[0], want) {
		t.Fatalf("events %+v", st.Events)
	}
	for _, e := range st.Events {
		if e.Type == game.Skip && e.Seat != Human {
			t.Fatalf("CPU skip reported: %+v", e)
		}
	}
}
