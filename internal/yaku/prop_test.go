package yaku

import (
	"fmt"
	"maps"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// canMelds is an independent check that c splits into melds only: the lowest
// tile must start a triplet or a sequence.
func canMelds(c *tile.Counts, from int) bool {
	for from < tile.NumKinds && c[from] == 0 {
		from++
	}
	if from == tile.NumKinds {
		return true
	}
	k := tile.Kind(from)
	if c[from] >= 3 {
		c[from] -= 3
		ok := canMelds(c, from)
		c[from] += 3
		if ok {
			return true
		}
	}
	if !k.IsHonor() && k.Num() <= 7 && c[from+1] > 0 && c[from+2] > 0 {
		c[from]--
		c[from+1]--
		c[from+2]--
		ok := canMelds(c, from)
		c[from]++
		c[from+1]++
		c[from+2]++
		return ok
	}
	return false
}

// refComplete defines a winning 14-tile hand without using the package's code.
func refComplete(c tile.Counts) bool {
	distinctPairs, kokushiKinds, kokushiPair, other := 0, 0, false, false
	for k, n := range c {
		if n == 2 {
			distinctPairs++
		}
		if tile.Kind(k).IsYaochu() {
			if n >= 1 {
				kokushiKinds++
			}
			kokushiPair = kokushiPair || n == 2
		} else if n > 0 {
			other = true
		}
	}
	if distinctPairs == 7 && c.Total() == 14 {
		return true
	}
	if kokushiKinds == 13 && kokushiPair && !other && c.Total() == 14 {
		return true
	}
	for h := range c {
		if c[h] >= 2 {
			c[h] -= 2
			ok := canMelds(&c, 0)
			c[h] += 2
			if ok {
				return true
			}
		}
	}
	return false
}

// randomComplete builds 14 tiles as four random groups and a pair, which is
// complete by construction and rich in shared tiles.
func randomComplete(r *rand.Rand) tile.Counts {
	for {
		var c tile.Counts
		for range 4 {
			if r.IntN(3) == 0 {
				c[r.IntN(tile.NumKinds)] += 3
			} else {
				s, n := r.IntN(3), r.IntN(7)
				for j := range 3 {
					c[s*9+n+j]++
				}
			}
		}
		c[r.IntN(tile.NumKinds)] += 2
		if !slices.ContainsFunc(c[:], func(n int) bool { return n > 4 }) {
			return c
		}
	}
}

// mutate swaps one tile, usually breaking completeness.
func mutate(r *rand.Rand, c tile.Counts) tile.Counts {
	for {
		out := c
		for {
			k := r.IntN(tile.NumKinds)
			if out[k] > 0 {
				out[k]--
				break
			}
		}
		k := r.IntN(tile.NumKinds)
		if out[k] < 4 {
			out[k]++
			return out
		}
	}
}

func TestIsCompleteMatchesReference(t *testing.T) {
	r := rand.New(rand.NewPCG(21, 22))
	n := testmode.N(60000, 15000, 3000)
	complete := 0
	for i := range n {
		c := randomComplete(r)
		switch i % 4 {
		case 1:
			c = mutate(r, c)
		case 2:
			c = mutate(r, mutate(r, c))
		case 3:
			// seven pairs / orphans neighbours
			c = tile.Counts{}
			for range 7 {
				c[r.IntN(tile.NumKinds)] += 2
			}
			if r.IntN(2) == 0 {
				c = mutate(r, c)
			}
			if slices.ContainsFunc(c[:], func(n int) bool { return n > 4 }) || c.Total() != 14 {
				continue
			}
		}
		want := refComplete(c)
		if want {
			complete++
		}
		if got := IsComplete(c); got != want {
			t.Fatalf("hand %s: IsComplete=%v, reference %v", c, got, want)
		}
		if got := len(Decompose(c)) > 0 || IsChiitoitsu(c) || IsKokushi(c); got != want {
			t.Fatalf("hand %s: Decompose/special=%v, reference %v", c, got, want)
		}
	}
	if complete < n/10 {
		t.Fatalf("only %d of %d hands were complete; generator is too weak", complete, n)
	}
}

// Every decomposition must use exactly the hand's tiles.
func TestDecomposeUsesExactlyTheTiles(t *testing.T) {
	r := rand.New(rand.NewPCG(23, 24))
	for range testmode.N(20000, 5000, 1000) {
		c := randomComplete(r)
		ds := Decompose(c)
		if len(ds) == 0 {
			t.Fatalf("hand %s built complete but has no reading", c)
		}
		for _, d := range ds {
			var got tile.Counts
			got[d.Pair] += 2
			for _, m := range d.Melds {
				if m.Type == Trip {
					got[m.Kind] += 3
				} else {
					got[m.Kind]++
					got[m.Kind+1]++
					got[m.Kind+2]++
				}
			}
			if got != c {
				t.Fatalf("hand %s: reading %+v uses %s", c, d, got)
			}
		}
	}
}

// refFu is a textbook fu count for one interpretation: pair, melds, and the
// meld index the winning tile completed (-1 for the pair).
func refFu(d Decomposition, win tile.Kind, place int, ctx Context) int {
	open := false
	for _, m := range ctx.Melds {
		open = open || m.Open
	}
	// wait shape
	shape := "ryanmen"
	switch {
	case place < 0:
		shape = "tanki"
	case d.Melds[place].Type == Trip:
		shape = "shanpon"
	default:
		lo := d.Melds[place].Kind
		switch {
		case win == lo+1:
			shape = "kanchan"
		case win == lo && lo.Num() == 7, win == lo+2 && lo.Num() == 1:
			shape = "penchan"
		}
	}
	allSeq := true
	for _, m := range d.Melds {
		allSeq = allSeq && m.Type == Seq
	}
	valuePair := d.Pair >= tile.Haku || d.Pair == ctx.Winds.Round || d.Pair == ctx.Winds.Seat
	if !open && allSeq && shape == "ryanmen" && !valuePair {
		if ctx.Ron {
			return 30
		}
		return 20
	}
	fu := 20
	if ctx.Ron && !open {
		fu += 10
	}
	if !ctx.Ron {
		fu += 2
	}
	if shape == "kanchan" || shape == "penchan" || shape == "tanki" {
		fu += 2
	}
	if d.Pair >= tile.Haku {
		fu += 2
	}
	if d.Pair == ctx.Winds.Round {
		fu += 2
	}
	if d.Pair == ctx.Winds.Seat {
		fu += 2
	}
	for i, m := range d.Melds {
		if m.Type != Trip {
			continue
		}
		v := 2
		if m.Kind.IsYaochu() {
			v = 4
		}
		hidden := !m.Open && (!ctx.Ron || i != place)
		if hidden {
			v *= 2
		}
		if m.Kan {
			v *= 4
		}
		fu += v
	}
	if open && fu == 20 {
		fu = 30
	}
	return (fu + 9) / 10 * 10
}

// randomWinCase makes up to three called melds from a complete hand's readings
// by moving groups out of the concealed tiles.
func randomWinCase(r *rand.Rand) (conc tile.Counts, called []Meld, ctx Context, ok bool) {
	c := randomComplete(r)
	ds := Decompose(c)
	d := ds[r.IntN(len(ds))]
	nCalled := 0
	if r.IntN(2) == 0 {
		nCalled = r.IntN(4)
	}
	conc = c
	perm := r.Perm(4)
	for _, i := range perm[:nCalled] {
		m := d.Melds[i]
		switch {
		case m.Type == Trip && r.IntN(3) == 0:
			m.Kan = true
			m.Open = r.IntN(2) == 0
			if conc[m.Kind] < 3 {
				return conc, nil, ctx, false
			}
			// a kan uses a fourth tile outside the concealed hand
			if c[m.Kind] > 3 {
				return conc, nil, ctx, false
			}
		default:
			m.Open = true
		}
		for j := range 3 {
			if m.Type == Seq {
				conc[m.Kind+tile.Kind(j)]--
			} else {
				conc[m.Kind]--
			}
		}
		called = append(called, m)
	}
	// a hand whose called melds are all concealed kans is closed: still fine
	var tiles []tile.Kind
	for k, n := range conc {
		for range n {
			tiles = append(tiles, tile.Kind(k))
		}
	}
	win := tiles[r.IntN(len(tiles))]
	winds := []tile.Kind{tile.East, tile.South, tile.West, tile.North}
	ctx = Context{
		WinTile: win,
		Ron:     r.IntN(2) == 0,
		Winds:   Winds{winds[r.IntN(2)], winds[r.IntN(4)]},
		Melds:   called,
	}
	return conc, called, ctx, true
}

// refReadings enumerates every way the n concealed melds and a pair split c,
// with its own search, one entry per distinct reading.
func refReadings(c tile.Counts, n int) []Decomposition {
	var out []Decomposition
	seen := map[string]bool{}
	var rec func(left tile.Counts, ms []Meld, pair tile.Kind)
	rec = func(left tile.Counts, ms []Meld, pair tile.Kind) {
		first := -1
		for k, v := range left {
			if v > 0 {
				first = k
				break
			}
		}
		if first < 0 {
			if len(ms) != n {
				return
			}
			d := Decomposition{Pair: pair}
			copy(d.Melds[:], ms)
			if key := readingKey(d, n, -2); !seen[key] {
				seen[key] = true
				out = append(out, d)
			}
			return
		}
		if len(ms) == n {
			return
		}
		k := tile.Kind(first)
		if left[first] >= 3 {
			next := left
			next[first] -= 3
			rec(next, append(slices.Clone(ms), Meld{Type: Trip, Kind: k}), pair)
		}
		if !k.IsHonor() && k.Num() <= 7 && left[first+1] > 0 && left[first+2] > 0 {
			next := left
			next[first]--
			next[first+1]--
			next[first+2]--
			rec(next, append(slices.Clone(ms), Meld{Type: Seq, Kind: k}), pair)
		}
	}
	for h := range c {
		if c[h] >= 2 {
			left := c
			left[h] -= 2
			rec(left, nil, tile.Kind(h))
		}
	}
	return out
}

// readingKey identifies a reading and where the winning tile went (place -1:
// the pair, -2: nowhere).
func readingKey(d Decomposition, n, place int) string {
	ms := slices.Clone(d.Melds[:n])
	var at string
	if place >= 0 {
		at = fmt.Sprint(d.Melds[place])
	}
	slices.SortFunc(ms, func(a, b Meld) int {
		if a.Type != b.Type {
			return int(a.Type) - int(b.Type)
		}
		return int(a.Kind) - int(b.Kind)
	})
	return fmt.Sprint(d.Pair, ms, " win in ", place == -1, at)
}

// TestFuMatchesReference compares the fu of every reading (not just the best)
// with a textbook count over an independently enumerated set of readings.
func TestFuMatchesReference(t *testing.T) {
	r := rand.New(rand.NewPCG(25, 26))
	checked := 0
	for range testmode.N(40000, 10000, 2000) {
		conc, called, ctx, ok := randomWinCase(r)
		if !ok {
			continue
		}
		n := 4 - len(called)
		want := map[string]int{}
		for _, d := range refReadings(conc, n) {
			copy(d.Melds[n:], called)
			if d.Pair == ctx.WinTile {
				want[readingKey(d, n, -1)] = refFu(d, ctx.WinTile, -1, ctx)
			}
			for i, m := range d.Melds[:n] {
				if m.Contains(ctx.WinTile) {
					want[readingKey(d, n, i)] = refFu(d, ctx.WinTile, i, ctx)
				}
			}
		}
		got := map[string]int{}
		for _, rd := range ReadingsWith(conc, called, ctx.WinTile) {
			got[readingKey(rd.Decomposition, n, rd.WinGroup)] = Fu(rd, ctx)
		}
		if !maps.Equal(got, want) {
			t.Fatalf("conc %s called %+v ctx %+v:\n got %v\nwant %v", conc, called, ctx, got, want)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no cases generated")
	}
}
