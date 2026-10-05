package apicall

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/match"
	"github.com/litencatt/mhj-dojo/internal/session"
)

// BenchmarkPracticeGame plays a practice session to the end per op, as
// web/scripts/wasm-bench.mjs does in the WebAssembly build: create it, then
// discard the advice's best tile (or declare tsumo) on every turn.
func BenchmarkPracticeGame(b *testing.B) {
	store, games := session.NewStore(4), match.NewStore(1)
	do := func(method, path, body string) session.State {
		status, v := Route(store, games, method, path, strings.NewReader(body))
		if status != statusOK {
			b.Fatalf("%s %s: %d %v", method, path, status, v)
		}
		bs, err := json.Marshal(v)
		if err != nil {
			b.Fatal(err)
		}
		var st session.State
		if err := json.Unmarshal(bs, &st); err != nil {
			b.Fatal(err)
		}
		return st
	}
	for seed := 1; b.Loop(); seed = seed%30 + 1 {
		st := do("POST", "/api/sessions", fmt.Sprintf(`{"seed":%d}`, seed))
		base := "/api/sessions/" + st.SessionID
		for st.Status == "playing" {
			if st.CanTsumo {
				st = do("POST", base+"/tsumo", `{}`)
			} else {
				st = do("POST", base+"/discard", fmt.Sprintf(`{"tile":%q}`, st.Advice.Candidates[0].Tile))
			}
		}
	}
}
