package server

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
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
	case l.Skip: // a pon or chii offer
		return `{"type":"skip"}`
	}
	return `{"type":"discard","tile":"` + l.Discards[len(l.Discards)-1] + `"}`
}

func TestGamePlaysToTheEnd(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, raw := c.game("POST", "/api/games", `{"seed":42}`)
	if st.Seed == nil || *st.Seed != 42 || st.Dealer != 2 || st.You != 0 || st.Actor != 0 || st.Seats[0].Wind != "3z" {
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
		move := nextMove(st)
		start := time.Now()
		st, raw = c.game("POST", path+"/action", move)
		took = append(took, time.Since(start))
		if strings.Contains(move, "discard") && len(st.Events) == 0 {
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
	if !testing.Short() && !raceEnabled && p95 > 200*time.Millisecond {
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
	c.wantError("POST", path, `{"type":"pass"}`, http.StatusBadRequest)
	c.wantError("POST", path, `{"type":"pon"}`, http.StatusConflict)
	c.wantError("POST", path, `{"type":"chii","tiles":["1m"]}`, http.StatusBadRequest)
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

// A random seed rebuilds the whole wall, so it is hidden until the end.
func TestRandomSeedHiddenUntilTheEnd(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, raw := c.game("POST", "/api/games", ``)
	if st.Seed != nil || raw["seed"] != nil {
		t.Fatalf("random seed exposed: %v", raw["seed"])
	}
	path := "/api/games/" + st.GameID
	for steps := 0; !st.GameOver; steps++ {
		if steps > 3000 {
			t.Fatal("game does not end")
		}
		if st.Seed != nil {
			t.Fatalf("seed %d exposed during the game", *st.Seed)
		}
		move := `{"type":"next"}`
		if !st.CanNext {
			move = nextMove(st)
		}
		st, _ = c.game("POST", path+"/action", move)
	}
	if st.Seed == nil {
		t.Fatal("seed not revealed at the end of the game")
	}
}

func TestGameLength(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, _ := c.game("POST", "/api/games", `{"seed":5,"length":"hanchan"}`)
	if st.Length != "hanchan" || st.RoundWind != "1z" || st.RoundNumber != 1 || st.Honba != 0 || st.FirstDealer != 1 {
		t.Fatalf("hanchan start: %+v", st.Length)
	}
	st, _ = c.game("POST", "/api/games", `{}`)
	if st.Length != "tonpuu" {
		t.Fatalf("default length %q", st.Length)
	}
	c.wantError("POST", "/api/games", `{"length":"west"}`, http.StatusBadRequest)
	c.wantError("POST", "/api/games/"+st.GameID+"/action", `{"type":"next"}`, http.StatusConflict)
}

// Riichi discards made for you still land in the history, and by_discard
// only offers the tiles you may discard.
func TestRiichiHistoryAndByDiscard(t *testing.T) {
	c := newClient(t, session.NewStore())
	// Playing the last legal tile, seed 67 is the first seed whose hand reaches
	// riichi; later seeds are only a safety net if the engine changes.
	for seed := 67; seed < 200; seed++ {
		st, _ := c.game("POST", "/api/games", `{"seed":`+strconv.Itoa(seed)+`}`)
		path := "/api/games/" + st.GameID
		riichi := false
		for st.Result == nil {
			if len(st.ByDiscard) != 0 && len(st.ByDiscard) != len(st.Legal.Discards) {
				t.Fatalf("seed %d: by_discard %d entries, %d legal discards", seed, len(st.ByDiscard), len(st.Legal.Discards))
			}
			move := nextMove(st)
			if !riichi && len(st.Legal.Riichi) > 0 && !st.Legal.Tsumo {
				move = `{"type":"riichi","tile":"` + st.Legal.Riichi[0] + `"}`
				riichi = true
			}
			st, _ = c.game("POST", path+"/action", move)
		}
		if !riichi {
			continue
		}
		turns := len(st.Seats[0].River)
		if last := st.History[len(st.History)-1].Turn; last != turns || len(st.History) != turns+1 {
			t.Fatalf("seed %d: history has %d entries up to turn %d, want 0..%d", seed, len(st.History), last, turns)
		}
		return
	}
	t.Fatal("no seed reached riichi")
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

// The human calls pon over the API: the offer names the tile, the meld and
// the called river tile show, and kuikae holds.
func TestHumanPon(t *testing.T) {
	c := newClient(t, session.NewStore())
	for seed := 0; seed < 300; seed++ {
		st, _ := c.game("POST", "/api/games", `{"seed":`+strconv.Itoa(seed)+`}`)
		path := "/api/games/" + st.GameID + "/action"
		for st.Result == nil {
			if !st.Legal.Pon {
				st, _ = c.game("POST", path, nextMove(st))
				continue
			}
			if st.LastDiscard == nil {
				t.Fatal("pon offered without last_discard")
			}
			called := *st.LastDiscard
			st, _ = c.game("POST", path, `{"type":"pon"}`)
			me := st.Seats[0]
			if len(me.Melds) != 1 || me.Melds[0].Type != "pon" || me.Melds[0].Tiles[2] != called {
				t.Fatalf("seed %d: melds %+v", seed, me.Melds)
			}
			from := st.Seats[me.Melds[0].From]
			if !from.River[len(from.River)-1].Called {
				t.Fatalf("seed %d: the called tile is not marked", seed)
			}
			if slices.Contains(st.Legal.Discards, called) || len(st.Legal.Discards) == 0 || me.Drawn != nil {
				t.Fatalf("seed %d: after the pon: legal %+v", seed, st.Legal)
			}
			last := st.Events[len(st.Events)-1]
			if last.Type != "pon" || last.Seat != 0 || last.Tile != called {
				t.Fatalf("seed %d: events %+v", seed, st.Events)
			}
			if len(st.Analysis) != 0 {
				t.Fatalf("seed %d: closed-hand analysis after a call", seed)
			}
			return
		}
	}
	t.Fatal("no seed offered the human a pon")
}
