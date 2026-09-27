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
// request's rows and between requests (see TestCachesMatchFresh).
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
		{0, Options{Length: Tonpuu, FirstDealer: DealerYou, CPU: cpu.Normal}, caller, "4d38d534d26980ab713cb81e256332325fcaaf54f15a02120bacfa213875f344"},
		{5, Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: cpu.Weak}, move, "5ee22db46b71b657685fcd9b94c641c518c3d6f61008d5bc772b1c488d07e378"},
	} {
		if got := goldenGame(t, c.seed, c.o, c.pick); got != c.want {
			t.Errorf("seed %d: states hash to %s, want %s", c.seed, got, c.want)
		}
	}
}
