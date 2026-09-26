package handshape

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/litencatt/mhj2/internal/shanten"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
)

// format writes groups as "type:tiles" separated by spaces, e.g. "seq:123m".
func format(gs []Group) string {
	var parts []string
	for _, g := range gs {
		var c tile.Counts
		for _, k := range g.Kinds {
			c[k]++
		}
		parts = append(parts, fmt.Sprintf("%s:%s", g.Type, c))
	}
	return strings.Join(parts, " ")
}

func TestGroupsKnown(t *testing.T) {
	cases := []struct {
		name  string
		hand  string
		melds int
		want  string
		sh    int
	}{
		{"tenpai", "123m456p789s11z23s", 0, "seq:123m seq:456p seq:789s pair:11z ryanmen:23s", 0},
		{"red five", "340m456p789s11z23s", 0, "seq:345m seq:456p seq:789s pair:11z ryanmen:23s", 0},
		{"one away", "123m456p79s11z235s", 0, "seq:123m seq:456p pair:11z ryanmen:23s kanchan:57s float:9s", 1},
		{"meld over taatsu", "123m456p11z3457s9p", 0, "seq:123m seq:456p seq:345s pair:11z float:9p7s", 1},
		{"pair choice", "123m456p789s1122z", 0, "seq:123m seq:456p seq:789s pair:11z toitsu:22z", 0},
		{"floats", "1m5p9s1234567z258m", 0, "penchan:12m float:58m5p9s1234567z", 7},
		{"called melds", "234m55p67s", 2, "seq:234m pair:55p ryanmen:67s", 0},
		{"all called", "5z", 4, "float:5z", 0},
		{"more melds", "1112345678999m", 0, "trip:111m seq:234m seq:567m trip:999m float:8m", 0},
		{"four copies", "1111m234p567s789s1z", 0, "trip:111m seq:234p seq:567s seq:789s float:1m1z", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := tile.MustCounts(tc.hand)
			gs := Groups(c, tc.melds)
			_, sc := split(c, tc.melds)
			if sc.shanten != tc.sh {
				t.Errorf("shanten = %d, want %d", sc.shanten, tc.sh)
			}
			if got := format(gs); got != tc.want {
				t.Errorf("groups = %q, want %q", got, tc.want)
			}
			var n int
			for _, g := range gs {
				n += len(g.Kinds)
			}
			if n != c.Total() {
				t.Errorf("groups cover %d tiles, want %d", n, c.Total())
			}
		})
	}
}

// TestGroupsShantenMatchesEngine checks that the chosen split always has the
// normal shanten of package shanten, with 0 to 4 called melds.
func TestGroupsShantenMatchesEngine(t *testing.T) {
	r := rand.New(rand.NewPCG(5, 6))
	e := shanten.NewEngine()
	n := 20_000
	if testing.Short() {
		n = 3_000
	}
	for i := range n {
		melds := i % 5
		set := wall.FullSet()
		r.Shuffle(len(set), func(i, j int) { set[i], set[j] = set[j], set[i] })
		size := 13 - 3*melds
		if i%3 == 0 {
			size++ // a hand that must still discard (drawn tile or after a call)
		}
		c := tile.CountsOf(set[:size])
		if i%7 == 0 && size >= 5 { // stress the 4-copy rules
			k := tile.Kind(r.IntN(tile.NumKinds))
			for c[k] < 4 {
				j := tile.Kind(r.IntN(tile.NumKinds))
				if j != k && c[j] > 0 {
					c[j]--
					c[k]++
				}
			}
		}
		target := shanten.NormalTarget
		target.Melds -= melds
		want := e.Evaluate(&c, &target).Dist - 1
		gs, sc := split(c, melds)
		if sc.shanten != want {
			t.Fatalf("hand %s melds %d: split shanten %d (%v), engine %d", c, melds, sc.shanten, gs, want)
		}
		var got tile.Counts
		for _, g := range Groups(c, melds) {
			for _, k := range g.Kinds {
				got[k]++
			}
		}
		if got != c {
			t.Fatalf("hand %s melds %d: groups cover %s", c, melds, got)
		}
	}
}

func BenchmarkGroups(b *testing.B) {
	r := rand.New(rand.NewPCG(7, 8))
	hands := make([]tile.Counts, 64)
	for i := range hands {
		set := wall.FullSet()
		r.Shuffle(len(set), func(i, j int) { set[i], set[j] = set[j], set[i] })
		hands[i] = tile.CountsOf(set[:13])
	}
	b.ResetTimer()
	for i := range b.N {
		Groups(hands[i%len(hands)], 0)
	}
}
