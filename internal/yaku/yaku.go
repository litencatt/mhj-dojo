// Package yaku decomposes complete hands and detects the Phase 1 yaku of a
// closed tsumo win. Fu and points are out of scope.
package yaku

import "github.com/litencatt/mhj2/internal/tile"

// GroupType is the shape of a group.
type GroupType uint8

// Group shapes.
const (
	Seq GroupType = iota
	Trip
)

// Meld is a sequence (Kind = lowest tile) or a triplet.
type Meld struct {
	Type GroupType
	Kind tile.Kind
}

// Contains reports whether the meld uses a tile of kind k.
func (m Meld) Contains(k tile.Kind) bool {
	if m.Type == Trip {
		return m.Kind == k
	}
	return k >= m.Kind && k <= m.Kind+2
}

// Decomposition is a 4 melds + pair reading of a complete hand.
type Decomposition struct {
	Pair  tile.Kind
	Melds [4]Meld
}

func (d *Decomposition) hasTrip(k tile.Kind) bool {
	for _, m := range d.Melds {
		if m.Type == Trip && m.Kind == k {
			return true
		}
	}
	return false
}

// Decompose returns every distinct 4 melds + pair reading of a 14-tile hand.
func Decompose(c tile.Counts) []Decomposition {
	if c.Total() != 14 {
		return nil
	}
	var out []Decomposition
	var melds [4]Meld
	var rec func(i, n int, pair tile.Kind)
	rec = func(i, n int, pair tile.Kind) {
		for i < tile.NumKinds && c[i] == 0 {
			i++
		}
		if i == tile.NumKinds {
			if n == 4 {
				out = append(out, Decomposition{Pair: pair, Melds: melds})
			}
			return
		}
		if n == 4 {
			return
		}
		k := tile.Kind(i)
		if c[i] >= 3 {
			c[i] -= 3
			melds[n] = Meld{Trip, k}
			rec(i, n+1, pair)
			c[i] += 3
		}
		if !k.IsHonor() && k.Num() <= 7 && c[i+1] > 0 && c[i+2] > 0 {
			c[i]--
			c[i+1]--
			c[i+2]--
			melds[n] = Meld{Seq, k}
			rec(i, n+1, pair)
			c[i]++
			c[i+1]++
			c[i+2]++
		}
	}
	for h := tile.Kind(0); h < tile.NumKinds; h++ {
		if c[h] >= 2 {
			c[h] -= 2
			rec(0, 0, h)
			c[h] += 2
		}
	}
	return out
}

// IsChiitoitsu reports seven distinct pairs.
func IsChiitoitsu(c tile.Counts) bool {
	pairs := 0
	for _, n := range c {
		if n == 2 {
			pairs++
		} else if n != 0 {
			return false
		}
	}
	return pairs == 7
}

// IsKokushi reports thirteen orphans (all 13 terminal/honor kinds + one pair).
func IsKokushi(c tile.Counts) bool {
	pair := false
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		switch {
		case !k.IsYaochu():
			if c[k] != 0 {
				return false
			}
		case c[k] == 0 || c[k] > 2:
			return false
		case c[k] == 2:
			pair = true
		}
	}
	return pair
}

// IsComplete reports whether 14 tiles form any winning shape.
func IsComplete(c tile.Counts) bool {
	return c.Total() == 14 && (IsChiitoitsu(c) || IsKokushi(c) || len(Decompose(c)) > 0)
}

// IsRyanmen reports whether winning on k completes seq with a two-sided wait.
func IsRyanmen(seq Meld, k tile.Kind) bool {
	if seq.Type != Seq {
		return false
	}
	start := seq.Kind.Num()
	return (k == seq.Kind && start <= 6) || (k == seq.Kind+2 && start >= 2)
}
