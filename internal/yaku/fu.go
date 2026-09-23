package yaku

import "github.com/litencatt/mhj2/internal/tile"

// chiitoitsuFu is the fixed fu of seven pairs.
const chiitoitsuFu = 25

// Fu returns the fu of a closed-hand reading, rounded up to a multiple of 10.
// Pinfu scores 20 on a tsumo and 30 on a ron.
func Fu(r Reading, ctx Context) int {
	if IsPinfu(r, ctx) {
		if ctx.Ron {
			return 30
		}
		return 20
	}
	fu := 20
	if ctx.Ron {
		fu += 10 // closed ron
	} else {
		fu += 2 // tsumo
	}
	switch r.Wait {
	case Kanchan, Penchan, Tanki:
		fu += 2
	}
	fu += pairFu(r.Pair, ctx)
	for i, m := range r.Melds {
		if m.Type != Trip {
			continue
		}
		v := 2
		if m.Kind.IsYaochu() {
			v *= 2
		}
		if !r.ronCompleted(i, ctx) { // concealed triplet
			v *= 2
		}
		fu += v
	}
	return (fu + 9) / 10 * 10
}

// pairFu is 2 per reason the pair is a value pair: a dragon, the round wind
// and the seat wind (a double wind pair is 4).
func pairFu(k tile.Kind, ctx Context) int {
	fu := 0
	if k >= tile.Haku {
		fu += 2
	}
	if k == ctx.RoundWind {
		fu += 2
	}
	if k == ctx.SeatWind {
		fu += 2
	}
	return fu
}
