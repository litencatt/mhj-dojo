package match

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"reflect"
	"slices"
	"strconv"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// fullCheck is check hashing every round from scratch, as saves made before
// check kept the finished rounds' hash.
func fullCheck(m *Match) string {
	h := fnv.New64a()
	for _, log := range m.game.H.Logs() {
		for _, a := range log {
			_, _ = fmt.Fprintf(h, "%d %s %s %v;", a.Seat, a.Type, a.Tile, a.Tiles)
		}
		h.Write([]byte{'|'})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// TestCachesMatchFresh plays whole games on two matches of the same seed,
// one with the analyzer's result memo turned off, and requires the same
// state and save on every request, the save's check being the digest of
// every round hashed from scratch. One game takes every call and kan, the
// other plays as the CPU does; the human must have called, made a kan and
// declared riichi. Where a red five and a plain one can both be discarded,
// their previews must be the same and match a fresh analyzer's.
func TestCachesMatchFresh(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	type strategy func(m *Match, st State, riichi *bool) game.Action
	calls := func(_ *Match, st State, riichi *bool) game.Action { return caller(st, riichi) }
	asCPU := func() strategy {
		p := cpu.New()
		return func(m *Match, _ State, _ *bool) game.Action {
			r := m.game.Round
			return p.Decide(r.ViewFor(Human), r.LegalFor(Human))
		}
	}
	type play struct {
		seed int64
		o    Options
		pick strategy
	}
	games := []play{
		{0, Options{Length: Tonpuu, FirstDealer: DealerYou, CPU: cpu.Normal}, calls},
		{2, Options{Length: Hanchan, FirstDealer: DealerRandom, CPU: cpu.Normal}, asCPU()},
	}
	for seed := int64(3); seed < testmode.N(int64(12), 3, 3); seed++ {
		o := Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: []string{cpu.Normal, cpu.Weak}[seed%2]}
		pick := asCPU()
		if seed%3 == 0 {
			pick = calls
		}
		games = append(games, play{seed, o, pick})
	}
	moves := map[game.ActionType]int{}
	reds := 0
	for _, g := range games {
		seed := g.seed
		rules := game.Tonpuu
		if g.o.Length == Hanchan {
			rules = game.HanchanRule
		}
		m, plain := newMatch(deal(seed, rules, g.o), g.o, true), newMatch(deal(seed, rules, g.o), g.o, true)
		plain.analyzer.DisableResultMemo()
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
			reds += checkRedPreviews(t, m, got)
			return got
		}
		st := same(m.State(), plain.State(), nil, nil)
		for rounds := 0; !st.GameOver && rounds < 30; rounds++ {
			riichi := false
			for steps := 0; st.Result == nil && steps < 300; steps++ {
				a := g.pick(m, st, &riichi)
				got, err := m.Act(a)
				want, perr := plain.Act(a)
				st = same(got, want, err, perr)
				moves[a.Type]++
			}
			if st.GameOver {
				break
			}
			got, err := m.Next()
			want, perr := plain.Next()
			st = same(got, want, err, perr)
		}
	}
	for _, typ := range []game.ActionType{game.Pon, game.Chii, game.Kan, game.Riichi} {
		if moves[typ] == 0 {
			t.Errorf("the human never made a %s (moves %v)", typ, moves)
		}
	}
	t.Logf("human moves %v, red/plain previews compared %d", moves, reds)
	if reds == 0 {
		t.Error("no state offered a red five and a plain one to discard")
	}
}

// checkRedPreviews compares, on the human's turn, the previews of
// discarding a red five and a plain one of the same kind with each other
// and with a fresh analyzer's rows, and returns how many pairs it compared.
func checkRedPreviews(t *testing.T, m *Match, st State) int {
	t.Helper()
	if st.Phase != game.PhaseDiscard || st.Actor != Human {
		return 0
	}
	v := m.game.Round.ViewFor(Human)
	me := v.Seats[Human]
	all := slices.Clone(me.Hand)
	if me.Drawn != nil {
		all = append(all, *me.Drawn)
	}
	melds := fixedMelds(me.Melds)
	visible := v.Visible()
	n := 0
	for _, t0 := range all {
		if !t0.Red {
			continue
		}
		red, plain := t0.String(), t0.Kind.String()
		rr, rok := st.ByDiscard[red]
		pr, pok := st.ByDiscard[plain]
		if !rok || !pok {
			continue
		}
		c := tile.CountsOf(all)
		c[t0.Kind]--
		fresh := yakushanten.NewAnalyzerFor(m.game.Round.Winds(Human))
		want := apiview.DiscardRows(apiview.Rows(fresh.AnalyzeWith(c, melds), &visible, m.hanFor(melds)))
		if !reflect.DeepEqual(rr, pr) || !reflect.DeepEqual(rr, want) {
			t.Fatalf("%s and %s previews differ from each other or a fresh analysis", red, plain)
		}
		n++
	}
	return n
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
