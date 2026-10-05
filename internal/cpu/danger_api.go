package cpu

import (
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Danger levels of a tile against one riichi, as DangerLevel returns them.
const (
	DangerSafe = 0 // genbutsu, or an honor with all 4 seen
	DangerLow  = 1 // suji, or an honor with 2 or 3 seen
	DangerMid  = 2 // half suji of 4-6, or another honor
	DangerHigh = 3 // other terminals, 2/8 and middle tiles
)

// DangerLevel returns how likely discarding a tile of kind k is to deal into
// seat's riichi, as the player's folding judges it (see danger), from what
// v's viewer sees.
func DangerLevel(v game.View, seat int, k tile.Kind) int {
	river := map[tile.Kind]bool{}
	for _, rt := range v.Seats[seat].River {
		river[rt.Tile.Kind] = true
	}
	visible := v.Visible()
	switch d := danger(k, river, &visible); {
	case d == 0:
		return DangerSafe
	case d <= 3:
		return DangerLow
	case d <= 6:
		return DangerMid
	}
	return DangerHigh
}
