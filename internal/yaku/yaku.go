// Package yaku decomposes complete hands and detects the yaku and fu of a
// closed win (tsumo or ron). Point tables live in package score.
package yaku

import (
	"slices"

	"github.com/litencatt/mhj2/internal/tile"
)

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

// Wait is the shape the winning tile completed.
type Wait uint8

// Wait shapes.
const (
	Ryanmen Wait = iota // two-sided sequence wait (23 waiting on 1 or 4)
	Kanchan             // closed wait (13 waiting on 2)
	Penchan             // edge wait (12 waiting on 3, 89 waiting on 7)
	Shanpon             // one of two pairs becomes a triplet
	Tanki               // single-tile wait on the pair
)

// Reading is one way to read a complete hand: a decomposition plus the group
// the winning tile completed. Yaku and fu depend on the whole reading, and a
// hand may be read several ways.
type Reading struct {
	Decomposition
	WinGroup int // index into Melds, or -1 when the winning tile completed the pair
	Wait     Wait
}

// Readings returns every reading of a 14-tile hand won on win. Identical
// melds in one decomposition yield a single reading.
func Readings(c tile.Counts, win tile.Kind) []Reading {
	var out []Reading
	for _, d := range Decompose(c) {
		if d.Pair == win {
			out = append(out, Reading{Decomposition: d, WinGroup: -1, Wait: Tanki})
		}
		for i, m := range d.Melds {
			if !m.Contains(win) || slices.Contains(d.Melds[:i], m) {
				continue
			}
			out = append(out, Reading{Decomposition: d, WinGroup: i, Wait: waitOf(m, win)})
		}
	}
	return out
}

// waitOf classifies the wait of meld m completed by win.
func waitOf(m Meld, win tile.Kind) Wait {
	switch {
	case m.Type == Trip:
		return Shanpon
	case win == m.Kind+1:
		return Kanchan
	case (win == m.Kind && m.Kind.Num() == 7) || (win == m.Kind+2 && m.Kind.Num() == 1):
		return Penchan
	default:
		return Ryanmen
	}
}
