package shanten

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

// randomHand draws n tiles from a shuffled full set.
func randomHand(r *rand.Rand, n int) tile.Counts {
	set := wall.FullSet()
	r.Shuffle(len(set), func(i, j int) { set[i], set[j] = set[j], set[i] })
	return tile.CountsOf(set[:n])
}

// quadHand forces a quad into an otherwise random hand to stress 4-copy rules.
func quadHand(r *rand.Rand) tile.Counts {
	var c tile.Counts
	q := tile.Kind(r.IntN(tile.NumKinds))
	c[q] = 4
	for c.Total() < 13 {
		k := tile.Kind(r.IntN(tile.NumKinds))
		if c[k] < 4 {
			c[k]++
		}
	}
	return c
}

func TestNormalMatchesClassicRandom(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	e := NewEngine()
	n := testmode.N(100_000, 30_000, 10_000)
	for i := 0; i < n; i++ {
		c := randomHand(r, 13)
		dp := e.Evaluate(&c, &NormalTarget).Dist - 1
		if cl := ClassicNormal(c); dp != cl {
			t.Fatalf("hand %s: dp=%d classic=%d", c, dp, cl)
		}
		if len(e.memo) > 1<<20 {
			e = NewEngine()
		}
	}
}

func TestNormalMatchesClassicQuads(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 4))
	e := NewEngine()
	for i := 0; i < 20_000; i++ {
		c := quadHand(r)
		dp := e.Evaluate(&c, &NormalTarget).Dist - 1
		if cl := ClassicNormal(c); dp != cl {
			t.Fatalf("hand %s: dp=%d classic=%d", c, dp, cl)
		}
	}
}

func TestNormalKnown(t *testing.T) {
	cases := []struct {
		hand string
		want int
	}{
		{"123456789m1234p", 0},
		{"123456789m11p45s", 0},
		{"123456789m1111p", 1}, // tanki on a fifth 1p is not a wait
		{"1111m2222m3333m4z", 0},
		{"19m19p19s1234567z", 8},
		{"123m456p789s11z22z", 0},
		{"1112345678999m", 0},
		{"11123456789999m", -1},
		{"111222333m44455p", -1},
		{"1111m1111p1111s1z", 2}, // e.g. 111m 111p 111s + 123m + 1z pair
	}
	for _, tc := range cases {
		c := tile.MustCounts(tc.hand)
		if got := Normal(c); got != tc.want {
			t.Errorf("Normal(%s) = %d, want %d", tc.hand, got, tc.want)
		}
		if c.Total() == 13 {
			if got := ClassicNormal(c); got != tc.want {
				t.Errorf("ClassicNormal(%s) = %d, want %d", tc.hand, got, tc.want)
			}
		}
	}
}

// --- brute-force oracle -----------------------------------------------------

func isComplete(c tile.Counts) bool {
	for h := tile.Kind(0); h < tile.NumKinds; h++ {
		if c[h] >= 2 {
			c[h] -= 2
			if meldsOnly(c, 0) {
				return true
			}
			c[h] += 2
		}
	}
	return false
}

func meldsOnly(c tile.Counts, i int) bool {
	for i < tile.NumKinds && c[i] == 0 {
		i++
	}
	if i == tile.NumKinds {
		return true
	}
	if c[i] >= 3 {
		c[i] -= 3
		if meldsOnly(c, i) {
			return true
		}
		c[i] += 3
	}
	k := tile.Kind(i)
	if !k.IsHonor() && k.Num() <= 7 && c[i+1] > 0 && c[i+2] > 0 {
		c[i]--
		c[i+1]--
		c[i+2]--
		return meldsOnly(c, i)
	}
	return false
}

// bruteDist returns the exact target distance of a 13-tile hand if it is at
// most 2, else 3 (meaning "3 or more").
func bruteDist(c tile.Counts) int {
	for k := range c {
		if c[k] < 4 {
			c[k]++
			ok := isComplete(c)
			c[k]--
			if ok {
				return 1
			}
		}
	}
	for x := range c {
		if c[x] == 0 {
			continue
		}
		c[x]--
		for a := range c {
			if c[a] >= 4 {
				continue
			}
			c[a]++
			for b := a; b < tile.NumKinds; b++ {
				if c[b] >= 4 {
					continue
				}
				c[b]++
				ok := isComplete(c)
				c[b]--
				if ok {
					return 2
				}
			}
			c[a]--
		}
		c[x]++
	}
	return 3
}

// nearComplete builds a random complete hand and swaps 1-2 tiles.
func nearComplete(r *rand.Rand) tile.Counts {
	for {
		var c tile.Counts
		for m := 0; m < 4; m++ {
			if r.IntN(2) == 0 {
				k := tile.Kind(r.IntN(tile.NumKinds))
				c[k] += 3
			} else {
				s, n := r.IntN(3), r.IntN(7)
				for j := 0; j < 3; j++ {
					c[s*9+n+j]++
				}
			}
		}
		c[r.IntN(tile.NumKinds)] += 2
		valid := true
		for _, n := range c {
			if n > 4 {
				valid = false
			}
		}
		if !valid {
			continue
		}
		// remove one tile (13 tiles), then swap up to one more.
		removeRandom(r, &c)
		if r.IntN(2) == 0 {
			removeRandom(r, &c)
			addRandom(r, &c)
		}
		return c
	}
}

func removeRandom(r *rand.Rand, c *tile.Counts) {
	for {
		k := r.IntN(tile.NumKinds)
		if c[k] > 0 {
			c[k]--
			return
		}
	}
}

func addRandom(r *rand.Rand, c *tile.Counts) {
	for {
		k := r.IntN(tile.NumKinds)
		if c[k] < 4 {
			c[k]++
			return
		}
	}
}

func TestNormalMatchesBruteForce(t *testing.T) {
	r := rand.New(rand.NewPCG(5, 6))
	e := NewEngine()
	n := testmode.N(400, 120, 50)
	for i := 0; i < n; i++ {
		var c tile.Counts
		switch i % 3 {
		case 0:
			c = randomHand(r, 13)
		case 1:
			c = quadHand(r)
		default:
			c = nearComplete(r)
		}
		ev := e.Evaluate(&c, &NormalTarget)
		want := bruteDist(c)
		got := min(ev.Dist, 3)
		if got != want {
			t.Fatalf("hand %s: dp dist=%d brute=%d", c, ev.Dist, want)
		}
		if ev.Dist <= 2 {
			// ukeire: t lowers the distance iff (H+t) minus some tile is closer.
			var set [tile.NumKinds]bool
			ev.Ukeire(&set)
			for k := range c {
				if c[k] >= 4 {
					if set[k] {
						t.Fatalf("hand %s: ukeire includes fifth copy %s", c, tile.Kind(k))
					}
					continue
				}
				c[k]++
				lowers := isComplete(c)
				for x := range c {
					if c[x] == 0 || lowers {
						continue
					}
					c[x]--
					lowers = bruteDist(c) < ev.Dist
					c[x]++
				}
				c[k]--
				if lowers != set[k] {
					t.Fatalf("hand %s: ukeire[%s] = %v, brute %v", c, tile.Kind(k), set[k], lowers)
				}
			}
		}
	}
}

func kindStrings(ks []tile.Kind) []string {
	out := make([]string, len(ks))
	for i, k := range ks {
		out[i] = k.String()
	}
	return out
}

func parseKinds(s string) []string {
	ts := tile.MustParseHand(s)
	tile.Sort(ts)
	out := tile.Strings(ts)
	return slices.Compact(out)
}

func TestNormalUkeireKnown(t *testing.T) {
	cases := []struct {
		hand, ukeire string
		shanten      int
	}{
		{"123456789m1234p", "14p", 0},
		{"123456789m11p45s", "36s", 0},
		{"123456789m1112p", "23p", 0},
		{"1112345678999m", "123456789m", 0},
		{"123456789m1111p", "123456789m23456789p123456789s1234567z", 1}, // any kind but 1p becomes a tanki
	}
	for _, tc := range cases {
		res := NormalResult(tile.MustCounts(tc.hand))
		if res.Shanten != tc.shanten || !slices.Equal(kindStrings(res.Ukeire), parseKinds(tc.ukeire)) {
			t.Errorf("%s: got %d %v, want %d %v", tc.hand, res.Shanten, kindStrings(res.Ukeire), tc.shanten, parseKinds(tc.ukeire))
		}
	}
}

func TestChiitoitsu(t *testing.T) {
	cases := []struct {
		hand    string
		shanten int
		ukeire  string // "*" = every kind held at most once
	}{
		{"1122m3344p5566s7z", 0, "7z"},
		{"1111m2233p4455s6z", 2, "*"}, // quad = one pair
		{"1111m2222m3333m4z", 6, "*"},
		{"19m19p19s1234567z", 6, "19m19p19s1234567z"},
		{"1122m33p44s55667z", 0, "7z"},
		{"119m22p33s4455z67z", 1, "9m67z"},
	}
	for _, tc := range cases {
		c := tile.MustCounts(tc.hand)
		if c.Total() != 13 {
			t.Fatalf("fixture %s has %d tiles", tc.hand, c.Total())
		}
		res := Chiitoitsu(c)
		if res.Shanten != tc.shanten {
			t.Errorf("%s: shanten %d, want %d", tc.hand, res.Shanten, tc.shanten)
		}
		var want []string
		if tc.ukeire == "*" {
			for k := tile.Kind(0); k < tile.NumKinds; k++ {
				if c[k] <= 1 {
					want = append(want, k.String())
				}
			}
		} else {
			want = parseKinds(tc.ukeire)
		}
		if !slices.Equal(kindStrings(res.Ukeire), want) {
			t.Errorf("%s: ukeire %v, want %v", tc.hand, kindStrings(res.Ukeire), want)
		}
	}
}

func TestKokushi(t *testing.T) {
	cases := []struct {
		hand    string
		shanten int
		ukeire  string
	}{
		{"19m19p19s1234567z", 0, "19m19p19s1234567z"}, // 13-sided
		{"119m19p19s123456z", 0, "7z"},
		{"119m19p19s12345z5m", 1, "67z"},
		{"19m19p19s1234z258m", 3, "19m19p19s1234567z"},
		{"1199m19p19s12345z", 1, "67z"},
		{"2345678m234567p", 13, "19m19p19s1234567z"},
	}
	for _, tc := range cases {
		c := tile.MustCounts(tc.hand)
		if c.Total() != 13 {
			t.Fatalf("fixture %s has %d tiles", tc.hand, c.Total())
		}
		res := Kokushi(c)
		if res.Shanten != tc.shanten || !slices.Equal(kindStrings(res.Ukeire), parseKinds(tc.ukeire)) {
			t.Errorf("%s: got %d %v, want %d %v", tc.hand, res.Shanten, kindStrings(res.Ukeire), tc.shanten, parseKinds(tc.ukeire))
		}
	}
}
