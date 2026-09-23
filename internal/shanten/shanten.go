package shanten

import "github.com/litencatt/mhj2/internal/tile"

// Result is a shanten value with the kinds that lower it.
type Result struct {
	Shanten int // 0 = tenpai, -1 = complete
	Ukeire  []tile.Kind
}

// Normal returns the 4 melds + pair shanten of a 13- or 14-tile hand.
func Normal(c tile.Counts) int {
	return NewEngine().Evaluate(&c, &NormalTarget).Dist - 1
}

// NormalResult returns the normal shanten and ukeire of a 13-tile hand.
func NormalResult(c tile.Counts) Result {
	ev := NewEngine().Evaluate(&c, &NormalTarget)
	var set [tile.NumKinds]bool
	ev.Ukeire(&set)
	return Result{Shanten: ev.Dist - 1, Ukeire: kinds(&set)}
}

// Chiitoitsu returns the seven-pairs shanten and ukeire of a 13-tile hand.
// Four of a kind counts as one pair only (pairs must be distinct kinds).
func Chiitoitsu(c tile.Counts) Result {
	pairs, singles := 0, 0
	for _, n := range c {
		switch {
		case n >= 2:
			pairs++
		case n == 1:
			singles++
		}
	}
	var set [tile.NumKinds]bool
	var dist int
	if pairs+singles >= 7 {
		dist = 7 - pairs
	} else {
		dist = singles + 2*(7-pairs-singles)
	}
	if dist > 0 {
		for k, n := range c {
			// Singles always belong to some optimal target; empty kinds only
			// when there are not enough singles to fill seven kinds.
			if n == 1 || (n == 0 && pairs+singles < 7) {
				set[k] = true
			}
		}
	}
	return Result{Shanten: dist - 1, Ukeire: kinds(&set)}
}

// Kokushi returns the thirteen-orphans shanten and ukeire of a 13-tile hand.
func Kokushi(c tile.Counts) Result {
	held, pair := 0, false
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if !k.IsYaochu() {
			continue
		}
		if c[k] > 0 {
			held++
		}
		if c[k] >= 2 {
			pair = true
		}
	}
	dist := 13 - held + 1
	if pair {
		dist--
	}
	var set [tile.NumKinds]bool
	if dist > 0 {
		for k := tile.Kind(0); k < tile.NumKinds; k++ {
			if k.IsYaochu() && (c[k] == 0 || !pair) && c[k] < 4 {
				set[k] = true
			}
		}
	}
	return Result{Shanten: dist - 1, Ukeire: kinds(&set)}
}

func kinds(set *[tile.NumKinds]bool) []tile.Kind {
	var out []tile.Kind
	for k, ok := range set {
		if ok {
			out = append(out, tile.Kind(k))
		}
	}
	return out
}
