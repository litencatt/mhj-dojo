package match

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/litencatt/mhj2/internal/cpu"
	"github.com/litencatt/mhj2/internal/game"
)

// defaults are the options Create fills in for an empty request.
var defaults = Options{Length: Tonpuu, FirstDealer: DealerRandom, CPU: cpu.Normal}

func TestCreateOptions(t *testing.T) {
	st := NewStore()
	for _, o := range []Options{{Length: "x"}, {FirstDealer: "me"}, {CPU: "strong"}} {
		if _, err := st.Create(nil, o); !errors.Is(err, game.ErrInvalid) {
			t.Fatalf("%+v: %v", o, err)
		}
	}
	seed := int64(5)
	m, err := st.Create(&seed, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if s := m.State(); s.Length != Tonpuu || s.FirstDealerMode != DealerRandom || s.CPU != cpu.Normal || s.FirstDealer != 1 {
		t.Fatalf("defaults: %s %s %s first dealer %d", s.Length, s.FirstDealerMode, s.CPU, s.FirstDealer)
	}
	// With first_dealer "you" the human deals East 1 whatever the seed, and
	// the walls stay those of the seed.
	for seed := range int64(8) {
		you, err := st.Create(&seed, Options{FirstDealer: DealerYou, CPU: cpu.Weak})
		if err != nil {
			t.Fatal(err)
		}
		s := you.State()
		if s.FirstDealer != Human || s.Dealer != Human || s.RoundWind != "1z" || s.RoundNumber != 1 || s.Seats[Human].Wind != "1z" {
			t.Fatalf("seed %d: first dealer %d dealer %d", seed, s.FirstDealer, s.Dealer)
		}
		if s.FirstDealerMode != DealerYou || s.CPU != cpu.Weak {
			t.Fatalf("seed %d: options %s %s", seed, s.FirstDealerMode, s.CPU)
		}
		if you.game.Round.Seed() != game.NewHanchan(seed, game.Tonpuu).Round().Seed() {
			t.Fatalf("seed %d: another wall", seed)
		}
	}
}

// The same seed and options give the same game, with the weak CPU too.
func TestWeakGameReplays(t *testing.T) {
	st := NewStore()
	for seed := range int64(4) {
		var logs [2][]game.Action
		for i := range logs {
			m, err := st.Create(&seed, Options{FirstDealer: DealerYou, CPU: cpu.Weak})
			if err != nil {
				t.Fatal(err)
			}
			playOut(t, m)
			logs[i] = m.game.Round.Log()
			if m.game.Fallbacks != 0 {
				t.Fatalf("seed %d: %d CPU fallbacks", seed, m.game.Fallbacks)
			}
		}
		if !reflect.DeepEqual(logs[0], logs[1]) {
			t.Fatalf("seed %d: logs differ", seed)
		}
	}
}

// move picks the human's move: win if possible, declare riichi once when
// offered, else discard the last legal tile.
func move(st State, riichi *bool) game.Action {
	l := st.Legal
	switch {
	case l.Ron:
		return game.Action{Type: game.Ron}
	case l.Tsumo:
		return game.Action{Type: game.Tsumo}
	case l.Skip: // a pon or chii offer
		return game.Action{Type: game.Skip}
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
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	m := newMatch(game.NewHanchan(3, game.Tonpuu), defaults, false)
	st := m.State()
	if st.Seed != nil || len(st.UraDoraIndicators) != 0 {
		t.Fatalf("seed %v ura %v before the end", st.Seed, st.UraDoraIndicators)
	}
	for _, s := range st.Seats[1:] {
		if s.Hand != nil || s.Drawn != nil {
			t.Fatalf("seat %d tiles visible before the end", s.Seat)
		}
	}
	// At the end of a round the hands and ura dora show, but the master seed
	// (which would reveal the next walls) stays hidden until the game ends.
	st = playOut(t, m)
	if len(st.UraDoraIndicators) != 1 || (st.Seed != nil) != st.GameOver {
		t.Fatalf("seed %v ura %v game over %v after the round", st.Seed, st.UraDoraIndicators, st.GameOver)
	}
	for _, s := range st.Seats {
		if s.Hand == nil {
			t.Fatalf("seat %d hand hidden after the end", s.Seat)
		}
	}
	st = playGame(t, m)
	if st.Seed == nil || *st.Seed != 3 {
		t.Fatalf("seed %v after the game", st.Seed)
	}
}

// playGame plays rounds with move until the game ends.
func playGame(t *testing.T, m *Match) State {
	t.Helper()
	st := playOut(t, m)
	for rounds := 1; !st.GameOver; rounds++ {
		if rounds > 60 || !st.CanNext {
			t.Fatalf("round %d: can_next %v", rounds, st.CanNext)
		}
		next, err := m.Next()
		if err != nil {
			t.Fatal(err)
		}
		if next.Result != nil || len(next.History) != 1 || next.History[0].Turn != 0 {
			t.Fatalf("new round: result %v history %d", next.Result, len(next.History))
		}
		st = playOut(t, m)
	}
	return st
}

// A whole game: rounds and standings add up, and Next is refused at the end.
func TestWholeGame(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	m := newMatch(game.NewHanchan(11, game.Tonpuu), defaults, true)
	st := playGame(t, m)
	if len(st.Rounds) < 4 || st.CanNext {
		t.Fatalf("%d rounds, can_next %v", len(st.Rounds), st.CanNext)
	}
	total, ranks := 0.0, map[int]bool{}
	for _, sd := range st.Standings {
		total += sd.Score
		ranks[sd.Rank] = true
	}
	if total < -0.5 || total > 0.5 || len(ranks) != 4 {
		t.Fatalf("standings %+v", st.Standings)
	}
	last := st.Rounds[len(st.Rounds)-1]
	if last.RoundWind != "1z" || last.RoundNumber != 4 {
		t.Fatalf("last round %+v", last)
	}
	if _, err := m.Next(); !errors.Is(err, game.ErrConflict) {
		t.Fatalf("next after the end: %v", err)
	}
}

// History has one entry at the start and one per human discard, including
// the ones played for the human in riichi.
func TestHistoryFollowsHumanDiscards(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
	riichiSeen := false
	// Check at least 10 seeds and keep going until one reaches riichi.
	for seed := int64(0); seed < 200 && (seed < 10 || !riichiSeen); seed++ {
		m := newMatch(game.NewHanchan(seed, game.Tonpuu), defaults, true)
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
	m := newMatch(game.NewHanchan(4, game.Tonpuu), defaults, true) // dealer 0: the human moves first
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
	m := newMatch(game.NewHanchan(4, game.Tonpuu), defaults, true)
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
