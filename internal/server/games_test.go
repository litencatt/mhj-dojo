package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
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
		checkHandGroups(t, st.Seats[0].Hand, st.Seats[0].HandGroups)
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
	if st.Result.Pao == nil {
		t.Fatal("result pao is null, want an array")
	}
	sum := st.Result.Deposit
	checkHandGroups(t, st.Seats[0].Hand, st.Seats[0].HandGroups)
	for _, s := range st.Seats {
		if len(s.Hand) == 0 {
			t.Fatalf("seat %d hand hidden after the end", s.Seat)
		}
		if s.Seat != 0 && s.HandGroups != nil {
			t.Fatalf("seat %d hand_groups shown", s.Seat)
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

func TestGameOptions(t *testing.T) {
	c := newClient(t, session.NewStore())
	for _, body := range []string{`{"first_dealer":"me"}`, `{"first_dealer":0}`, `{"cpu":"strong"}`, `{"cpu":"Weak"}`} {
		c.wantError("POST", "/api/games", body, http.StatusBadRequest)
	}
	st, raw := c.game("POST", "/api/games", `{"seed":42}`)
	if raw["first_dealer_mode"] != "random" || raw["cpu"] != "normal" || st.FirstDealer != 2 {
		t.Fatalf("defaults: %v %v first dealer %d", raw["first_dealer_mode"], raw["cpu"], st.FirstDealer)
	}
	st, raw = c.game("POST", "/api/games", `{"seed":42,"first_dealer":"you","cpu":"weak"}`)
	if raw["first_dealer_mode"] != "you" || raw["cpu"] != "weak" || st.FirstDealer != 0 || st.Dealer != 0 || st.Seats[0].Wind != "1z" {
		t.Fatalf("options: %v %v first dealer %d dealer %d", raw["first_dealer_mode"], raw["cpu"], st.FirstDealer, st.Dealer)
	}
	again, _ := c.game("GET", "/api/games/"+st.GameID, "")
	if again.CPU != "weak" || again.FirstDealerMode != "you" {
		t.Fatalf("GET lost the options: %s %s", again.CPU, again.FirstDealerMode)
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
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
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
	// A fixed seed: with a random one the CPUs can abort the first round
	// (kyuushu) before your first move, and next is then allowed.
	st, _ = c.game("POST", "/api/games", `{"seed":5}`)
	if st.Length != "tonpuu" || st.Result != nil {
		t.Fatalf("default length %q", st.Length)
	}
	c.wantError("POST", "/api/games", `{"length":"west"}`, http.StatusBadRequest)
	c.wantError("POST", "/api/games/"+st.GameID+"/action", `{"type":"next"}`, http.StatusConflict)
}

// Riichi discards made for you still land in the history, and by_discard
// only offers the tiles you may discard.
func TestRiichiHistoryAndByDiscard(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
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
	if testing.Short() {
		t.Skip("plays whole games on one goroutine; run without -short")
	}
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
			checkHandGroups(t, me.Hand, me.HandGroups)
			last := st.Events[len(st.Events)-1]
			if last.Type != "pon" || last.Seat != 0 || last.Tile != called {
				t.Fatalf("seed %d: events %+v", seed, st.Events)
			}
			// The analysis holds the pon fixed: the hand is open.
			rows := map[string]apiview.YakuRow{}
			for _, r := range st.Analysis {
				rows[r.Key] = r
				if r.Shanten != nil && *r.Shanten < 0 {
					t.Fatalf("seed %d: %s shanten %d before the discard after the pon", seed, r.Key, *r.Shanten)
				}
			}
			if rows["normal"].Shanten == nil || rows["pinfu"].Shanten != nil || rows["iipeikou"].Shanten != nil ||
				rows["chinitsu"].Han != 5 || rows["pinfu"].Han != 0 || rows["tanyao"].Han != 1 {
				t.Fatalf("seed %d: open-hand rows %+v", seed, st.Analysis)
			}
			for _, d := range st.Legal.Discards {
				if len(st.ByDiscard[d]) != len(st.Analysis) {
					t.Fatalf("seed %d: by_discard %s has %d rows", seed, d, len(st.ByDiscard[d]))
				}
			}
			// The history goes on after the call: one entry per own discard.
			before := len(st.History)
			st, _ = c.game("POST", path, nextMove(st))
			checkHandGroups(t, st.Seats[0].Hand, st.Seats[0].HandGroups)
			if len(st.History) != before+1 || st.History[before].Turn != before || len(st.History[before].Shanten) != len(st.Analysis) {
				t.Fatalf("seed %d: history after the pon: %d entries (was %d)", seed, len(st.History), before)
			}
			return
		}
	}
	t.Fatal("no seed offered the human a pon")
}

// Concurrent requests on one game and on the store: the race job relies on
// this test to cover the locks in match and store.
func TestGameConcurrentRequests(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, _ := c.game("POST", "/api/games", `{"seed":7}`)
	path := c.srv.URL + "/api/games/" + st.GameID
	post := func(url, body string) (int, match.State, error) {
		res, err := http.Post(url, "application/json", strings.NewReader(body))
		if err != nil {
			return 0, match.State{}, err
		}
		defer func() { _ = res.Body.Close() }()
		var st match.State
		if res.StatusCode == http.StatusOK {
			err = json.NewDecoder(res.Body).Decode(&st)
		}
		return res.StatusCode, st, err
	}
	var wg sync.WaitGroup
	var moved atomic.Int32
	errs := make(chan error, 64)
	for g := range 6 {
		wg.Go(func() {
			for i := range 8 {
				if g%3 == 0 { // other games come and go in the store meanwhile
					if i >= 3 {
						return
					}
					if code, _, err := post(c.srv.URL+"/api/games", `{}`); err != nil || code != http.StatusOK {
						errs <- fmt.Errorf("create: %d %v", code, err)
						return
					}
					continue
				}
				res, err := http.Get(path)
				if err != nil {
					errs <- err
					return
				}
				var cur match.State
				err = json.NewDecoder(res.Body).Decode(&cur)
				_ = res.Body.Close()
				if err != nil {
					errs <- err
					return
				}
				if cur.Result != nil {
					return
				}
				// Another goroutine may move first, so the move can be stale.
				code, _, err := post(path+"/action", nextMove(cur))
				if err != nil || (code != http.StatusOK && code != http.StatusConflict && code != http.StatusBadRequest) {
					errs <- fmt.Errorf("action: %d %v", code, err)
					return
				}
				if code == http.StatusOK {
					moved.Add(1)
				}
			}
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if moved.Load() == 0 {
		t.Error("no concurrent action succeeded")
	}
	c.game("GET", "/api/games/"+st.GameID, "")
}
