// Package wall builds deterministic, seeded 136-tile walls.
package wall

import (
	"fmt"
	"math/rand/v2"

	"github.com/litencatt/mhj2/internal/tile"
)

const (
	// Size is the number of tiles in a full set.
	Size = 136
	// HandSize is the number of tiles dealt to the player.
	HandSize = 13
	// DeadWallSize is the number of tiles in the dead wall.
	DeadWallSize = 14
	// LiveDraws is the number of draws available after the deal.
	LiveDraws = Size - DeadWallSize - HandSize
	// doraIndicatorPos is the index inside the dead wall of the first dora
	// indicator. The dead wall is 7 stacks of (upper, lower) tiles, so the
	// ura-dora indicator is the tile below it at doraIndicatorPos+1.
	doraIndicatorPos = 4
)

// Wall is a shuffled tile set: hand = [0,13), live draws = [13,122), dead wall = [122,136).
type Wall struct {
	seed  int64
	tiles [Size]tile.Tile
}

// FullSet returns the 136 tiles in canonical order, with one red five per number suit.
func FullSet() [Size]tile.Tile {
	var ts [Size]tile.Tile
	i := 0
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		for c := 0; c < 4; c++ {
			ts[i] = tile.Tile{Kind: k, Red: !k.IsHonor() && k.Num() == 5 && c == 0}
			i++
		}
	}
	return ts
}

// New shuffles a full set with a PCG generator seeded from seed.
func New(seed int64) *Wall {
	w := &Wall{seed: seed, tiles: FullSet()}
	r := rand.New(rand.NewPCG(uint64(seed), 0x6d686a32)) // "mhj2"
	r.Shuffle(Size, func(i, j int) { w.tiles[i], w.tiles[j] = w.tiles[j], w.tiles[i] })
	return w
}

// FromTiles builds a wall with a fixed order (used by tests and fixtures).
// The tiles must be a permutation of FullSet.
func FromTiles(seed int64, ts [Size]tile.Tile) (*Wall, error) {
	want := map[tile.Tile]int{}
	for _, t := range FullSet() {
		want[t]++
	}
	for _, t := range ts {
		want[t]--
	}
	for t, n := range want {
		if n != 0 {
			return nil, fmt.Errorf("wall: tile %s count off by %d", t, -n)
		}
	}
	return &Wall{seed: seed, tiles: ts}, nil
}

// WithFront builds a wall that starts with front (hand, then draws) followed by
// the remaining tiles in canonical order. Used for fixtures and tests.
func WithFront(seed int64, front []tile.Tile) (*Wall, error) {
	var ts [Size]tile.Tile
	pool := FullSet()
	used := [Size]bool{}
	for i, f := range front {
		j := 0
		for ; j < Size && (used[j] || pool[j] != f); j++ {
		}
		if j == Size {
			return nil, fmt.Errorf("wall: no tile %s left for position %d", f, i)
		}
		used[j] = true
		ts[i] = f
	}
	i := len(front)
	for j, p := range pool {
		if !used[j] {
			ts[i] = p
			i++
		}
	}
	return &Wall{seed: seed, tiles: ts}, nil
}

// Seed returns the seed the wall was built from.
func (w *Wall) Seed() int64 { return w.seed }

// Hand returns the 13 dealt tiles, sorted.
func (w *Wall) Hand() []tile.Tile {
	h := make([]tile.Tile, HandSize)
	copy(h, w.tiles[:HandSize])
	tile.Sort(h)
	return h
}

// Draw returns the k-th draw (0-based) from the live wall.
func (w *Wall) Draw(k int) (tile.Tile, bool) {
	if k < 0 || k >= LiveDraws {
		return tile.Tile{}, false
	}
	return w.tiles[HandSize+k], true
}

// DoraIndicators returns the revealed dora indicators (one in Phase 1).
func (w *Wall) DoraIndicators() []tile.Tile {
	return []tile.Tile{w.tiles[Size-DeadWallSize+doraIndicatorPos]}
}

// UraDoraIndicators returns the ura-dora indicators: the tiles below the dora
// indicators, revealed only when the game ends.
func (w *Wall) UraDoraIndicators() []tile.Tile {
	return []tile.Tile{w.tiles[Size-DeadWallSize+doraIndicatorPos+1]}
}

// Tiles returns the full wall order.
func (w *Wall) Tiles() [Size]tile.Tile { return w.tiles }
