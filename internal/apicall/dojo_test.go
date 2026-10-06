package apicall

import (
	"net/http"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/session"
)

// A game created with dojo options keeps riichi from you until you have it,
// and takes one redraw a round.
func TestDojoGame(t *testing.T) {
	c := newClient(t, session.NewStore(256))
	c.wantError("POST", "/api/games", `{"dojo":{"yaku":["nope"]}}`, http.StatusBadRequest)
	c.wantError("POST", "/api/games", `{"dojo":{"yaku":[],"redraws_per_round":-1}}`, http.StatusBadRequest)

	// DOJO_RIICHI_SEED offers riichi with riichi learned: without it, never.
	st, _ := c.game("POST", "/api/games", `{"seed":162,"length":"tonpuu","cpu":"weak","dojo":{"yaku":["tanyao","pinfu"],"redraws_per_round":1}}`)
	if !st.Dojo {
		t.Fatal("not a dojo game")
	}
	path := "/api/games/" + st.GameID + "/action"
	redrew := false
	for steps := 0; st.Result == nil; steps++ {
		if steps > 100 {
			t.Fatal("round does not end")
		}
		if len(st.Legal.Riichi) > 0 {
			t.Fatalf("riichi offered without the yaku: %v", st.Legal.Riichi)
		}
		if st.Legal.Redraw {
			wall := st.WallRemaining
			st, _ = c.game("POST", path, `{"type":"redraw"}`)
			if redrew || st.WallRemaining != wall || st.Legal.Redraw || len(st.Events) != 1 || st.Events[0].Type != "redraw" {
				t.Fatalf("redraw: wall %d (was %d), events %+v", st.WallRemaining, wall, st.Events)
			}
			redrew = true
			c.wantError("POST", path, `{"type":"redraw"}`, http.StatusConflict)
			continue
		}
		st, _ = c.game("POST", path, tsumogiriMove(st))
	}
	if !redrew || st.Rounds[0].Redraws != 1 {
		t.Fatalf("redrew %v, summary %+v", redrew, st.Rounds[0])
	}
	// The first go-around refuses a redraw.
	st, _ = c.game("POST", "/api/games", `{"seed":1,"first_dealer":"you","dojo":{"yaku":[],"redraws_per_round":1}}`)
	c.wantError("POST", "/api/games/"+st.GameID+"/action", `{"type":"redraw"}`, http.StatusConflict)
}
