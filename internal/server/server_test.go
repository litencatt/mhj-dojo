package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/litencatt/mhj2/internal/session"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
)

type client struct {
	t   *testing.T
	srv *httptest.Server
}

func newClient(t *testing.T, store *session.Store) *client {
	static := fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>mhj2</title>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	}
	srv := httptest.NewServer(NewWithFS(store, static))
	t.Cleanup(srv.Close)
	return &client{t: t, srv: srv}
}

func (c *client) do(method, path, body string) (int, []byte, http.Header) {
	c.t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, r)
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b, res.Header
}

func (c *client) state(method, path, body string) session.State {
	c.t.Helper()
	code, b, h := c.do(method, path, body)
	if code != http.StatusOK {
		c.t.Fatalf("%s %s: %d %s", method, path, code, b)
	}
	if ct := h.Get("Content-Type"); ct != "application/json" {
		c.t.Fatalf("content-type %q", ct)
	}
	var st session.State
	if err := json.Unmarshal(b, &st); err != nil {
		c.t.Fatal(err)
	}
	return st
}

func (c *client) wantError(method, path, body string, status int) {
	c.t.Helper()
	code, b, _ := c.do(method, path, body)
	if code != status {
		c.t.Fatalf("%s %s: status %d, want %d (%s)", method, path, code, status, b)
	}
	var e map[string]string
	if err := json.Unmarshal(b, &e); err != nil || e["error"] == "" {
		c.t.Fatalf("%s %s: error body %q", method, path, b)
	}
}

// TestStateContract checks the raw JSON shape against docs/api.md.
func TestStateContract(t *testing.T) {
	c := newClient(t, session.NewStore())
	_, b, _ := c.do("POST", "/api/sessions", `{"seed": 42}`)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{
		"session_id", "seed", "max_turns", "round_wind", "seat_wind", "node_id", "turn", "status",
		"hand", "drawn", "discards", "dora_indicators", "wall_remaining", "can_tsumo",
		"analysis", "by_discard", "history", "tree", "win",
	} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing key %q", k)
		}
	}
	if string(raw["win"]) != "null" || string(raw["discards"]) != "[]" || !bytes.HasPrefix(raw["by_discard"], []byte("{")) {
		t.Errorf("win=%s discards=%s", raw["win"], raw["discards"])
	}
	var rows []map[string]json.RawMessage
	json.Unmarshal(raw["analysis"], &rows)
	if len(rows) != 18 {
		t.Fatalf("%d rows", len(rows))
	}
	for _, k := range []string{"key", "name", "shanten", "approx", "ukeire", "ukeire_total"} {
		if _, ok := rows[0][k]; !ok {
			t.Errorf("row missing %q", k)
		}
	}
	var hist []map[string]json.RawMessage
	json.Unmarshal(raw["history"], &hist)
	if string(hist[0]["draw"]) != "null" || string(hist[0]["discard"]) != "null" {
		t.Errorf("root history entry: %v", hist[0])
	}
	var tree []map[string]json.RawMessage
	json.Unmarshal(raw["tree"], &tree)
	if string(tree[0]["parent_id"]) != "null" {
		t.Errorf("root parent_id = %s", tree[0]["parent_id"])
	}
}

func TestCreateDiscardGotoBranch(t *testing.T) {
	c := newClient(t, session.NewStore())
	root := c.state("POST", "/api/sessions", `{"seed": 42, "max_turns": 3}`)
	if root.Seed != 42 || root.MaxTurns != 3 || root.Drawn == nil {
		t.Fatalf("create: %+v", root)
	}
	base := "/api/sessions/" + root.SessionID

	got := c.state("GET", base, "")
	if got.NodeID != 0 || got.Hand[0] != root.Hand[0] {
		t.Fatal("GET should return the current node")
	}

	drawn := *root.Drawn
	n1 := c.state("POST", base+"/discard", `{"tile":"`+drawn+`"}`)
	if n1.NodeID != 1 || n1.Turn != 1 || n1.Discards[0] != drawn || len(n1.History) != 2 {
		t.Fatalf("discard: %+v", n1)
	}

	back := c.state("POST", base+"/goto", `{"node_id": 0}`)
	if back.NodeID != 0 || len(back.Tree) != 2 {
		t.Fatalf("goto: %+v", back)
	}
	other := root.Hand[0]
	if other == drawn {
		other = root.Hand[12]
	}
	n2 := c.state("POST", base+"/discard", `{"tile":"`+other+`"}`)
	if n2.NodeID != 2 || len(n2.Tree) != 3 {
		t.Fatalf("branch: node %d, %d tree nodes", n2.NodeID, len(n2.Tree))
	}
	for _, n := range n2.Tree[1:] {
		if n.ParentID == nil || *n.ParentID != 0 {
			t.Fatalf("both branches should hang off the root: %+v", n)
		}
	}
	// The original branch is still reachable.
	if s := c.state("POST", base+"/goto", `{"node_id": 1}`); s.NodeID != 1 || s.Discards[0] != drawn {
		t.Fatal("branch 1 lost")
	}

	// Play to the turn limit.
	s := n2
	c.state("POST", base+"/goto", `{"node_id": 2}`)
	for s.Status == session.StatusPlaying {
		s = c.state("POST", base+"/discard", `{"tile":"`+*s.Drawn+`"}`)
	}
	if s.Status != session.StatusExhausted || s.Turn != 3 || s.Drawn != nil || len(s.ByDiscard) != 0 {
		t.Fatalf("exhausted: %+v", s)
	}
	c.wantError("POST", base+"/discard", `{"tile":"`+s.Hand[0]+`"}`, http.StatusConflict)
	c.wantError("POST", base+"/tsumo", "", http.StatusConflict)
}

func TestTsumoFlow(t *testing.T) {
	store := session.NewStore()
	w, err := wall.WithFront(1, tile.MustParseHand("123m456p789s1122z1z"))
	if err != nil {
		t.Fatal(err)
	}
	s, err := store.CreateWithWall(w, 0)
	if err != nil {
		t.Fatal(err)
	}
	c := newClient(t, store)
	base := "/api/sessions/" + s.ID()
	st := c.state("GET", base, "")
	if !st.CanTsumo {
		t.Fatalf("can_tsumo false with drawn %v", *st.Drawn)
	}
	win := c.state("POST", base+"/tsumo", "")
	if win.Status != session.StatusTsumo || win.Win == nil {
		t.Fatalf("tsumo: %+v", win)
	}
	var keys []string
	for _, y := range win.Win.Yaku {
		keys = append(keys, y.Key)
	}
	if strings.Join(keys, ",") != "tsumo,ton" || win.Win.HanTotal < 3 {
		t.Fatalf("yaku %v han %d", keys, win.Win.HanTotal)
	}
	// Back to the root, tsumogiri, and tsumo is refused.
	c.state("POST", base+"/goto", `{"node_id": 0}`)
	c.state("POST", base+"/discard", `{"tile":"1z"}`)
	c.wantError("POST", base+"/tsumo", "", http.StatusConflict)
}

func TestErrors(t *testing.T) {
	c := newClient(t, session.NewStore())
	st := c.state("POST", "/api/sessions", "")
	base := "/api/sessions/" + st.SessionID
	c.wantError("GET", "/api/sessions/nope", "", http.StatusNotFound)
	c.wantError("POST", "/api/sessions/nope/discard", `{"tile":"1m"}`, http.StatusNotFound)
	c.wantError("POST", "/api/sessions", `{"max_turns": 500}`, http.StatusBadRequest)
	c.wantError("POST", "/api/sessions", `{"seed": "x"}`, http.StatusBadRequest)
	c.wantError("POST", base+"/discard", `{"tile":"9z"}`, http.StatusBadRequest)
	c.wantError("POST", base+"/discard", `{}`, http.StatusBadRequest)
	c.wantError("POST", base+"/discard", ``, http.StatusBadRequest)
	c.wantError("POST", base+"/discard", `not json`, http.StatusBadRequest)
	c.wantError("POST", base+"/goto", `{"node_id": 42}`, http.StatusNotFound)
	c.wantError("POST", base+"/goto", `{}`, http.StatusBadRequest)
	c.wantError("GET", "/api/unknown", "", http.StatusNotFound)
	c.wantError("DELETE", base, "", http.StatusNotFound)
}

func TestStaticAndSPAFallback(t *testing.T) {
	c := newClient(t, session.NewStore())
	for path, want := range map[string]string{
		"/":              "<!doctype html>",
		"/some/spa/path": "<!doctype html>",
		"/assets/app.js": "console.log",
	} {
		code, b, _ := c.do("GET", path, "")
		if code != http.StatusOK || !strings.HasPrefix(string(b), want) {
			t.Errorf("GET %s: %d %q", path, code, b)
		}
	}
	if code, _, _ := c.do("POST", "/", "x"); code != http.StatusMethodNotAllowed {
		t.Errorf("POST /: %d", code)
	}
}

func TestEmbeddedFrontend(t *testing.T) {
	srv := httptest.NewServer(New(session.NewStore()))
	defer srv.Close()
	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.Contains(strings.ToLower(string(b)), "<html") {
		t.Fatalf("embedded index: %d %q", res.StatusCode, b)
	}
}

func TestGuards(t *testing.T) {
	c := newClient(t, session.NewStore())
	send := func(method, host, contentType, body string) int {
		req, _ := http.NewRequest(method, c.srv.URL+"/api/sessions", strings.NewReader(body))
		if host != "" {
			req.Host = host
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	for _, tc := range []struct {
		method, host, ct string
		want             int
	}{
		{"POST", "", "application/json", http.StatusOK},
		{"POST", "", "application/json; charset=utf-8", http.StatusOK},
		{"POST", "localhost:8765", "application/json", http.StatusOK},
		{"POST", "[::1]:8765", "application/json", http.StatusOK},
		{"POST", "127.0.0.1", "application/json", http.StatusOK},
		{"POST", "", "", http.StatusUnsupportedMediaType},
		{"POST", "", "text/plain", http.StatusUnsupportedMediaType},
		{"POST", "", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType},
		{"POST", "evil.example:8765", "application/json", http.StatusForbidden},
		{"GET", "evil.example", "", http.StatusForbidden},
		{"POST", "192.168.1.10:8765", "application/json", http.StatusForbidden},
	} {
		if got := send(tc.method, tc.host, tc.ct, "{}"); got != tc.want {
			t.Errorf("%s host=%q ct=%q: %d, want %d", tc.method, tc.host, tc.ct, got, tc.want)
		}
	}
}
