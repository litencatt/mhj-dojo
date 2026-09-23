// Package score turns han and fu into points (no honba; kiriage mangan off).
package score

import "github.com/litencatt/mhj2/internal/yaku"

// Limit names a limit hand; "" is a hand scored by fu.
type Limit string

// Limit hands.
const (
	None      Limit = ""
	Mangan    Limit = "mangan"
	Haneman   Limit = "haneman"
	Baiman    Limit = "baiman"
	Sanbaiman Limit = "sanbaiman"
	Yakuman   Limit = "yakuman" // also counted yakuman (13+ han)
)

// Points is what a win is worth and who pays it.
type Points struct {
	Limit Limit `json:"limit"`
	// Multiplier is the number of yakuman (2 for a double yakuman), else 0.
	Multiplier int `json:"multiplier"`
	// Total is what the winner receives (before riichi sticks).
	Total int `json:"total"`
	// Ron is paid by the discarder on a ron.
	Ron int `json:"ron,omitempty"`
	// On a tsumo, FromDealer is paid by the dealer (0 when the winner is the
	// dealer) and FromNonDealer by each other player.
	FromDealer    int `json:"from_dealer,omitempty"`
	FromNonDealer int `json:"from_non_dealer,omitempty"`
}

// Compute scores a win. yakuman is the number of yakuman (0 for a normal
// hand, whose han includes dora); han 13 or more without yakuman is a
// counted yakuman.
func Compute(han, fu, yakuman int, dealer, tsumo bool) Points {
	var p Points
	var base int
	switch {
	case yakuman > 0:
		p.Limit, p.Multiplier, base = Yakuman, yakuman, 8000*yakuman
	case han >= 13:
		p.Limit, p.Multiplier, base = Yakuman, 1, 8000
	case han >= 11:
		p.Limit, base = Sanbaiman, 6000
	case han >= 8:
		p.Limit, base = Baiman, 4000
	case han >= 6:
		p.Limit, base = Haneman, 3000
	case han >= 5:
		p.Limit, base = Mangan, 2000
	default:
		base = fu << (han + 2)
		if base >= 2000 {
			p.Limit, base = Mangan, 2000
		}
	}
	switch {
	case !tsumo && dealer:
		p.Ron = up100(base * 6)
		p.Total = p.Ron
	case !tsumo:
		p.Ron = up100(base * 4)
		p.Total = p.Ron
	case dealer:
		p.FromNonDealer = up100(base * 2)
		p.Total = 3 * p.FromNonDealer
	default:
		p.FromDealer = up100(base * 2)
		p.FromNonDealer = up100(base)
		p.Total = p.FromDealer + 2*p.FromNonDealer
	}
	return p
}

func up100(v int) int { return (v + 99) / 100 * 100 }

// FromWin scores an evaluated win. Yakuman yaku carry 13 han each, so their
// number is the multiplier.
func FromWin(w yaku.Win, dealer, tsumo bool) Points {
	n := 0
	for _, y := range w.Yaku {
		if y.Han >= 13 {
			n++
		}
	}
	return Compute(w.HanTotal, w.Fu, n, dealer, tsumo)
}
