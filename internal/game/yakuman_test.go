package game

import (
	"testing"

	"github.com/litencatt/mhj2/internal/score"
)

// A double yakuman (四暗刻単騎) settles at twice the yakuman payments, honba
// on top unchanged, and conserves the points.
func TestDoubleYakumanSettlement(t *testing.T) {
	// dealer tsumo: 32000 all
	r := newRound(t)
	r.honba = 1
	setHand(r, 0, "111m222p333s666z5z", "5z")
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	res := r.Result()
	if res.Points.Limit != score.Yakuman || res.Points.Multiplier != 2 || res.Points.FromNonDealer != 32000 || res.Points.Total != 96000 {
		t.Fatalf("dealer tsumo points %+v", res.Points)
	}
	for s := 1; s < 4; s++ {
		if res.HandDeltas[s] != -32000 || res.HonbaDeltas[s] != -honbaTsumo {
			t.Errorf("seat %d: hand %d honba %d", s, res.HandDeltas[s], res.HonbaDeltas[s])
		}
	}
	if totalPoints(r) != 4*StartPoints {
		t.Fatalf("points not conserved: %d", totalPoints(r))
	}
	checkDeltas(t, r, res)

	// non-dealer ron on the dealer's 5z: 64000
	r = newRound(t)
	r.honba = 2
	setHand(r, 1, "111m222p333s666z5z", "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	res = r.Result()
	if res.Points.Multiplier != 2 || res.Points.Ron != 64000 {
		t.Fatalf("non-dealer ron points %+v", res.Points)
	}
	if res.Deltas[0] != -64000-2*honbaRon || res.Deltas[1] != 64000+2*honbaRon {
		t.Errorf("ron deltas %v", res.Deltas)
	}
	if totalPoints(r) != 4*StartPoints {
		t.Fatalf("points not conserved: %d", totalPoints(r))
	}
	checkDeltas(t, r, res)
}
