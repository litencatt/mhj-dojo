package yaku

import (
	"fmt"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Four 3s can be 333 + 345 or 345 + 333: that is one reading, not two.
func TestDecomposeHasNoDuplicateReadings(t *testing.T) {
	for _, hand := range []string{"34577m333345888s", "11122233344455m", "33334444555566s"} {
		seen := map[string]bool{}
		for _, d := range Decompose(tile.MustCounts(hand)) {
			ms := slices.Clone(d.Melds[:])
			slices.SortFunc(ms, func(a, b Meld) int {
				if a.Type != b.Type {
					return int(a.Type) - int(b.Type)
				}
				return int(a.Kind) - int(b.Kind)
			})
			key := fmt.Sprint(d.Pair, ms)
			if seen[key] {
				t.Errorf("%s: duplicate reading %s", hand, key)
			}
			seen[key] = true
		}
	}
}
