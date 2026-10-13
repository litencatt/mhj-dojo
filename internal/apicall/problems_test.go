package apicall

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/problem"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// TestProblemRoutes asks for a problem and answers it through Route, as the
// page's engine does (docs/api.md "Problems").
func TestProblemRoutes(t *testing.T) {
	store := session.NewStore(256)
	status, b := call(t, store, "POST", "/api/problems", `{"kind":"nanikiru","level":1,"seed":42}`)
	if status != statusOK {
		t.Fatalf("create: %d %s", status, b)
	}
	if strings.Contains(string(b), "answer") || strings.Contains(string(b), "best") {
		t.Fatalf("the problem shows its answer: %s", b)
	}
	var p problem.Problem
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	if p.ID != "nanikiru:1:42" || p.Seed != 42 || p.Choose != "one" || len(p.Position.Hand) != 13 || p.Position.Drawn == nil {
		t.Fatalf("create: %s", b)
	}

	answer := func(tile string) problem.Result {
		t.Helper()
		status, b := call(t, store, "POST", "/api/problems/answer", `{"id":"`+p.ID+`","answer":["`+tile+`"]}`)
		if status != statusOK {
			t.Fatalf("answer %s: %d %s", tile, status, b)
		}
		var r problem.Result
		if err := json.Unmarshal(b, &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	r := answer(*p.Position.Drawn)
	best := answer(r.Best[0])
	if !best.Correct || best.ID != p.ID || best.Text == "" || len(best.Ranking) == 0 {
		t.Fatalf("best answer: %+v", best)
	}
	worst := r.Ranking[len(r.Ranking)-1]
	if w := answer(worst.Tile); w.Correct || w.Answer[0].Rank != worst.Rank {
		t.Fatalf("worst answer: %+v", w)
	}

	// No seed: a random one, shown in the problem.
	status, b = call(t, store, "POST", "/api/problems", `{"kind":"nanikiru","level":2}`)
	if err := json.Unmarshal(b, &p); err != nil || status != statusOK || p.ID == "" {
		t.Fatalf("random seed: %d %s", status, b)
	}
}

func TestProblemErrors(t *testing.T) {
	store := session.NewStore(256)
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{"POST", "/api/problems", ``, statusBadRequest},
		{"POST", "/api/problems", `{"kind":"oshihiki","level":1}`, statusBadRequest},
		{"POST", "/api/problems", `{"kind":"nanikiru"}`, statusBadRequest},
		{"POST", "/api/problems", `{"kind":"nanikiru","level":4}`, statusBadRequest},
		{"POST", "/api/problems/answer", `{"id":"nanikiru:1","answer":["1m"]}`, statusBadRequest},
		{"POST", "/api/problems", `{"kind":"nanikiru","level":1,"seed":-1}`, statusBadRequest},
		{"POST", "/api/problems", `{"kind":"nanikiru","level":1,"seed":9007199254740992}`, statusBadRequest},
		{"POST", "/api/problems/answer", `{"id":"nanikiru:01:42","answer":["1m"]}`, statusBadRequest},
		{"POST", "/api/problems/answer", `{"id":"nanikiru:1:42","answer":["xx"]}`, statusBadRequest},
		{"POST", "/api/problems/answer", `{"id":"nanikiru:1:42","answer":[]}`, statusBadRequest},
		{"POST", "/api/problems/answer", `{"id":"nanikiru:1:42","answer":["7z"]}`, statusBadRequest}, // not in the hand
		{"GET", "/api/problems", ``, statusNotFound},
		{"POST", "/api/problems/x", `{}`, statusNotFound},
	} {
		status, b := call(t, store, c.method, c.path, c.body)
		if status != c.status {
			t.Errorf("%s %s %s: %d, want %d (%s)", c.method, c.path, c.body, status, c.status, b)
		}
	}
}
