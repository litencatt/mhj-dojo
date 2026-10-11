package game

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// A seat with a draw bias draws more tiles that lower its shanten, the
// same round twice draws the same tiles, and the other seats' view of the
// round is unchanged: no event tells of it.
func TestDrawBias(t *testing.T) {
	var useful [2]int // seat 1's draws that lower its shanten, without and with the bias
	for seed := range int64(20) {
		var draws [2][]tile.Tile
		for i, bias := range []int{0, 100, 100} {
			r := dojoRound(seed, SeatConfig{DrawBias: [4]int{1: bias}})
			var got []tile.Tile
			for steps := 0; r.Actor() >= 0; steps++ {
				if steps > 1000 {
					t.Fatal("round does not end")
				}
				seat := r.Actor()
				p := &r.players[seat]
				if seat == 1 && r.phase == PhaseDiscard && p.drawn != nil && !p.rinshan {
					got = append(got, *p.drawn)
					if lowers(p.hand, p.drawn.Kind) {
						useful[min(i, 1)]++
					}
				}
				a := Tsumogiri{}.Decide(r.ViewFor(seat), r.LegalFor(seat))
				a.Seat = seat
				mustApply(t, r, a)
				if slices.ContainsFunc(r.Events(), func(a Action) bool { return a.Type == Summon || a.Type == Redraw }) {
					t.Fatalf("seed %d: the bias shows in the events", seed)
				}
			}
			if i > 0 {
				draws[i-1] = got
			}
		}
		if !slices.Equal(draws[0], draws[1]) {
			t.Fatalf("seed %d: the biased draws differ between two plays", seed)
		}
	}
	// The third play repeats the second: halve its count.
	useful[1] /= 2
	t.Logf("useful draws of seat 1: %d without the bias, %d with it", useful[0], useful[1])
	if useful[1] <= useful[0] {
		t.Errorf("the bias did not help: %d useful draws without, %d with", useful[0], useful[1])
	}
}

// lowers reports whether drawing k lowers the shanten of the 13 tiles hand.
func lowers(hand []tile.Tile, k tile.Kind) bool {
	c := tile.CountsOf(hand)
	before := shanten.Normal(c)
	best := 99
	c[k]++
	for j := range c {
		if c[j] > 0 {
			c[j]--
			best = min(best, shanten.Normal(c))
			c[j]++
		}
	}
	return best < before
}

// Peek shows the seat's view the other seats' concealed tiles, and only
// that seat's.
func TestPeekView(t *testing.T) {
	r := dojoRound(1, SeatConfig{Peek: [4]bool{2: true}})
	if v := r.ViewFor(2); v.Seats[0].Hand == nil || v.Seats[3].Hand == nil {
		t.Fatal("the peeking seat does not see the other hands")
	}
	if v := r.ViewFor(1); v.Seats[0].Hand != nil || v.Seats[2].Hand != nil {
		t.Fatal("another seat sees hands")
	}
}

// The draws a seat's wall peek showed stay its draws: the other seats'
// bias never moves them.
func TestDrawBiasKeepsShownDraws(t *testing.T) {
	for seed := range int64(20) {
		r := dojoRound(seed, SeatConfig{DrawBias: [4]int{1: 100, 2: 100, 3: 100}, WallPeek: [4]int{0: 3}})
		var got []tile.Tile
		shown := map[int]tile.Tile{} // seat 0's draws by number, as first shown
		for steps := 0; r.Actor() >= 0; steps++ {
			if steps > 1000 {
				t.Fatal("round does not end")
			}
			seat := r.Actor()
			if p := &r.players[0]; seat == 0 && r.phase == PhaseDiscard && p.drawn != nil && !p.rinshan {
				if want, ok := shown[len(got)]; ok && want != *p.drawn {
					t.Fatalf("seed %d: draw %d was shown as %v, drew %v", seed, len(got), want, *p.drawn)
				}
				got = append(got, *p.drawn)
				for i, x := range r.NextDraws(0, 3) {
					if _, ok := shown[len(got)+i]; !ok {
						shown[len(got)+i] = x
					}
				}
			}
			a := Tsumogiri{}.Decide(r.ViewFor(seat), r.LegalFor(seat))
			a.Seat = seat
			mustApply(t, r, a)
		}
	}
}
