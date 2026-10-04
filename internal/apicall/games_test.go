package apicall

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

func gameCall(t *testing.T, games *match.Store, method, path, body string) (int, []byte) {
	t.Helper()
	status, v := Route(session.NewStore(256), games, method, path, strings.NewReader(body))
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return status, b
}

func gameState(t *testing.T, games *match.Store, method, path, body string) match.State {
	t.Helper()
	status, b := gameCall(t, games, method, path, body)
	if status != statusOK {
		t.Fatalf("%s %s %s: %d %s", method, path, body, status, b)
	}
	var st match.State
	if err := json.Unmarshal(b, &st); err != nil {
		t.Fatal(err)
	}
	return st
}

// TestGameRoutes creates a game, reads it and moves in it by method and
// path, as the WebAssembly build does.
func TestGameRoutes(t *testing.T) {
	games := match.NewStore(256)
	st := gameState(t, games, "POST", "/api/games", `{"seed":4,"length":"hanchan","first_dealer":"you","cpu":"weak"}`)
	if st.Seed == nil || *st.Seed != 4 || st.Length != match.Hanchan || st.FirstDealer != match.Human || st.CPU != "weak" {
		t.Fatalf("create: seed %v length %s first dealer %d cpu %s", st.Seed, st.Length, st.FirstDealer, st.CPU)
	}
	base := "/api/games/" + st.GameID
	if got := gameState(t, games, "GET", base, ""); got.GameID != st.GameID {
		t.Fatalf("get: game %q", got.GameID)
	}
	tile := st.Legal.Discards[0]
	d := gameState(t, games, "POST", base+"/action", `{"type":"discard","tile":"`+tile+`"}`)
	if len(d.Events) == 0 || d.Events[0].Tile != tile {
		t.Fatalf("discard: events %+v", d.Events)
	}
	if hidden := gameState(t, games, "POST", "/api/games", ""); hidden.Seed != nil || hidden.Length != match.Tonpuu {
		t.Fatalf("create without a body: seed %v length %s", hidden.Seed, hidden.Length)
	}
}

func TestGameErrors(t *testing.T) {
	games := match.NewStore(256)
	st := gameState(t, games, "POST", "/api/games", `{"seed":4,"first_dealer":"you"}`)
	base := "/api/games/" + st.GameID
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/games/nope", "", statusNotFound},
		{"POST", "/api/games/nope/action", `{"type":"skip"}`, statusNotFound},
		{"GET", "/api/games", "", statusNotFound},
		{"GET", "/api/gamesx", "", statusNotFound},
		{"GET", "/api/games/", "", statusNotFound},
		{"POST", base, "{}", statusNotFound},
		{"GET", base + "/action", "", statusNotFound},
		{"POST", base + "/action/x", "{}", statusNotFound},
		{"POST", "/api/games", `{"length":"x"}`, statusBadRequest},
		{"POST", "/api/games", `{"first_dealer":"me"}`, statusBadRequest},
		{"POST", "/api/games", "{", statusBadRequest},
		{"POST", base + "/action", "", statusBadRequest},
		{"POST", base + "/action", `{"type":"fly"}`, statusBadRequest},
		{"POST", base + "/action", `{"type":"riichi"}`, statusBadRequest},
		{"POST", base + "/action", `{"type":"chii","tiles":[]}`, statusBadRequest},
		{"POST", base + "/action", `{"type":"ron"}`, statusConflict},
		{"POST", base + "/action", `{"type":"next"}`, statusConflict},
	} {
		status, b := gameCall(t, games, c.method, c.path, c.body)
		var e map[string]string
		if err := json.Unmarshal(b, &e); err != nil || e["error"] == "" || strings.Contains(e["error"], "\n") {
			t.Errorf("%s %s: error body %s", c.method, c.path, b)
		}
		if status != c.status {
			t.Errorf("%s %s %s: status %d, want %d (%s)", c.method, c.path, c.body, status, c.status, b)
		}
	}
}

// TestRestoreGame rebuilds a game from its save under a new id, with the
// state it had, and refuses a save that does not replay.
func TestRestoreGame(t *testing.T) {
	games := match.NewStore(256)
	st := gameState(t, games, "POST", "/api/games", `{"seed":4,"first_dealer":"you"}`)
	base := "/api/games/" + st.GameID
	gameState(t, games, "POST", base+"/action", `{"type":"discard","tile":"`+st.Legal.Discards[0]+`"}`)
	want := gameState(t, games, "GET", base, "")
	m, err := games.Get(st.GameID)
	if err != nil {
		t.Fatal(err)
	}
	save, _ := json.Marshal(m.Save())

	status, v := RestoreGame(games, strings.NewReader(string(save)))
	if status != statusOK {
		t.Fatalf("restore: %d %v", status, v)
	}
	got := v.(match.State)
	if got.GameID == want.GameID {
		t.Fatal("restore reused the game")
	}
	if _, err := games.Get(got.GameID); err != nil {
		t.Fatalf("restored game not stored: %v", err)
	}
	got.GameID, want.GameID = "", ""
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(want)
	if string(a) != string(b) {
		t.Fatalf("restored state differs:\n got %.300s\nwant %.300s", a, b)
	}

	var tampered map[string]any
	if err := json.Unmarshal(save, &tampered); err != nil || tampered["check"] == "" {
		t.Fatalf("save %s: %v", save, err)
	}
	tampered["check"] = "0"
	b, _ = json.Marshal(tampered)
	if status, v := RestoreGame(games, strings.NewReader(string(b))); status != statusConflict {
		t.Errorf("RestoreGame with a wrong check = %d %v, want %d", status, v, statusConflict)
	}

	for body, want := range map[string]int{
		``:                     statusBadRequest,
		`{`:                    statusBadRequest,
		`{"seed":"x"}`:         statusBadRequest,
		`{"seed":4,"cpu":"x"}`: statusBadRequest,
		`{"seed":4,"first_dealer":"you","actions":[{"type":"ron"}]}`:                 statusConflict,
		`{"seed":4,"first_dealer":"you","actions":[{"type":"discard","tile":"9z"}]}`: statusBadRequest,
	} {
		if status, v := RestoreGame(games, strings.NewReader(body)); status != want {
			t.Errorf("RestoreGame(%s) = %d %v, want %d", body, status, v, want)
		}
	}
}
