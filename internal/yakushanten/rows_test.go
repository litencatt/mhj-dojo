package yakushanten

import (
	"testing"

	"github.com/litencatt/mhj2/internal/yaku"
)

// Every row's han comes from the win evaluator, so the table and the
// scoring cannot disagree.
func TestRowsHaveClosedHan(t *testing.T) {
	for _, r := range Rows {
		h := yaku.ClosedHan(r.Key)
		switch {
		case r.Key == "normal":
			if h != 0 {
				t.Errorf("normal: han %d, want 0", h)
			}
		case r.Yakuman:
			if h != 13 {
				t.Errorf("%s: yakuman han %d, want 13", r.Key, h)
			}
		case h < 1 || h > 6:
			t.Errorf("%s: han %d, want 1..6", r.Key, h)
		}
	}
	for key, want := range map[string]int{"tanyao": 1, "chiitoitsu": 2, "ryanpeikou": 3, "chinitsu": 6, "ton": 2} {
		if got := yaku.ClosedHan(key); got != want {
			t.Errorf("%s: han %d, want %d", key, got, want)
		}
	}
}
