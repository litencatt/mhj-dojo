package yaku

import "github.com/litencatt/mhj2/internal/tile"

// chiitoitsuFu is the fixed fu of seven pairs.
const chiitoitsuFu = 25

// Fu returns the fu of a reading, rounded up to a multiple of 10. Pinfu
// scores 20 on a tsumo and 30 on a ron; an open hand without any fu (the
// pinfu shape) scores 30.
func Fu(r Reading, ctx Context) int {
	if IsPinfu(r, ctx) {
		if ctx.Ron {
			return 30
		}
		return 20
	}
	open := ctx.Open()
	fu := 20
	switch {
	case !ctx.Ron:
		fu += 2 // tsumo
	case !open:
		fu += 10 // closed ron
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
		v := 2 // open simple triplet
		if m.Kind.IsYaochu() {
			v *= 2
		}
		if r.concealed(i, ctx) {
			v *= 2
		}
		if m.Kan {
			v *= 4
		}
		fu += v
	}
	if open && fu == 20 {
		return 30 // open pinfu shape
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
	return fu + 2*ctx.Winds.Count(k)
}
