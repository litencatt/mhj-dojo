package score

import (
	"encoding/json"
	"os"
	"testing"
)

// Golden vectors from the Lean model in formal/ (formal/run.sh vectors).

func loadVectors(t *testing.T, path string, v any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

func TestLeanScoreVectors(t *testing.T) {
	var vs []struct {
		Han, Fu, Yakuman int
		Dealer, Tsumo    bool
		Points
	}
	loadVectors(t, "testdata/lean_score.json", &vs)
	if len(vs) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range vs {
		if got := Compute(v.Han, v.Fu, v.Yakuman, v.Dealer, v.Tsumo); got != v.Points {
			t.Errorf("Compute(%d, %d, %d, dealer=%v, tsumo=%v) = %+v, Lean model %+v",
				v.Han, v.Fu, v.Yakuman, v.Dealer, v.Tsumo, got, v.Points)
		}
	}
}

func TestLeanHalfVectors(t *testing.T) {
	var vs []struct{ V, Half int }
	loadVectors(t, "testdata/lean_half.json", &vs)
	if len(vs) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range vs {
		if got := Half(v.V); got != v.Half {
			t.Errorf("Half(%d) = %d, Lean model %d", v.V, got, v.Half)
		}
	}
}
