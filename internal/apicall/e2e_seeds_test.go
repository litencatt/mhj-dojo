package apicall

import (
	"os"
	"regexp"
	"strconv"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// Guards the seeds the E2E specs (web/e2e) depend on: if a game-logic change
// alters what they deal, these fail here, quickly, instead of as a confusing
// browser failure. The seeds are read from the specs, so they cannot drift.
// To pick a new seed, loop the checks below over seeds until one passes, then
// set SEED in web/e2e/helpers.ts (or CPU_DEALS in web/e2e/table.spec.ts,
// WON_ROUND in web/e2e/game.spec.ts).

// tsConst reads `NAME = <int>` from a file under web/e2e.
func tsConst(t *testing.T, file, name string) int {
	t.Helper()
	b, err := os.ReadFile("../../web/e2e/" + file)
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`\b` + name + ` = (\d+)`).FindSubmatch(b)
	if m == nil {
		t.Fatalf("%s: no `%s = N` found", file, name)
	}
	n, _ := strconv.Atoi(string(m[1]))
	return n
}

// tsumogiriMove is the E2E's generic step (nextMove in web/e2e/helpers.ts):
// tsumo/ron when offered, skip any call offer, otherwise discard the drawn
// tile, or the last hand tile when nothing was drawn.
func tsumogiriMove(st match.State) string {
	if d := st.Seats[0].Drawn; d != nil && !st.Legal.Skip && !st.Legal.Tsumo && !st.Legal.Ron {
		return `{"type":"discard","tile":"` + *d + `"}`
	}
	return nextMove(st)
}

func newE2EGame(c *client, seed int, firstDealer string) (match.State, string) {
	st, _ := c.game("POST", "/api/games",
		`{"seed":`+strconv.Itoa(seed)+`,"first_dealer":"`+firstDealer+`","length":"tonpuu"}`)
	return st, "/api/games/" + st.GameID + "/action"
}

// SEED: a pon is offered within 60 moves (maxSteps of playUntilPonOffered).
func TestE2ESeedOffersPon(t *testing.T) {
	seed := tsConst(t, "helpers.ts", "SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newE2EGame(c, seed, "random")
	for i := 0; i < 60 && st.Result == nil && !st.Legal.Pon; i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	if !st.Legal.Pon {
		t.Fatalf("seed %d (SEED): no pon offered within 60 moves; see the comment above tsConst", seed)
	}
}

// SEED: you move first, your first discard is followed by several CPU
// events, and the round reaches a result within 150 moves (playToResult).
func TestE2ESeedRound(t *testing.T) {
	seed := tsConst(t, "helpers.ts", "SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newE2EGame(c, seed, "random")
	if st.Actor != 0 || len(st.Events) != 0 {
		t.Errorf("seed %d (SEED): want you to move first with no CPU events, got actor %d, %d events; see the comment above tsConst",
			seed, st.Actor, len(st.Events))
	}
	for i := 0; i < 150 && st.Result == nil; i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
		if i == 0 && len(st.Events) <= 1 {
			t.Errorf("seed %d (SEED): %d events after your first discard, want more than 1; see the comment above tsConst",
				seed, len(st.Events))
		}
	}
	if st.Result == nil {
		t.Errorf("seed %d (SEED): round not over after 150 moves; see the comment above tsConst", seed)
	}
}

// WON_ROUND: the first round ends in a win within 150 moves, with more than
// six tiles in the top seat's river (game.spec.ts, a phone fits the
// revealed hands).
func TestE2ESeedWonRound(t *testing.T) {
	seed := tsConst(t, "game.spec.ts", "WON_ROUND")
	c := newClient(t, session.NewStore(256))
	st, path := newE2EGame(c, seed, "random")
	for i := 0; i < 150 && st.Result == nil; i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	switch {
	case st.Result == nil:
		t.Errorf("seed %d (WON_ROUND): round not over after 150 moves; see the comment above tsConst", seed)
	case st.Result.Kind != "tsumo" && st.Result.Kind != "ron":
		t.Errorf("seed %d (WON_ROUND): round ended in %s, want a win; see the comment above tsConst", seed, st.Result.Kind)
	case len(st.Seats[2].River) <= 6:
		t.Errorf("seed %d (WON_ROUND): %d tiles in the top seat's river, want more than 6; see the comment above tsConst", seed, len(st.Seats[2].River))
	}
}

// RIICHI_SEED: a CPU declares riichi within 3 of your tsumogiri moves, so
// the danger marks show on your turn (game-advice.spec.ts).
func TestE2ESeedCPURiichi(t *testing.T) {
	seed := tsConst(t, "game-advice.spec.ts", "RIICHI_SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newE2EGame(c, seed, "random")
	for i := 0; i < 3 && st.Result == nil && len(st.Danger) == 0; i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	if len(st.Danger) == 0 {
		t.Errorf("seed %d (RIICHI_SEED): no CPU riichi on your turn within 3 moves; see the comment above tsConst", seed)
	}
}

// CPU_DEALS: a CPU deals first.
func TestE2ESeedCPUDeals(t *testing.T) {
	seed := tsConst(t, "table.spec.ts", "CPU_DEALS")
	st, _ := newE2EGame(newClient(t, session.NewStore(256)), seed, "random")
	if len(st.Events) == 0 || st.Events[0].Seat == 0 {
		t.Errorf("seed %d (CPU_DEALS): want a CPU dealer, got events %+v; see the comment above tsConst", seed, st.Events)
	}
}
