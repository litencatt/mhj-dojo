package session

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// stateJSON is the state's JSON without the session id, for comparing two
// sessions built the same way.
func stateJSON(t *testing.T, st State) string {
	t.Helper()
	st.SessionID = ""
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// movesOf reads a state's tree back as the moves that built it.
func movesOf(st State) []Move {
	var moves []Move
	for _, n := range st.Tree[1:] {
		m := Move{Parent: *n.ParentID}
		if n.Status != StatusTsumo {
			m.Tile = n.Discard
		}
		moves = append(moves, m)
	}
	return moves
}

// TestReplayMatchesPlay plays random branching games move by move, then
// replays the tree's moves on a fresh session: the state must be the same.
func TestReplayMatchesPlay(t *testing.T) {
	combos := 0
	for seed := int64(1); seed <= testmode.N(int64(20), 4, 2); seed++ {
		rng := rand.New(rand.NewPCG(uint64(seed), 0))
		st := NewStore()
		s := mustCreate(t, st, seed, 8)
		var last State
		for range testmode.N(60, 30, 12) {
			v := s.State()
			if v.Status != StatusPlaying {
				last, _ = s.Goto(rng.IntN(len(v.Tree)))
				continue
			}
			tiles := append(append([]string{}, v.Hand...), *v.Drawn)
			var err error
			last, err = s.Discard(tiles[rng.IntN(len(tiles))], nil)
			if err != nil {
				t.Fatal(err)
			}
			if rng.IntN(4) == 0 {
				last, _ = s.Goto(rng.IntN(len(last.Tree)))
			}
		}
		rs := mustCreate(t, st, seed, 8)
		r, err := rs.Replay(movesOf(last), last.NodeID)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		if got, want := stateJSON(t, r), stateJSON(t, last); got != want {
			t.Fatalf("seed %d: replayed state differs\n got %s\nwant %s", seed, got, want)
		}
		// Other nodes too: their reviews were left for when they're shown.
		for range 3 {
			id := rng.IntN(len(last.Tree))
			got, _ := rs.Goto(id)
			want, _ := s.Goto(id)
			if stateJSON(t, got) != stateJSON(t, want) {
				t.Fatalf("seed %d: replayed node %d differs", seed, id)
			}
			combos += len(got.Combos) + len(got.CombosByDiscard)
		}
	}
	// The comparisons cover the whole state, the combos included.
	if combos == 0 {
		t.Fatal("no compared state had combos")
	}
}

func TestReplayTsumo(t *testing.T) {
	st := NewStore()
	s, _ := st.CreateWithWall(fixedWall(t, "234m567p345s6788s", "5s1z"), 0)
	want, err := s.Tsumo(nil)
	if err != nil {
		t.Fatal(err)
	}
	r, _ := st.CreateWithWall(fixedWall(t, "234m567p345s6788s", "5s1z"), 0)
	got, err := r.Replay(movesOf(want), want.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	if stateJSON(t, got) != stateJSON(t, want) || got.Win == nil {
		t.Fatalf("replayed tsumo differs: %+v", got)
	}
}

func TestReplayErrors(t *testing.T) {
	st := NewStore()
	tile := func(s string) *string { return &s }
	for _, c := range []struct {
		moves   []Move
		current int
		want    error
	}{
		{[]Move{{Parent: 1, Tile: tile("1m")}}, 0, ErrNotFound},
		{[]Move{{Parent: 0, Tile: tile("9z")}}, 0, ErrInvalid},
		{[]Move{{Parent: 0}}, 0, ErrConflict}, // seed 1's first draw doesn't win
		{nil, 1, ErrNotFound},
		// Seed 1's hand holds 1m; the second move repeats the first.
		{[]Move{{Parent: 0, Tile: tile("1m")}, {Parent: 0, Tile: tile("1m")}}, 1, ErrInvalid},
	} {
		if _, err := mustCreate(t, st, 1, 0).Replay(c.moves, c.current); !errors.Is(err, c.want) {
			t.Errorf("Replay(%+v, %d) = %v, want %v", c.moves, c.current, err, c.want)
		}
	}
}
