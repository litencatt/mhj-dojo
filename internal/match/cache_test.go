package match

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"strconv"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// fullCheck is check hashing every round from scratch, as saves made before
// check kept the finished rounds' hash.
func fullCheck(m *Match) string {
	h := fnv.New64a()
	for _, log := range m.game.H.Logs() {
		for _, a := range log {
			fmt.Fprintf(h, "%d %s %s %v;", a.Seat, a.Type, a.Tile, a.Tiles)
		}
		h.Write([]byte{'|'})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// TestCachesMatchFresh plays whole games on two matches of the same seed,
// one with the analyzer's result memo turned off, and requires the same
// state and save on every request, the save's check being the digest of
// every round hashed from scratch.
func TestCachesMatchFresh(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	for seed := int64(1); seed <= testmode.N(int64(12), 2, 1); seed++ {
		o := Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: cpu.Normal}
		rules := game.Tonpuu
		if seed%2 == 0 {
			o.Length, rules = Hanchan, game.HanchanRule
		}
		m, plain := newMatch(game.NewHanchan(seed, rules), o, true), newMatch(game.NewHanchan(seed, rules), o, true)
		plain.analyzer.DisableResultMemo()
		human := cpu.New()
		same := func(got, want State, err, perr error) State {
			t.Helper()
			if err != nil || perr != nil {
				t.Fatalf("seed %d: %v / %v", seed, err, perr)
			}
			got.GameID, want.GameID = "", ""
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(want)
			if string(a) != string(b) {
				t.Fatalf("seed %d: state differs without the result memo\n got %.300s\nwant %.300s", seed, a, b)
			}
			sa, _ := json.Marshal(m.Save())
			sb, _ := json.Marshal(plain.Save())
			if string(sa) != string(sb) {
				t.Fatalf("seed %d: saves differ", seed)
			}
			if c, want := m.Save().Check, fullCheck(m); c != want {
				t.Fatalf("seed %d: check %s, hashed from scratch %s", seed, c, want)
			}
			return got
		}
		st := same(m.State(), plain.State(), nil, nil)
		for rounds := 0; !st.GameOver && rounds < 30; rounds++ {
			for steps := 0; st.Result == nil && steps < 300; steps++ {
				r := m.game.Round
				a := human.Decide(r.ViewFor(Human), r.LegalFor(Human))
				got, err := m.Act(a)
				want, perr := plain.Act(a)
				st = same(got, want, err, perr)
			}
			if st.GameOver {
				break
			}
			got, err := m.Next()
			want, perr := plain.Next()
			st = same(got, want, err, perr)
		}
	}
}

// TestCheckValue pins the check of a whole game and of a round just dealt,
// as computed before check kept the finished rounds' hash: saves made then
// must still restore.
func TestCheckValue(t *testing.T) {
	if testing.Short() {
		t.Skip("plays a whole game on one goroutine; run without -short")
	}
	m := newMatch(game.NewHanchan(11, game.Tonpuu), defaults, true)
	playOut(t, m)
	if _, err := m.Next(); err != nil {
		t.Fatal(err)
	}
	if got, want := m.Save().Check, "e213a24685951823"; got != want {
		t.Fatalf("after the first round: check %s, want %s", got, want)
	}
	playGame(t, m)
	if got, want := m.Save().Check, "343c900b865a8c06"; got != want {
		t.Fatalf("whole game: check %s, want %s", got, want)
	}
}
