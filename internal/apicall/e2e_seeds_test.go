package apicall

import (
	"strconv"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/session"
)

// Guards the seeds the E2E specs (web/e2e) depend on: if a game-logic change
// alters what they deal, this fails here, quickly, instead of as a confusing
// browser failure. To pick a new seed, loop playTsumogiriUntilPon over seeds
// until one returns true, then update the matching constant in
// web/e2e/helpers.ts (SEED) or web/e2e/table.spec.ts (CPU_DEALS).
const (
	e2eSeed     = 12 // SEED in web/e2e/helpers.ts
	e2eCPUDeals = 13 // CPU_DEALS in web/e2e/table.spec.ts
)

// playTsumogiriUntilPon plays the E2E's generic strategy (tsumo/ron when
// offered, skip any other call offer, otherwise discard the drawn tile, or
// the last hand tile when nothing was drawn) and reports whether a pon is
// offered before the round ends or maxSteps moves pass.
func playTsumogiriUntilPon(c *client, seed, maxSteps int) bool {
	st, _ := c.game("POST", "/api/games", `{"seed":`+strconv.Itoa(seed)+`,"length":"tonpuu"}`)
	path := "/api/games/" + st.GameID + "/action"
	for i := 0; i < maxSteps && st.Result == nil; i++ {
		if st.Legal.Pon {
			return true
		}
		move := nextMove(st)
		if d := st.Seats[0].Drawn; d != nil && !st.Legal.Skip && !st.Legal.Tsumo && !st.Legal.Ron {
			move = `{"type":"discard","tile":"` + *d + `"}`
		}
		st, _ = c.game("POST", path, move)
	}
	return false
}

func TestE2ESeedOffersPon(t *testing.T) {
	c := newClient(t, session.NewStore())
	// 60 matches maxSteps of playUntilPonOffered in web/e2e/helpers.ts.
	if !playTsumogiriUntilPon(c, e2eSeed, 60) {
		t.Fatalf("seed %d (SEED in web/e2e/helpers.ts) no longer offers you a pon within 60 "+
			"tsumogiri moves. Find a seed that does (loop playTsumogiriUntilPon over seeds "+
			"in this file), set SEED to it, and fix the \"Seed 12\" comment in game.spec.ts", e2eSeed)
	}
}

// The E2E specs also assume SEED deals you the first turn (no CPU events
// yet) and CPU_DEALS opens with a CPU dealer.
func TestE2ESeedDealers(t *testing.T) {
	c := newClient(t, session.NewStore())
	st, _ := c.game("POST", "/api/games", `{"seed":`+strconv.Itoa(e2eSeed)+`,"length":"tonpuu"}`)
	if st.Actor != 0 || len(st.Events) != 0 {
		t.Errorf("seed %d (SEED): want you to move first with no CPU events, got actor %d, %d events "+
			"(game.spec.ts and mobile.spec.ts rely on it; pick a new seed as in TestE2ESeedOffersPon)",
			e2eSeed, st.Actor, len(st.Events))
	}
	st, _ = c.game("POST", "/api/games", `{"seed":`+strconv.Itoa(e2eCPUDeals)+`,"first_dealer":"random","length":"tonpuu"}`)
	if len(st.Events) == 0 || st.Events[0].Seat == 0 {
		t.Errorf("seed %d (CPU_DEALS in web/e2e/table.spec.ts): want a CPU dealer, got events %+v",
			e2eCPUDeals, st.Events)
	}
}
