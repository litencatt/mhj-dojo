package match

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
)

// goldenGame plays a whole 東風戦, the human moving with pick, and returns
// the sha256 of every state's JSON and save in turn.
func goldenGame(t *testing.T, seed int64, o Options, pick func(State, *bool) game.Action) string {
	t.Helper()
	m, err := NewStore().Create(&seed, o)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.New()
	put := func(st State, err error) State {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		st.GameID = ""
		b, _ := json.Marshal(st)
		s, _ := json.Marshal(m.Save())
		h.Write(b)
		h.Write(s)
		return st
	}
	st := put(m.State(), nil)
	for rounds := 0; !st.GameOver; rounds++ {
		if rounds > 30 {
			t.Fatal("game does not end")
		}
		riichi := false
		for steps := 0; st.Result == nil; steps++ {
			if steps > 300 {
				t.Fatal("round does not end")
			}
			st = put(m.Act(pick(st, &riichi)))
		}
		if !st.GameOver {
			st = put(m.Next())
		}
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

// TestGoldenStates pins the state JSON and saves of two whole games (one
// taking every call and kan, one declaring riichi) to what the engine
// answered at commit 383fe58, before the analyses were shared across a
// request's rows and between requests (see TestCachesMatchFresh). The
// hashes were taken again when the JSON took its slimmer shape (ukeire as
// tile kinds counted by one remaining map, by_discard rows without the
// analysis's names and han): converted to that shape, the old states were
// the same as the new ones, state for state (the saves, match.Save, are untouched).
func TestGoldenStates(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	for _, c := range []struct {
		seed int64
		o    Options
		pick func(State, *bool) game.Action
		want string
	}{
		{0, Options{Length: Tonpuu, FirstDealer: DealerYou, CPU: cpu.Normal}, caller, "8c4fd89861e80d5f3288a4797636ef50fd434b61290627796ec03c994ce6dbde"},
		{5, Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: cpu.Weak}, move, "29a82b6df508a22389cee80b70cde342b069f455142acec7f92889f94219d4ce"},
	} {
		if got := goldenGame(t, c.seed, c.o, c.pick); got != c.want {
			t.Errorf("seed %d: states hash to %s, want %s", c.seed, got, c.want)
		}
	}
}
