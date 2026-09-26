package server

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apicall"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// TestRouteMatchesServer sends the same practice requests to the HTTP server
// and to apicall.Route (the WebAssembly build's transport), each with its
// own store, and requires the same status and JSON body, the session id
// aside. Game endpoints are left out: Route answers them 404.
func TestRouteMatchesServer(t *testing.T) {
	c := newClient(t, session.NewStore())
	store := session.NewStore()
	var srvID, wasmID string

	send := func(method, path, body string) {
		t.Helper()
		code, b, _ := c.do(method, strings.ReplaceAll(path, "{id}", srvID), body)
		status, v := apicall.Route(store, method, strings.ReplaceAll(path, "{id}", wasmID), strings.NewReader(body))
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
	srv := c.state("POST", "/api/sessions", create)
	_, v := apicall.Route(store, "POST", "/api/sessions", strings.NewReader(create))
	st := v.(session.State)
	srvID, wasmID = srv.SessionID, st.SessionID
	srv.SessionID, st.SessionID = "", ""
	a, _ := json.Marshal(srv)
	b, _ := json.Marshal(st)
	if string(a) != string(b) {
		t.Fatalf("create:\nserver %.300s\nroute  %.300s", a, b)
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
	} {
		send(r.method, r.path, r.body)
	}
}
