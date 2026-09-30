package apicall

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

func call(t *testing.T, store *session.Store, method, path, body string) (int, []byte) {
	t.Helper()
	status, v := Route(store, match.NewStore(), method, path, strings.NewReader(body))
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return status, b
}

func state(t *testing.T, store *session.Store, method, path, body string) session.State {
	t.Helper()
	status, b := call(t, store, method, path, body)
	if status != statusOK {
		t.Fatalf("%s %s: %d %s", method, path, status, b)
	}
	var st session.State
	if err := json.Unmarshal(b, &st); err != nil {
		t.Fatal(err)
	}
	return st
}

// TestSessionRoutes drives a session through every practice operation by
// method and path, as the WebAssembly build does.
func TestSessionRoutes(t *testing.T) {
	store := session.NewStore()
	st := state(t, store, "POST", "/api/sessions", `{"seed":1,"max_turns":5}`)
	if st.Seed != 1 || st.MaxTurns != 5 || st.NodeID != 0 {
		t.Fatalf("create: seed %d, max_turns %d, node %d", st.Seed, st.MaxTurns, st.NodeID)
	}
	base := "/api/sessions/" + st.SessionID
	if got := state(t, store, "GET", base, ""); got.SessionID != st.SessionID {
		t.Fatalf("get: session %q", got.SessionID)
	}
	d := state(t, store, "POST", base+"/discard", `{"tile":"`+*st.Drawn+`","node_id":0}`)
	if d.NodeID != 1 || len(d.Discards) != 1 {
		t.Fatalf("discard: node %d, discards %v", d.NodeID, d.Discards)
	}
	if g := state(t, store, "POST", base+"/goto", `{"node_id":0}`); g.NodeID != 0 {
		t.Fatalf("goto: node %d", g.NodeID)
	}
	// Seed 1's first draw does not complete the hand.
	if status, _ := call(t, store, "POST", base+"/tsumo", ""); status != statusConflict {
		t.Fatalf("tsumo: status %d, want %d", status, statusConflict)
	}
}

func TestSessionErrors(t *testing.T) {
	store := session.NewStore()
	st := state(t, store, "POST", "/api/sessions", `{"seed":1}`)
	base := "/api/sessions/" + st.SessionID
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/sessions/nope", "", statusNotFound},
		{"POST", "/api/sessions/nope/discard", `{"tile":"1m"}`, statusNotFound},
		{"GET", "/api/sessions", "", statusNotFound},
		{"GET", "/api/sessionsx", "", statusNotFound},
		{"GET", "/api/sessions/", "", statusNotFound},
		{"POST", base + "/unknown", "{}", statusNotFound},
		{"POST", base + "/discard/x", "{}", statusNotFound},
		{"POST", "/api/sessions", `{"max_turns":999}`, statusBadRequest},
		{"POST", base + "/discard", "", statusBadRequest},
		{"POST", base + "/discard", "{}", statusBadRequest},
		{"POST", base + "/discard", `{"tile":"9z9"}`, statusBadRequest},
		{"POST", base + "/goto", "{}", statusBadRequest},
		{"POST", base + "/goto", `{"node_id":99}`, statusNotFound},
		{"POST", base + "/discard", `{"tile":"` + *st.Drawn + `","node_id":3}`, statusConflict},
	} {
		status, b := call(t, store, c.method, c.path, c.body)
		var e map[string]string
		if err := json.Unmarshal(b, &e); err != nil || e["error"] == "" || strings.Contains(e["error"], "\n") {
			t.Errorf("%s %s: error body %s", c.method, c.path, b)
		}
		if status != c.status {
			t.Errorf("%s %s %s: status %d, want %d (%s)", c.method, c.path, c.body, status, c.status, b)
		}
	}
}

// TestRestoreBodyFitsFullTree checks that the largest restore body the site
// sends, a tree of session.MaxNodes nodes written as web/src/wasm.ts writes
// it, is within the body limit: it must fail on its moves, not on reading.
func TestRestoreBodyFitsFullTree(t *testing.T) {
	moves := make([]map[string]any, session.MaxNodes-1)
	for i := range moves {
		moves[i] = map[string]any{"parent": session.MaxNodes - 2, "tile": "5m"}
	}
	b, err := json.Marshal(map[string]any{
		"seed": int64(1<<32 - 1), "max_turns": 18, "moves": moves, "current": session.MaxNodes - 1, "used": int64(1e13),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(b) > maxBody {
		t.Fatalf("a %d-node restore body is %d bytes, over the %d limit", session.MaxNodes, len(b), maxBody)
	}
	status, v := Restore(session.NewStore(), "", strings.NewReader(string(b)))
	if msg := v.(map[string]string)["error"]; status != statusNotFound || strings.Contains(msg, "JSON") {
		t.Fatalf("Restore = %d %v; want the 404 of its first move's parent", status, v)
	}
}

// TestRestore rebuilds a branched session from its moves in one call.
func TestRestore(t *testing.T) {
	store := session.NewStore()
	st := state(t, store, "POST", "/api/sessions", `{"seed":2,"max_turns":6}`)
	base := "/api/sessions/" + st.SessionID
	state(t, store, "POST", base+"/discard", `{"tile":"`+*st.Drawn+`"}`)
	state(t, store, "POST", base+"/goto", `{"node_id":0}`)
	state(t, store, "POST", base+"/discard", `{"tile":"`+st.Hand[0]+`"}`)
	want := state(t, store, "POST", base+"/goto", `{"node_id":1}`)

	body := `{"seed":2,"max_turns":6,"moves":[{"parent":0,"tile":"` + *st.Drawn + `"},{"parent":0,"tile":"` + st.Hand[0] + `"}],"current":1}`
	status, v := Restore(store, "", strings.NewReader(body))
	if status != statusOK {
		t.Fatalf("restore: %d %v", status, v)
	}
	got := v.(session.State)
	if got.SessionID == want.SessionID {
		t.Fatal("restore reused the session")
	}
	got.SessionID, want.SessionID = "", ""
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(want)
	if string(a) != string(b) {
		t.Fatalf("restored state differs:\n got %.300s\nwant %.300s", a, b)
	}

	// The query's view options apply to the restored state.
	status, v = Restore(store, "advice=0&tree_from=2", strings.NewReader(body))
	if slim, ok := v.(session.State); status != statusOK || !ok || slim.Advice != nil || len(slim.Tree) != 1 || slim.NodeCount != 3 {
		t.Fatalf("restore with a view: %d %+v", status, v)
	}
	if status, _ := Restore(store, "advice=no", strings.NewReader(body)); status != statusBadRequest {
		t.Fatalf("restore with a bad view: %d", status)
	}

	for body, want := range map[string]int{
		``:                                  statusBadRequest,
		`{"moves":[]}`:                      statusBadRequest,
		`{"seed":2,"max_turns":999}`:        statusBadRequest,
		`{"seed":2,"current":3}`:            statusNotFound,
		`{"seed":2,"moves":[{"parent":5}]}`: statusNotFound,
		`{"seed":2,"moves":[{"parent":0,"tile":"9z"}]}`: statusBadRequest,
	} {
		if status, v := Restore(store, "", strings.NewReader(body)); status != want {
			t.Errorf("Restore(%s) = %d %v, want %d", body, status, v, want)
		}
	}
}

// TestSessionView reads the view options from a request's query.
func TestSessionView(t *testing.T) {
	for query, want := range map[string]session.View{
		"":                           {},
		"advice=1":                   {},
		"advice=0":                   {NoAdvice: true},
		"tree_from=12":               {TreeFrom: 12},
		"advice=0&tree_from=3&x=y&z": {NoAdvice: true, TreeFrom: 3},
		"tree_from=+3":               {TreeFrom: 3},
		"advice=0&advice=1":          {}, // the last one counts
		"tree_from=2&tree_from=5":    {TreeFrom: 5},
	} {
		if got, err := SessionView(query); err != nil || got != want {
			t.Errorf("SessionView(%q) = %+v, %v; want %+v", query, got, err, want)
		}
	}
	for _, query := range []string{"advice=", "advice=true", "tree_from=-1", "tree_from=", "tree_from=1.5"} {
		if _, err := SessionView(query); Status(err) != statusBadRequest {
			t.Errorf("SessionView(%q): %v, want a 400", query, err)
		}
	}
}
