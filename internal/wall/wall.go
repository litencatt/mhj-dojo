// Package wall builds deterministic, seeded 136-tile walls.
package wall

import (
	"crypto/sha256"
	"encoding/binary"
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
	// LiveDraws is the number of draws available after the solo deal.
	LiveDraws = Size - DeadWallSize - HandSize
	// Seats is the number of players in a four-player deal.
	Seats = 4
	// LiveDraws4 is the number of draws available after a four-player deal.
	LiveDraws4 = Size - DeadWallSize - Seats*HandSize
	// doraIndicatorPos is the index inside the dead wall of the first dora
	// indicator. The dead wall is 7 stacks of (upper, lower) tiles: the first
	// two stacks are the 4 rinshan (kan replacement) tiles, then each dora
	// indicator sits on a stack with its ura-dora indicator below it.
	doraIndicatorPos = 4
	// MaxKans is the number of kans a round allows: 4 rinshan tiles and up
	// to 5 dora indicators.
	MaxKans = 4
)

// Wall is a shuffled tile set with the dead wall at [122,136). A solo deal
// reads hand = [0,13) and draws = [13,122); a four-player deal reads seat s's
// hand at [13s,13s+13) and draws = [52,122). Seat 0's hand is the solo hand,
// so a seed deals the same tiles to seat 0 in both modes.
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

// PickSeed returns explicit if set, else def if set, else a random seed in
// [0, bound).
func PickSeed(explicit, def *int64, bound int64) int64 {
	switch {
	case explicit != nil:
		return *explicit
	case def != nil:
		return *def
	}
	return rand.Int64N(bound)
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

// HandOf returns the 13 tiles dealt to seat (0-3) in a four-player deal,
// sorted. It panics on any other seat: reading past the deal would silently
// return live-wall tiles as a hand.
func (w *Wall) HandOf(seat int) []tile.Tile {
	if seat < 0 || seat >= Seats {
		panic(fmt.Sprintf("wall: seat %d out of range", seat))
	}
	h := make([]tile.Tile, HandSize)
	copy(h, w.tiles[seat*HandSize:(seat+1)*HandSize])
	tile.Sort(h)
	return h
}

// Draw4 returns the k-th draw (0-based) of a four-player deal.
func (w *Wall) Draw4(k int) (tile.Tile, bool) {
	if k < 0 || k >= LiveDraws4 {
		return tile.Tile{}, false
	}
	return w.tiles[Seats*HandSize+k], true
}

// DoraIndicators returns the first dora indicator, the only one without kans.
func (w *Wall) DoraIndicators() []tile.Tile { return w.DoraIndicatorsN(1) }

// UraDoraIndicators returns the first ura-dora indicator: the tile below the
// first dora indicator, revealed only when the round ends.
func (w *Wall) UraDoraIndicators() []tile.Tile { return w.UraDoraIndicatorsN(1) }

// DoraIndicatorsN returns the first n dora indicators (1 + kans, n <= 5).
func (w *Wall) DoraIndicatorsN(n int) []tile.Tile { return w.deadStacks(n, 0) }

// UraDoraIndicatorsN returns the ura-dora indicators below the first n dora
// indicators.
func (w *Wall) UraDoraIndicatorsN(n int) []tile.Tile { return w.deadStacks(n, 1) }

func (w *Wall) deadStacks(n, lower int) []tile.Tile {
	if n < 1 || n > MaxKans+1 {
		panic(fmt.Sprintf("wall: %d dora indicators", n))
	}
	out := make([]tile.Tile, n)
	for i := range n {
		out[i] = w.tiles[Size-DeadWallSize+doraIndicatorPos+2*i+lower]
	}
	return out
}

// Rinshan returns the k-th (0-based) rinshan tile, drawn after a kan. Each
// kan also takes one draw off the end of the live wall (the dead wall stays
// 14 tiles), which the caller accounts for.
func (w *Wall) Rinshan(k int) (tile.Tile, bool) {
	if k < 0 || k >= MaxKans {
		return tile.Tile{}, false
	}
	return w.tiles[Size-DeadWallSize+k], true
}

// RoundSeed derives the wall seed of round i of a game from the game's
// master seed. It is one-way: showing one round's seed reveals neither the
// master seed nor another round's wall. The result is in [0, 2^53).
func RoundSeed(master int64, round int) int64 {
	var b [16]byte
	binary.BigEndian.PutUint64(b[:8], uint64(master))
	binary.BigEndian.PutUint64(b[8:], uint64(round))
	sum := sha256.Sum256(b[:])
	return int64(binary.BigEndian.Uint64(sum[:8]) >> 11)
}

// Tiles returns the full wall order.
func (w *Wall) Tiles() [Size]tile.Tile { return w.tiles }
