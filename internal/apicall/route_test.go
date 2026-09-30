package apicall

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

// The practice API's behaviour through Route, as the WebAssembly build
// calls it (moved here from internal/server's HTTP tests, issue #147): the
// JSON shapes of docs/api.md, a session's moves and branches, node_id's
// stale-tab guard, and the errors' statuses.

// client sends requests through Route, as the page's engine does.
type client struct {
	t     *testing.T
	store *session.Store
	games *match.Store
}

func newClient(t *testing.T, store *session.Store) *client {
	return &client{t: t, store: store, games: match.NewStore()}
}

// do returns the status and the JSON body of a request.
func (c *client) do(method, path, body string) (int, []byte) {
	c.t.Helper()
	status, v := Route(c.store, c.games, method, path, strings.NewReader(body))
	b, err := json.Marshal(v)
	if err != nil {
		c.t.Fatal(err)
	}
	return status, b
}

func (c *client) state(method, path, body string) session.State {
	c.t.Helper()
	code, b := c.do(method, path, body)
	if code != http.StatusOK {
		c.t.Fatalf("%s %s: %d %s", method, path, code, b)
	}
	var st session.State
	if err := json.Unmarshal(b, &st); err != nil {
		c.t.Fatal(err)
	}
	return st
}

func (c *client) wantError(method, path, body string, status int) {
	c.t.Helper()
	code, b := c.do(method, path, body)
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
	_, b := c.do("POST", "/api/sessions", `{"seed": 42}`)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{
		"session_id", "seed", "max_turns", "round_wind", "seat_wind", "node_id", "turn", "status",
		"hand", "hand_groups", "drawn", "discards", "dora_indicators", "dora", "ura_dora_indicators", "ura_dora", "wall_remaining", "can_tsumo",
		"analysis", "by_discard", "combos", "combos_by_discard", "history", "tree", "win", "advice", "discard_review",
	} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing key %q", k)
		}
	}
	if string(raw["win"]) != "null" || string(raw["discards"]) != "[]" || !bytes.HasPrefix(raw["by_discard"], []byte("{")) {
		t.Errorf("win=%s discards=%s", raw["win"], raw["discards"])
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(raw["analysis"], &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 30 {
		t.Fatalf("%d rows", len(rows))
	}
	for _, k := range []string{"key", "name", "yakuman", "han", "shanten", "approx", "ukeire", "ukeire_total"} {
		if _, ok := rows[0][k]; !ok {
			t.Errorf("row missing %q", k)
		}
	}
	if string(rows[0]["han"]) != "0" || string(rows[1]["han"]) != "1" || string(rows[21]["han"]) != "13" {
		t.Errorf("han: normal=%s tanyao=%s kokushi=%s", rows[0]["han"], rows[1]["han"], rows[21]["han"])
	}
	if string(rows[0]["yakuman"]) != "false" || string(rows[21]["key"]) != `"kokushi"` || string(rows[21]["yakuman"]) != "true" {
		t.Errorf("yakuman flags: %s %s %s", rows[0]["yakuman"], rows[21]["key"], rows[21]["yakuman"])
	}
	var combos []map[string]json.RawMessage
	if err := json.Unmarshal(raw["combos"], &combos); err != nil {
		t.Fatal(err)
	}
	if len(combos) == 0 || len(combos) > 5 {
		t.Fatalf("%d combos", len(combos))
	}
	for _, k := range []string{"keys", "name", "han", "shanten", "approx", "ukeire", "ukeire_total"} {
		if _, ok := combos[0][k]; !ok {
			t.Errorf("combo missing %q", k)
		}
	}
	var combosBy map[string][]map[string]json.RawMessage
	if err := json.Unmarshal(raw["combos_by_discard"], &combosBy); err != nil || len(combosBy) == 0 {
		t.Errorf("combos_by_discard = %s (%v)", raw["combos_by_discard"], err)
	}
	var hist []map[string]json.RawMessage
	if err := json.Unmarshal(raw["history"], &hist); err != nil {
		t.Fatal(err)
	}
	if string(hist[0]["draw"]) != "null" || string(hist[0]["discard"]) != "null" {
		t.Errorf("root history entry: %v", hist[0])
	}
	var tree []map[string]json.RawMessage
	if err := json.Unmarshal(raw["tree"], &tree); err != nil {
		t.Fatal(err)
	}
	if string(tree[0]["parent_id"]) != "null" {
		t.Errorf("root parent_id = %s", tree[0]["parent_id"])
	}
	checkAdviceContract(t, raw)
}

// checkAdviceContract checks the keys of a playing root state's advice
// (docs/api.md "Advice") and that it has no discard_review.
func checkAdviceContract(t *testing.T, raw map[string]json.RawMessage) {
	t.Helper()
	if string(raw["discard_review"]) != "null" {
		t.Errorf("root discard_review = %s", raw["discard_review"])
	}
	var adv map[string]json.RawMessage
	if err := json.Unmarshal(raw["advice"], &adv); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"candidates", "junme", "phase", "guideline", "draws_left", "tenpai_chance", "win_chance", "shape", "near_yaku", "notes"} {
		if _, ok := adv[k]; !ok {
			t.Errorf("advice missing %q", k)
		}
	}
	var cands []map[string]json.RawMessage
	if err := json.Unmarshal(adv["candidates"], &cands); err != nil {
		t.Fatal(err)
	}
	if len(cands) != 3 {
		t.Fatalf("%d candidates", len(cands))
	}
	for _, k := range []string{"tile", "shanten", "ukeire_kinds", "ukeire", "wait", "yaku"} {
		if _, ok := cands[0][k]; !ok {
			t.Errorf("candidate missing %q", k)
		}
	}
}

func TestDiscardReviewContract(t *testing.T) {
	c := newClient(t, session.NewStore())
	root := c.state("POST", "/api/sessions", `{"seed": 42, "max_turns": 1}`)
	_, b := c.do("POST", "/api/sessions/"+root.SessionID+"/discard", `{"tile": "`+root.Advice.Candidates[0].Tile+`"}`)
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	// Exhausted: no advice, but the review of the last discard.
	if string(raw["advice"]) != "null" {
		t.Errorf("advice = %s", raw["advice"])
	}
	var r map[string]json.RawMessage
	if err := json.Unmarshal(raw["discard_review"], &r); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"tile", "best", "rank", "is_best", "shanten", "best_shanten", "ukeire", "best_ukeire", "text"} {
		if _, ok := r[k]; !ok {
			t.Errorf("discard_review missing %q", k)
		}
	}
	if string(r["is_best"]) != "true" || string(r["rank"]) != "1" {
		t.Errorf("review of the recommended discard: %s", raw["discard_review"])
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

// TestSessionNodeIDGuard covers the optional node_id on discard/tsumo
// (issue #53): it lets a stale tab that acted from an earlier node detect
// that another tab already moved the session on, instead of silently
// discarding against whatever node happens to be current.
func TestSessionNodeIDGuard(t *testing.T) {
	c := newClient(t, session.NewStore())
	root := c.state("POST", "/api/sessions", `{"seed": 1}`)
	base := "/api/sessions/" + root.SessionID
	drawn := *root.Drawn

	// match: node_id names the current node, so the discard applies.
	n1 := c.state("POST", base+"/discard", `{"tile":"`+drawn+`","node_id":`+strconv.Itoa(root.NodeID)+`}`)
	if n1.NodeID != 1 {
		t.Fatalf("match: node %d, want 1", n1.NodeID)
	}

	// mismatch: node_id still names the now-stale root node, as if another
	// tab (this test's own first request) had already moved the session on.
	// The server rejects it (409) and makes no change.
	c.wantError("POST", base+"/discard", `{"tile":"`+*n1.Drawn+`","node_id":`+strconv.Itoa(root.NodeID)+`}`, http.StatusConflict)
	unchanged := c.state("GET", base, "")
	if unchanged.NodeID != n1.NodeID || len(unchanged.Tree) != len(n1.Tree) {
		t.Fatalf("mismatch discard changed state: before %+v after %+v", n1, unchanged)
	}

	// absent: no node_id keeps today's behaviour (applies regardless).
	n2 := c.state("POST", base+"/discard", `{"tile":"`+*n1.Drawn+`"}`)
	if n2.NodeID != 2 {
		t.Fatalf("absent: node %d, want 2", n2.NodeID)
	}
}

// TestTsumoNodeIDGuard is TestSessionNodeIDGuard for tsumo.
func TestTsumoNodeIDGuard(t *testing.T) {
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
	root := c.state("GET", base, "")
	if !root.CanTsumo {
		t.Fatalf("expected can_tsumo: %+v", root)
	}

	// mismatch: node_id names a node other than the current one.
	c.wantError("POST", base+"/tsumo", `{"node_id":`+strconv.Itoa(root.NodeID+1)+`}`, http.StatusConflict)
	unchanged := c.state("GET", base, "")
	if unchanged.NodeID != root.NodeID || unchanged.Status != session.StatusPlaying {
		t.Fatalf("mismatch tsumo changed state: before %+v after %+v", root, unchanged)
	}

	// match: node_id equals the current node, so the tsumo applies.
	win := c.state("POST", base+"/tsumo", `{"node_id":`+strconv.Itoa(root.NodeID)+`}`)
	if win.Status != session.StatusTsumo || win.Win == nil {
		t.Fatalf("match: %+v", win)
	}
}

// checkHandGroups fails unless groups index hand exactly once each, with
// known block types.
func checkHandGroups(t *testing.T, hand []string, groups []apiview.HandGroup) {
	t.Helper()
	seen := make([]bool, len(hand))
	for _, g := range groups {
		switch g.Type {
		case "seq", "trip", "pair", "ryanmen", "kanchan", "penchan", "toitsu", "float":
		default:
			t.Fatalf("hand %v: group type %q", hand, g.Type)
		}
		if len(g.Tiles) == 0 {
			t.Fatalf("hand %v: empty %s group", hand, g.Type)
		}
		for _, i := range g.Tiles {
			if i < 0 || i >= len(hand) || seen[i] {
				t.Fatalf("hand %v: groups %+v: index %d out of range or repeated", hand, groups, i)
			}
			seen[i] = true
		}
	}
	for i, ok := range seen {
		if !ok {
			t.Fatalf("hand %v: groups %+v miss index %d", hand, groups, i)
		}
	}
}

func TestSessionHandGroups(t *testing.T) {
	c := newClient(t, session.NewStore())
	s := c.state("POST", "/api/sessions", `{"seed": 7}`)
	base := "/api/sessions/" + s.SessionID
	for s.Status == session.StatusPlaying {
		checkHandGroups(t, s.Hand, s.HandGroups)
		s = c.state("POST", base+"/discard", `{"tile":"`+*s.Drawn+`"}`)
	}
	checkHandGroups(t, s.Hand, s.HandGroups)
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

func TestRequestErrors(t *testing.T) {
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

// TestRouteStatuses runs the requests the HTTP server and Route were once
// checked to answer alike (issue #147 moved the server's API out): each
// status, and a JSON error body on every failure.
func TestRouteStatuses(t *testing.T) {
	c := newClient(t, session.NewStore())
	create := `{"seed":1,"max_turns":6}`
	c.state("POST", "/api/sessions?advice=0&tree_from=1", create)
	st := c.state("POST", "/api/sessions", create)
	base := "/api/sessions/" + st.SessionID
	drawn, first := *st.Drawn, st.Hand[0]
	g, _ := c.game("POST", "/api/games", `{"seed":7,"cpu":"weak","first_dealer":"you"}`)
	game := "/api/games/" + g.GameID

	for _, r := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", base, "", http.StatusOK},
		{"POST", base + "/discard", `{"tile":"` + drawn + `","node_id":0}`, http.StatusOK},
		{"POST", base + "/discard", `{"tile":"` + first + `","node_id":0}`, http.StatusConflict}, // stale
		{"POST", base + "/goto", `{"node_id":0}`, http.StatusOK},
		{"POST", base + "/discard", `{"tile":"` + first + `"}`, http.StatusOK},
		{"POST", base + "/goto", `{"node_id":1}`, http.StatusOK},
		{"POST", base + "/discard", `{"tile":"` + drawn + `","node_id":0}`, http.StatusConflict},
		{"POST", base + "/tsumo", "", http.StatusConflict},
		{"POST", base + "/tsumo", `{"node_id":1}`, http.StatusConflict},
		{"POST", base + "/discard", "", http.StatusBadRequest},
		{"POST", base + "/discard", "{}", http.StatusBadRequest},
		{"POST", base + "/discard", "{", http.StatusBadRequest},
		{"POST", base + "/discard", `{"tile":"9z"}`, http.StatusBadRequest},
		{"POST", base + "/goto", "{}", http.StatusBadRequest},
		{"POST", base + "/goto", `{"node_id":99}`, http.StatusNotFound},
		{"POST", "/api/sessions", `{"max_turns":999}`, http.StatusBadRequest},
		{"POST", "/api/sessions", `{"seed":"x"}`, http.StatusBadRequest},
		{"GET", "/api/sessions/nope", "", http.StatusNotFound},
		{"POST", "/api/sessions/nope/discard", `{"tile":"1m"}`, http.StatusNotFound},
		// View options: a discard without the advice leaves its review to
		// the next state shown with it.
		{"POST", base + "/goto?advice=0&tree_from=3", `{"node_id":0}`, http.StatusOK},
		{"POST", base + "/discard?advice=0&tree_from=3", `{"tile":"` + st.Hand[1] + `"}`, http.StatusOK},
		{"GET", base + "?tree_from=2", "", http.StatusOK},
		{"GET", base + "?advice=1&tree_from=99&other=x", "", http.StatusOK},
		{"POST", base + "/tsumo?advice=0", "", http.StatusConflict},
		{"GET", base + "?advice=2", "", http.StatusBadRequest},
		{"GET", base + "?tree_from=-1", "", http.StatusBadRequest},
		{"GET", base + "?tree_from=x", "", http.StatusBadRequest},
		{"POST", "/api/sessions?tree_from=", create, http.StatusBadRequest},
		{"GET", "/api/sessions/nope?advice=2", "", http.StatusNotFound},
		{"GET", "/api/version?advice=0", "", http.StatusOK},
		// Unknown paths, wrong methods and trailing slashes.
		{"GET", "/api/sessions", "", http.StatusNotFound},
		{"PUT", "/api/sessions", "{}", http.StatusNotFound},
		{"GET", "/api/sessions/", "", http.StatusNotFound},
		{"POST", base, "{}", http.StatusNotFound},
		{"GET", base + "/", "", http.StatusNotFound},
		{"GET", base + "/discard", "", http.StatusNotFound},
		{"POST", base + "/discard/", `{"tile":"1m"}`, http.StatusNotFound},
		{"POST", base + "/undo", "{}", http.StatusNotFound},
		{"GET", "/api/sessionsx", "", http.StatusNotFound},
		{"GET", "/api/nothing", "", http.StatusNotFound},
		{"GET", "/api/version", "", http.StatusOK},
		{"POST", "/api/version", "{}", http.StatusNotFound},
		{"GET", "/api/version/", "", http.StatusNotFound},
		// The game's.
		{"GET", game, "", http.StatusOK},
		{"POST", game + "/action", "", http.StatusBadRequest},
		{"POST", game + "/action", "{", http.StatusBadRequest},
		{"POST", game + "/action", `{"type":"fly"}`, http.StatusBadRequest},
		{"POST", game + "/action", `{"type":"discard"}`, http.StatusBadRequest},
		{"POST", game + "/action", `{"type":"chii","tiles":["1m"]}`, http.StatusBadRequest},
		{"POST", game + "/action", `{"type":"discard","tile":"9z"}`, http.StatusBadRequest},
		{"POST", game + "/action", `{"type":"ron"}`, http.StatusConflict},
		{"POST", game + "/action", `{"type":"next"}`, http.StatusConflict},
		{"POST", "/api/games", `{"length":"x"}`, http.StatusBadRequest},
		{"POST", "/api/games", `{"cpu":"strong"}`, http.StatusBadRequest},
		{"POST", "/api/games", `{"seed":"x"}`, http.StatusBadRequest},
		{"GET", "/api/games/nope", "", http.StatusNotFound},
		{"POST", "/api/games/nope/action", `{"type":"skip"}`, http.StatusNotFound},
		{"GET", "/api/games", "", http.StatusNotFound},
		{"PUT", "/api/games", "{}", http.StatusNotFound},
		{"GET", "/api/games/", "", http.StatusNotFound},
		{"POST", game, "{}", http.StatusNotFound},
		{"GET", game + "/", "", http.StatusNotFound},
		{"GET", game + "/action", "", http.StatusNotFound},
		{"POST", game + "/action/", `{"type":"skip"}`, http.StatusNotFound},
		{"POST", game + "/undo", "{}", http.StatusNotFound},
		{"GET", "/api/gamesx", "", http.StatusNotFound},
	} {
		code, b := c.do(r.method, r.path, r.body)
		if code != r.status {
			t.Errorf("%s %s %s: %d, want %d (%.200s)", r.method, r.path, r.body, code, r.status, b)
		}
		var e struct{ Error *string }
		if err := json.Unmarshal(b, &e); err != nil || (code == http.StatusOK) != (e.Error == nil) || (e.Error != nil && *e.Error == "") {
			t.Errorf("%s %s %s: %d body %.200s", r.method, r.path, r.body, code, b)
		}
	}
}
