// Package handshape splits a concealed hand into the blocks a player reads
// it as: melds (sequences and triplets), the pair, partial blocks (taatsu)
// and floating tiles, for display next to the hand (docs/api.md).
//
// The split is one of the normal-form (4 melds + pair) decompositions with
// the lowest shanten, 8 - 2*melds - taatsu - pair with melds + taatsu at most
// 4 minus the called melds. It follows the 4-copy rules of
// shanten.ClassicNormal, so its shanten always equals the normal shanten.
// Ties are broken, in order, by more melds, having a pair, better taatsu
// (ryanmen > toitsu > kanchan > penchan, compared by count in that order),
// more floating terminals and honors, and finally by the first split found
// in kind order.
package handshape

import (
	"cmp"
	"slices"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Type is the kind of a block.
type Type string

// Block types.
const (
	Seq     Type = "seq"     // sequence, e.g. 345m
	Trip    Type = "trip"    // triplet
	Pair    Type = "pair"    // the pair (head)
	Ryanmen Type = "ryanmen" // open wait, e.g. 34m
	Kanchan Type = "kanchan" // closed wait, e.g. 35m
	Penchan Type = "penchan" // edge wait, 12 or 89
	Toitsu  Type = "toitsu"  // a pair other than the head
	Float   Type = "float"   // tiles in no block
)

// Group is one block of the split.
type Group struct {
	Type  Type
	Kinds []tile.Kind
}

// order ranks block types for output: melds, pair, taatsu, floats.
var order = map[Type]int{Seq: 0, Trip: 0, Pair: 1, Ryanmen: 2, Toitsu: 2, Kanchan: 2, Penchan: 2, Float: 3}

// Groups returns the split of the concealed tiles c of a hand with
// fixedMelds called melds (concealed kans included). Melds come first, then
// the pair, the taatsu and one group holding every floating tile; within
// each class groups are in kind order. It returns nil for an empty hand.
func Groups(c tile.Counts, fixedMelds int) []Group {
	best, _ := split(c, fixedMelds)
	out := make([]Group, 0, len(best))
	var floats []tile.Kind
	for _, b := range best {
		if b.typ == Float {
			floats = append(floats, b.kinds()...)
			continue
		}
		out = append(out, Group{Type: b.typ, Kinds: b.kinds()})
	}
	slices.SortStableFunc(out, func(a, b Group) int {
		if d := cmp.Compare(order[a.Type], order[b.Type]); d != 0 {
			return d
		}
		return cmp.Compare(a.Kinds[0], b.Kinds[0])
	})
	if len(floats) > 0 {
		slices.Sort(floats)
		out = append(out, Group{Type: Float, Kinds: floats})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// block is a group being built: its type, first kind and length in tiles
// (the kinds are k, k+step, ...).
type block struct {
	typ  Type
	k    tile.Kind
	step tile.Kind // 0 for trip/pair/toitsu/float, 1 or 2 for runs
	n    int
}

func (b block) kinds() []tile.Kind {
	out := make([]tile.Kind, b.n)
	for i := range out {
		out[i] = b.k + tile.Kind(i)*b.step
	}
	return out
}

// score orders splits; see the package comment.
type score struct {
	shanten, melds, head, ryanmen, toitsu, kanchan, penchan, yaochu int
}

func (a score) better(b score) bool {
	if a.shanten != b.shanten {
		return a.shanten < b.shanten
	}
	for _, d := range [...][2]int{
		{a.melds, b.melds}, {a.head, b.head}, {a.ryanmen, b.ryanmen}, {a.toitsu, b.toitsu},
		{a.kanchan, b.kanchan}, {a.penchan, b.penchan}, {a.yaochu, b.yaochu},
	} {
		if d[0] != d[1] {
			return d[0] > d[1]
		}
	}
	return false
}

// split enumerates the decompositions of c depth first and returns the best
// one and its score.
func split(c tile.Counts, fixedMelds int) ([]block, score) {
	orig := c
	budget := max(4-fixedMelds, 0)
	var (
		cur      []block
		best     []block
		bestSc   score
		found    bool
		m, t, hd int
	)
	// dead reports whether a block starting at k cannot wait on rank: every
	// copy is in the hand, or the rank is outside the suit (honors have no
	// runs).
	dead := func(k tile.Kind, rank int) bool {
		if k.IsHonor() || rank < 1 || rank > 9 {
			return true
		}
		return orig[tile.MakeKind(k.Suit(), rank)] >= 4
	}
	push := func(b block) {
		cur = append(cur, b)
		for i := range b.n {
			c[b.k+tile.Kind(i)*b.step]--
		}
	}
	pop := func() {
		b := cur[len(cur)-1]
		cur = cur[:len(cur)-1]
		for i := range b.n {
			c[b.k+tile.Kind(i)*b.step]++
		}
	}
	finish := func() {
		sc := score{melds: m, head: hd}
		live := false
		for _, b := range cur {
			switch b.typ {
			case Ryanmen:
				sc.ryanmen++
			case Toitsu:
				sc.toitsu++
			case Kanchan:
				sc.kanchan++
			case Penchan:
				sc.penchan++
			case Float:
				if b.k.IsYaochu() {
					sc.yaochu++
				}
				if orig[b.k] < 4 {
					live = true
				}
			}
		}
		sc.shanten = 8 - 2*(fixedMelds+m) - t - hd
		if hd == 0 && !live {
			// No floating tile can become the pair: it must come from scratch.
			sc.shanten++
		}
		if !found || sc.better(bestSc) {
			found, bestSc = true, sc
			best = slices.Clone(cur)
		}
	}
	var rec func(k tile.Kind)
	rec = func(k tile.Kind) {
		for k < tile.NumKinds && c[k] == 0 {
			k++
		}
		if k == tile.NumKinds {
			finish()
			return
		}
		if found {
			// Each remaining tile lowers the shanten by at most 2/3 (a meld),
			// and the free slots by at most 2 each plus 1 for the pair.
			rest := 0
			for _, n := range c[k:] {
				rest += n
			}
			gain := 2 * (budget - m - t)
			if hd == 0 {
				gain++
			}
			gain = min(gain, 2*rest/3)
			if 8-2*(fixedMelds+m)-t-hd-gain > bestSc.shanten {
				return
			}
		}
		num, honor := k.Num(), k.IsHonor()
		room := m+t < budget
		if room && !honor && num <= 7 && c[k+1] > 0 && c[k+2] > 0 {
			push(block{Seq, k, 1, 3})
			m++
			rec(k)
			m--
			pop()
		}
		if room && c[k] >= 3 {
			push(block{Trip, k, 0, 3})
			m++
			rec(k)
			m--
			pop()
		}
		if c[k] >= 2 {
			if hd == 0 {
				push(block{Pair, k, 0, 2})
				hd++
				rec(k)
				hd--
				pop()
			}
			if room && orig[k] < 4 {
				push(block{Toitsu, k, 0, 2})
				t++
				rec(k)
				t--
				pop()
			}
		}
		if room && !honor && num <= 8 && c[k+1] > 0 && (!dead(k, num-1) || !dead(k, num+2)) {
			typ := Ryanmen
			if num == 1 || num == 8 {
				typ = Penchan
			}
			push(block{typ, k, 1, 2})
			t++
			rec(k)
			t--
			pop()
		}
		if room && !honor && num <= 7 && c[k+2] > 0 && !dead(k, num+1) {
			push(block{Kanchan, k, 2, 2})
			t++
			rec(k)
			t--
			pop()
		}
		push(block{Float, k, 0, 1})
		rec(k)
		pop()
	}
	rec(0)
	return best, bestSc
}
