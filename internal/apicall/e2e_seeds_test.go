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
// the danger marks show on your turn, with the advice that lists them
// (game-advice.spec.ts).
func TestE2ESeedCPURiichi(t *testing.T) {
	seed := tsConst(t, "game-advice.spec.ts", "RIICHI_SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newE2EGame(c, seed, "random")
	for i := 0; i < 3 && st.Result == nil && (len(st.Danger) == 0 || st.Advice == nil); i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	if len(st.Danger) == 0 || st.Advice == nil {
		t.Errorf("seed %d (RIICHI_SEED): no CPU riichi with advice on your turn within 3 moves; see the comment above tsConst", seed)
	}
}

// SEED (phone game in game-advice.spec.ts): the advice, so the 「おすすめ」
// chip shows, on your first turn and after one tsumogiri step.
func TestE2ESeedPhoneAdvice(t *testing.T) {
	seed := tsConst(t, "helpers.ts", "SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newE2EGame(c, seed, "random")
	for i := 0; i < 2; i++ {
		if st.Advice == nil {
			t.Fatalf("seed %d (SEED): no advice after %d moves; see the comment above tsConst", seed, i)
		}
		st, _ = c.game("POST", path, tsumogiriMove(st))
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

// dojoE2EYaku are the yaku of the dojo seeds' games: the dojo's first set
// plus riichi, bought after the first game.
const dojoE2EYaku = `["tanyao","pinfu","haku","hatsu","chun","ton","nan","shaa","pei","riichi"]`

// newDojoGame creates a game as the dojo does (tonpuu, the weak CPU, a
// random first dealer) with dojoE2EYaku and one redraw a round.
func newDojoGame(c *client, seed int) (match.State, string) {
	st, _ := c.game("POST", "/api/games", `{"seed":`+strconv.Itoa(seed)+
		`,"length":"tonpuu","cpu":"weak","dojo":{"yaku":`+dojoE2EYaku+`,"redraws_per_round":1}}`)
	return st, "/api/games/" + st.GameID + "/action"
}

// DOJO_RIICHI_SEED: a dojo game offers you riichi within 3 tsumogiri moves
// (dojo.spec.ts: the riichi bought shows in the next game).
func TestE2ESeedDojoRiichi(t *testing.T) {
	seed := tsConst(t, "helpers.ts", "DOJO_RIICHI_SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newDojoGame(c, seed)
	for i := 0; i < 3 && st.Result == nil && len(st.Legal.Riichi) == 0; i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	if !st.Dojo || len(st.Legal.Riichi) == 0 {
		t.Errorf("seed %d (DOJO_RIICHI_SEED): no riichi offered within 3 moves; see the comment above tsConst", seed)
	}
}

// DOJO_REDRAW_SEED: a dojo game offers you a redraw within 3 tsumogiri
// moves, and the redraw is taken.
func TestE2ESeedDojoRedraw(t *testing.T) {
	seed := tsConst(t, "helpers.ts", "DOJO_REDRAW_SEED")
	c := newClient(t, session.NewStore(256))
	st, path := newDojoGame(c, seed)
	for i := 0; i < 3 && st.Result == nil && !st.Legal.Redraw; i++ {
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	if !st.Legal.Redraw {
		t.Fatalf("seed %d (DOJO_REDRAW_SEED): no redraw offered within 3 moves; see the comment above tsConst", seed)
	}
	if st, _ = c.game("POST", path, `{"type":"redraw"}`); st.Legal.Redraw || st.Seats[0].Drawn == nil {
		t.Errorf("seed %d (DOJO_REDRAW_SEED): after the redraw: redraw %v, drawn %v", seed, st.Legal.Redraw, st.Seats[0].Drawn)
	}
}
