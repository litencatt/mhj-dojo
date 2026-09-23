package server

import (
	"encoding/json"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/match"
	"github.com/litencatt/mhj2/internal/session"
)

func (c *client) game(method, path, body string) (match.State, map[string]any) {
	c.t.Helper()
	code, b, _ := c.do(method, path, body)
	if code != http.StatusOK {
		c.t.Fatalf("%s %s %s: %d %s", method, path, body, code, b)
	}
	var st match.State
	var raw map[string]any
	if err := json.Unmarshal(b, &st); err != nil {
		c.t.Fatal(err)
	}
	_ = json.Unmarshal(b, &raw)
	return st, raw
}

// nextMove picks a legal move: win if possible, else discard the last tile.
func nextMove(st match.State) string {
	l := st.Legal
	switch {
	case l.Tsumo:
		return `{"type":"tsumo"}`
	case l.Ron:
		return `{"type":"ron"}`
	}
	return `{"type":"discard","tile":"` + l.Discards[len(l.Discards)-1] + `"}`
}

func TestGamePlaysToTheEnd(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, raw := c.game("POST", "/api/games", `{"seed":42}`)
	if st.Seed != 42 || st.Dealer != 2 || st.You != 0 || st.Actor != 0 || st.Seats[0].Wind != "3z" {
		t.Fatalf("new game: seed %d dealer %d actor %d wind %s", st.Seed, st.Dealer, st.Actor, st.Seats[0].Wind)
	}
	path := "/api/games/" + st.GameID
	var took []time.Duration
	for steps := 0; st.Result == nil; steps++ {
		if steps > 100 {
			t.Fatal("game does not end")
		}
		checkHidden(t, raw)
		if len(st.Analysis) != 31 { // seat wind 西 differs from the round wind 東
			t.Fatalf("analysis has %d rows", len(st.Analysis))
		}
		start := time.Now()
		st, raw = c.game("POST", path+"/action", nextMove(st))
		took = append(took, time.Since(start))
		if len(st.Events) == 0 {
			t.Fatal("no events after a move")
		}
	}
	if st.Phase != "ended" || st.Actor != -1 || len(st.UraDoraIndicators) != 1 {
		t.Fatalf("ended state: phase %s actor %d ura %v", st.Phase, st.Actor, st.UraDoraIndicators)
	}
	sum := st.Result.Deposit
	for _, s := range st.Seats {
		if len(s.Hand) == 0 {
			t.Fatalf("seat %d hand hidden after the end", s.Seat)
		}
		sum += s.Points
	}
	if sum != 100000 {
		t.Fatalf("points sum %d", sum)
	}
	again, _ := c.game("GET", path, "")
	if again.Result == nil || again.Result.Kind != st.Result.Kind {
		t.Fatal("GET after the end lost the result")
	}
	c.wantError("POST", path+"/action", `{"type":"skip"}`, http.StatusConflict)
	slices.Sort(took)
	p95 := took[len(took)*95/100]
	t.Logf("result %s, action p95 %v over %d moves", st.Result.Kind, p95, len(took))
	if !testing.Short() && p95 > 200*time.Millisecond {
		t.Errorf("action p95 %v, want < 200ms", p95)
	}
}

// checkHidden fails if the raw JSON exposes another seat's tiles before the end.
func checkHidden(t *testing.T, raw map[string]any) {
	t.Helper()
	for i, s := range raw["seats"].([]any) {
		seat := s.(map[string]any)
		_, hand := seat["hand"]
		_, drawn := seat["drawn"]
		if i != 0 && (hand || drawn) {
			t.Fatalf("seat %d tiles exposed: %v", i, seat)
		}
	}
	if ura := raw["ura_dora_indicators"].([]any); len(ura) != 0 {
		t.Fatal("ura dora exposed before the end")
	}
}

func TestGameErrors(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, _ := c.game("POST", "/api/games", `{"seed":4}`) // dealer 0: you move first
	path := "/api/games/" + st.GameID + "/action"
	c.wantError("GET", "/api/games/nope", "", http.StatusNotFound)
	c.wantError("POST", path, `{"type":"pon"}`, http.StatusBadRequest)
	c.wantError("POST", path, `{"type":"discard"}`, http.StatusBadRequest)
	c.wantError("POST", path, `{"type":"discard","tile":"xx"}`, http.StatusBadRequest)
	c.wantError("POST", path, `{"type":"ron"}`, http.StatusConflict)
	c.wantError("POST", path, ``, http.StatusBadRequest)
	if !st.Legal.Tsumo {
		c.wantError("POST", path, `{"type":"tsumo"}`, http.StatusConflict)
	}
	for _, d := range st.Legal.Discards {
		if len(st.ByDiscard[d]) != len(st.Analysis) {
			t.Fatalf("by_discard[%s] has %d rows", d, len(st.ByDiscard[d]))
		}
	}
	if len(st.ByDiscard) != len(st.Legal.Discards) {
		t.Fatalf("by_discard %d entries for %d discards", len(st.ByDiscard), len(st.Legal.Discards))
	}
}

// A seed with the human as a non-dealer: the CPUs move first, and those
// moves are reported as events.
func TestGameStartsWithCPUMoves(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, _ := c.game("POST", "/api/games", `{"seed":1}`) // dealer 1
	if st.Dealer != 1 || len(st.Events) != 3 || st.Events[0].Seat != 1 || st.Events[2].Seat != 3 {
		t.Fatalf("dealer %d events %+v", st.Dealer, st.Events)
	}
	if len(st.History) != 1 || st.History[0].Turn != 0 {
		t.Fatalf("history %+v", st.History)
	}
}
