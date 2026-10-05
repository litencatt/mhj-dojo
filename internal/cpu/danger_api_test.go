package cpu

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

func TestDangerLevel(t *testing.T) {
	var v game.View
	for s := range v.Seats {
		v.Seats[s].Seat = s
	}
	v.Seats[1].Riichi = true
	for _, rt := range tile.MustParseHand("4m1z") {
		v.Seats[1].River = append(v.Seats[1].River, game.RiverTile{Tile: rt})
	}
	for _, c := range []struct {
		tile string
		want int
	}{
		{"4m", DangerSafe}, // genbutsu
		{"1m", DangerLow},  // suji of 4m
		{"7m", DangerLow},  // suji of 4m
		{"5z", DangerMid},  // an honor none of is seen
		{"5p", DangerHigh}, // a middle tile
	} {
		if got := DangerLevel(v, 1, tile.MustParseHand(c.tile)[0].Kind); got != c.want {
			t.Errorf("%s: %d, want %d", c.tile, got, c.want)
		}
	}
}
