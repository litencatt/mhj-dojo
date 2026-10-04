package shanten

import (
	"math/rand/v2"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Independent definitions of the two special shapes for 14 tiles.
func sevenPairs(c tile.Counts) bool {
	p := 0
	for _, n := range c {
		if n == 2 {
			p++
		} else if n != 0 {
			return false
		}
	}
	return p == 7
}

func thirteenOrphans(c tile.Counts) bool {
	pair := false
	for k, n := range c {
		if !tile.Kind(k).IsYaochu() {
			if n != 0 {
				return false
			}
			continue
		}
		if n == 0 || n > 2 {
			return false
		}
		pair = pair || n == 2
	}
	return pair
}

// bruteSpecial is the shanten of a 13-tile hand toward a shape, found by
// search and capped at limit+1: 0 when one draw completes it, else 1 plus the
// best draw-and-discard.
func bruteSpecial(c tile.Counts, done func(tile.Counts) bool, limit int) int {
	for t := range c {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		ok := done(c)
		c[t]--
		if ok {
			return 0
		}
	}
	if limit <= 0 {
		return 1
	}
	best := limit + 1
	for t := range c {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		for x := range c {
			if c[x] == 0 || x == t {
				continue
			}
			c[x]--
			best = min(best, 1+bruteSpecial(c, done, limit-1))
			c[x]++
		}
		c[t]--
	}
	return best
}

// ukeireBrute marks the kinds whose draw allows a discard that lowers the
// shanten s of c.
func ukeireBrute(c tile.Counts, done func(tile.Counts) bool, s int) [tile.NumKinds]bool {
	var set [tile.NumKinds]bool
	for t := range c {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		if s == 0 {
			set[t] = done(c)
		}
		for x := range c {
			if s == 0 || c[x] == 0 {
				continue
			}
			c[x]--
			if bruteSpecial(c, done, s) < s {
				set[t] = true
			}
			c[x]++
		}
		c[t]--
	}
	return set
}

// specialHand is a random 13-tile hand biased toward the shape so that low
// shanten values are well represented.
func specialHand(r *rand.Rand, kokushi bool) tile.Counts {
	var c tile.Counts
	if kokushi {
		for k := tile.Kind(0); k < tile.NumKinds; k++ {
			if k.IsYaochu() && r.IntN(4) != 0 {
				c[k]++
			}
		}
		if r.IntN(2) == 0 {
			c[tile.Kind(r.IntN(tile.NumKinds))]++
		}
	} else {
		for i := 0; i < 1+r.IntN(7); i++ {
			c[tile.Kind(r.IntN(tile.NumKinds))] += 2
		}
	}
	for k := range c {
		c[k] = min(c[k], 4)
	}
	for c.Total() > 13 {
		k := r.IntN(tile.NumKinds)
		if c[k] > 0 {
			c[k]--
		}
	}
	for c.Total() < 13 {
		k := r.IntN(tile.NumKinds)
		if c[k] < 4 {
			c[k]++
		}
	}
	return c
}

func TestSpecialShapesMatchBruteForce(t *testing.T) {
	r := rand.New(rand.NewPCG(11, 12))
	n := testmode.N(300, 80, 30)
	for i := 0; i < n; i++ {
		kokushi := i%2 == 1
		c := specialHand(r, kokushi)
		done, res := sevenPairs, Chiitoitsu(c)
		if kokushi {
			done, res = thirteenOrphans, Kokushi(c)
		}
		// The brute force is exact up to shanten 2 and otherwise reports 3.
		if got, want := min(res.Shanten, 3), bruteSpecial(c, done, 2); got != want {
			t.Fatalf("hand %s kokushi=%v: shanten %d, brute %d", c, kokushi, res.Shanten, want)
		}
		if res.Shanten > 1 {
			continue
		}
		set := ukeireBrute(c, done, res.Shanten)
		var got [tile.NumKinds]bool
		for _, k := range res.Ukeire {
			got[k] = true
		}
		if got != set {
			t.Fatalf("hand %s kokushi=%v shanten %d: ukeire %v, brute %v", c, kokushi, res.Shanten, kindStrings(res.Ukeire), set)
		}
	}
}
