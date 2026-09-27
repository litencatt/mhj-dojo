package server

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apicall"
	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// TestRouteMatchesServer sends the same practice requests to the HTTP server
// and to apicall.Route (the WebAssembly build's transport), each with its
// own store, and requires the same status and JSON body, the session id
// aside. TestGameRouteMatchesServer does the same for games.
func TestRouteMatchesServer(t *testing.T) {
	c := newClient(t, session.NewStore())
	store, games := session.NewStore(), match.NewStore()
	var srvID, wasmID string

	send := func(method, path, body string) {
		t.Helper()
		code, b, _ := c.do(method, strings.ReplaceAll(path, "{id}", srvID), body)
		status, v := apicall.Route(store, games, method, strings.ReplaceAll(path, "{id}", wasmID), strings.NewReader(body))
		w, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		got := strings.TrimSuffix(string(b), "\n")
		want := string(w)
		if srvID != "" {
			got = strings.ReplaceAll(got, srvID, "{id}")
			want = strings.ReplaceAll(want, wasmID, "{id}")
		}
		if code != status || got != want {
			t.Errorf("%s %s %s:\nserver %d %.300s\nroute  %d %.300s", method, path, body, code, got, status, want)
		}
	}

	create := `{"seed":1,"max_turns":6}`
	var st session.State
	for _, path := range []string{"/api/sessions?advice=0&tree_from=1", "/api/sessions"} {
		srv := c.state("POST", path, create)
		_, v := apicall.Route(store, games, "POST", path, strings.NewReader(create))
		st = v.(session.State)
		srvID, wasmID = srv.SessionID, st.SessionID
		srv.SessionID, st.SessionID = "", ""
		a, _ := json.Marshal(srv)
		b, _ := json.Marshal(st)
		if string(a) != string(b) {
			t.Fatalf("create:\nserver %.300s\nroute  %.300s", a, b)
		}
	}
	if len(st.Combos) == 0 || len(st.CombosByDiscard) == 0 {
		t.Fatal("the compared states should carry combos")
	}
	drawn, first := *st.Drawn, st.Hand[0]

	for _, r := range []struct{ method, path, body string }{
		{"GET", "/api/sessions/{id}", ""},
		{"POST", "/api/sessions/{id}/discard", `{"tile":"` + drawn + `","node_id":0}`},
		{"POST", "/api/sessions/{id}/discard", `{"tile":"` + first + `","node_id":0}`}, // stale
		{"POST", "/api/sessions/{id}/goto", `{"node_id":0}`},
		{"POST", "/api/sessions/{id}/discard", `{"tile":"` + first + `"}`},
		{"POST", "/api/sessions/{id}/goto", `{"node_id":1}`},
		{"POST", "/api/sessions/{id}/discard", `{"tile":"` + drawn + `","node_id":0}`},
		{"POST", "/api/sessions/{id}/tsumo", ""},
		{"POST", "/api/sessions/{id}/tsumo", `{"node_id":1}`},
		{"POST", "/api/sessions/{id}/discard", ""},
		{"POST", "/api/sessions/{id}/discard", "{}"},
		{"POST", "/api/sessions/{id}/discard", "{"},
		{"POST", "/api/sessions/{id}/discard", `{"tile":"9z"}`},
		{"POST", "/api/sessions/{id}/goto", "{}"},
		{"POST", "/api/sessions/{id}/goto", `{"node_id":99}`},
		{"POST", "/api/sessions", `{"max_turns":999}`},
		{"POST", "/api/sessions", `{"seed":"x"}`},
		{"GET", "/api/sessions/nope", ""},
		{"POST", "/api/sessions/nope/discard", `{"tile":"1m"}`},
		// View options: a discard without the advice leaves its review to
		// the next state shown with it.
		{"POST", "/api/sessions/{id}/goto?advice=0&tree_from=3", `{"node_id":0}`},
		{"POST", "/api/sessions/{id}/discard?advice=0&tree_from=3", `{"tile":"` + st.Hand[1] + `"}`},
		{"GET", "/api/sessions/{id}?tree_from=2", ""},
		{"GET", "/api/sessions/{id}?advice=1&tree_from=99&other=x", ""},
		{"POST", "/api/sessions/{id}/tsumo?advice=0", ""},
		{"GET", "/api/sessions/{id}?advice=2", ""},
		{"GET", "/api/sessions/{id}?tree_from=-1", ""},
		{"GET", "/api/sessions/{id}?tree_from=x", ""},
		{"POST", "/api/sessions?tree_from=", create},
		{"GET", "/api/sessions/nope?advice=2", ""},
		{"GET", "/api/version?advice=0", ""},
		// Unknown paths, wrong methods and trailing slashes.
		{"GET", "/api/sessions", ""},
		{"PUT", "/api/sessions", "{}"},
		{"GET", "/api/sessions/", ""},
		{"POST", "/api/sessions/{id}", "{}"},
		{"GET", "/api/sessions/{id}/", ""},
		{"GET", "/api/sessions/{id}/discard", ""},
		{"POST", "/api/sessions/{id}/discard/", `{"tile":"1m"}`},
		{"POST", "/api/sessions/{id}/undo", "{}"},
		{"GET", "/api/sessionsx", ""},
		{"GET", "/api/nothing", ""},
		{"GET", "/api/version", ""},
		{"POST", "/api/version", "{}"},
		{"GET", "/api/version/", ""},
	} {
		send(r.method, r.path, r.body)
	}
}

// TestGameRouteMatchesServer plays the same seeded game on the HTTP server
// and through apicall.Route, round after round up to its end, and requires
// the same status and JSON body at every step, the game id aside, along
// with the errors and unknown game paths.
func TestGameRouteMatchesServer(t *testing.T) {
	if testing.Short() {
		t.Skip("plays a whole game twice; run without -short")
	}
	c := newClient(t, session.NewStore())
	store, games := session.NewStore(), match.NewStore()
	var srvID, wasmID string

	send := func(method, path, body string) (int, string) {
		t.Helper()
		code, b, _ := c.do(method, strings.ReplaceAll(path, "{id}", srvID), body)
		status, v := apicall.Route(store, games, method, strings.ReplaceAll(path, "{id}", wasmID), strings.NewReader(body))
		w, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		got := strings.TrimSuffix(string(b), "\n")
		want := string(w)
		if srvID != "" {
			got = strings.ReplaceAll(got, srvID, "{id}")
			want = strings.ReplaceAll(want, wasmID, "{id}")
		}
		if code != status || got != want {
			t.Fatalf("%s %s %s:\nserver %d %.300s\nroute  %d %.300s", method, path, body, code, got, status, want)
		}
		return status, got
	}

	create := `{"seed":7,"cpu":"weak","first_dealer":"you"}`
	srv, _ := c.game("POST", "/api/games", create)
	_, v := apicall.Route(store, games, "POST", "/api/games", strings.NewReader(create))
	st := v.(match.State)
	srvID, wasmID = srv.GameID, st.GameID
	srv.GameID, st.GameID = "", ""
	a, _ := json.Marshal(srv)
	b, _ := json.Marshal(st)
	if string(a) != string(b) {
		t.Fatalf("create:\nserver %.300s\nroute  %.300s", a, b)
	}

	for _, r := range []struct{ method, path, body string }{
		{"GET", "/api/games/{id}", ""},
		{"POST", "/api/games/{id}/action", ""},
		{"POST", "/api/games/{id}/action", "{"},
		{"POST", "/api/games/{id}/action", `{"type":"fly"}`},
		{"POST", "/api/games/{id}/action", `{"type":"discard"}`},
		{"POST", "/api/games/{id}/action", `{"type":"chii","tiles":["1m"]}`},
		{"POST", "/api/games/{id}/action", `{"type":"discard","tile":"9z"}`},
		{"POST", "/api/games/{id}/action", `{"type":"ron"}`},
		{"POST", "/api/games/{id}/action", `{"type":"next"}`},
		{"POST", "/api/games", `{"length":"x"}`},
		{"POST", "/api/games", `{"cpu":"strong"}`},
		{"POST", "/api/games", `{"seed":"x"}`},
		{"GET", "/api/games/nope", ""},
		{"POST", "/api/games/nope/action", `{"type":"skip"}`},
		// Unknown paths, wrong methods and trailing slashes.
		{"GET", "/api/games", ""},
		{"PUT", "/api/games", "{}"},
		{"GET", "/api/games/", ""},
		{"POST", "/api/games/{id}", "{}"},
		{"GET", "/api/games/{id}/", ""},
		{"GET", "/api/games/{id}/action", ""},
		{"POST", "/api/games/{id}/action/", `{"type":"skip"}`},
		{"POST", "/api/games/{id}/undo", "{}"},
		{"GET", "/api/gamesx", ""},
	} {
		send(r.method, r.path, r.body)
	}

	// Play to the end of the game through both, with next between rounds.
	for steps := 0; ; steps++ {
		if steps > 2000 {
			t.Fatal("game does not end")
		}
		cur, _ := c.game("GET", "/api/games/"+srvID, "")
		if cur.GameOver {
			break
		}
		body := `{"type":"next"}`
		if !cur.CanNext {
			body = nextMove(cur)
		}
		send("POST", "/api/games/{id}/action", body)
	}
	send("POST", "/api/games/{id}/action", `{"type":"next"}`)
}
