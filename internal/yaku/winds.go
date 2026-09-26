package yaku

import "github.com/litencatt/mhj-dojo/internal/tile"

// Winds are the round wind and a seat's wind. They decide which wind
// triplets are yakuhai and which pairs are value pairs.
type Winds struct{ Round, Seat tile.Kind }

// EastEast is the East round, East seat of practice mode.
var EastEast = Winds{tile.East, tile.East}

// WindKeys and WindNames are the row keys and names of 東 南 西 北.
var (
	WindKeys  = [4]string{"ton", "nan", "shaa", "pei"}
	WindNames = [4]string{"東", "南", "西", "北"}
)

// Count returns how many of the round and seat winds k is: 0, 1, or 2 for a
// double wind.
func (w Winds) Count(k tile.Kind) int {
	return b2i(k == w.Round) + b2i(k == w.Seat)
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
