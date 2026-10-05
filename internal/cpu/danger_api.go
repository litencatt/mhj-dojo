package cpu

import (
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Danger levels of a tile against one riichi, as DangerLevel returns them.
const (
	DangerSafe = 0 // genbutsu (incl. tiles passed after the riichi), or an honor with all 4 seen
	DangerLow  = 1 // suji or no-chance, or an honor with 2 or 3 seen
	DangerMid  = 2 // one two-sided wait ruled out, or another honor
	DangerHigh = 3 // other terminals, 2/8 and middle tiles
)

// DangerLevel groups Danger's score of k against seat into the four
// levels above.
func DangerLevel(v game.View, seat int, k tile.Kind) int {
	switch d := Danger(v, seat, k); {
	case d == 0:
		return DangerSafe
	case d <= 3:
		return DangerLow
	case d <= 6:
		return DangerMid
	}
	return DangerHigh
}
