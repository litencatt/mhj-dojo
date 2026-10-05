package shanten

import (
	"math/rand/v2"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// randomRule returns RuleAll (RuleHonorAll for the 7 honors) or random
// group bits, with forced tiles now and then.
func randomRule(r *rand.Rand, n int) SuitRule {
	rule := RuleAll
	if n == 7 {
		rule = RuleHonorAll
	}
	if r.IntN(2) == 0 {
		rule = SuitRule{Seq: uint16(r.Uint32()), Trip: uint16(r.Uint32()), Pair: uint16(r.Uint32())}
	}
	if n == 7 {
		rule.Seq = 0
	}
	if r.IntN(3) == 0 {
		for range 1 + r.IntN(3) {
			rule.Forced[r.IntN(n)] += int8(1 + r.IntN(3))
		}
	}
	rule.TrackTrips = r.IntN(4) == 0
	return rule
}

// randomSuit returns random counts and a random rule for one suit.
func randomSuit(r *rand.Rand) ([9]int8, int, SuitRule) {
	n := 9
	if r.IntN(4) == 0 {
		n = 7
	}
	var v [9]int8
	for range r.IntN(15) {
		if i := r.IntN(n); v[i] < 4 {
			v[i]++
		}
	}
	return v, n, randomRule(r, n)
}

// suitDP against the dense scan it replaced, and its masks against the
// definition: bit i of an entry is set iff one more tile of rank i lowers
// the entry.
func TestSuitDPMatchesDenseScan(t *testing.T) {
	r := rand.New(rand.NewPCG(5, 6))
	var dp dpScratch // reused: suitDP must leave it clean
	for i := range testmode.N(100_000, 30_000, 5_000) {
		v, n, rule := randomSuit(r)
		want := refSuitDP(&v, n, &rule)
		var got, got2 Table
		masks := rankMasks{track: new([5][2][MaxTrips]uint16)}
		dp.suitDP(&v, n, &rule, &got, nil)
		dp.suitDP(&v, n, &rule, &got2, &masks)
		if got != *want || got2 != *want {
			t.Fatalf("case %d: counts %v n %d rule %+v: got %v / %v, want %v", i, v, n, rule, got, got2, *want)
		}
		var wantMasks [5][2][MaxTrips + 1]uint16
		for j := 0; j < n; j++ {
			if v[j] >= 4 {
				continue
			}
			v[j]++
			more := refSuitDP(&v, n, &rule)
			v[j]--
			for k := range more {
				for p := range more[k] {
					for q := range more[k][p] {
						if more[k][p][q] < want[k][p][q] {
							wantMasks[k][p][q] |= 1 << j
						}
					}
				}
			}
		}
		for k := range wantMasks {
			for p := range wantMasks[k] {
				for q, want := range wantMasks[k][p] {
					if got := masks.at(k, p, q); got != want {
						t.Fatalf("case %d: counts %v n %d rule %+v: mask (%d, %d, %d) %b, want %b", i, v, n, rule, k, p, q, got, want)
					}
				}
			}
		}
	}
}

// Ukeire (from the masks) against DistWith on every kind, over random hands
// and random targets.
func TestUkeireMatchesDistWith(t *testing.T) {
	r := rand.New(rand.NewPCG(9, 10))
	e := NewEngineGen(256)
	n, some := testmode.N(50_000, 15_000, 3_000), 0
	for i := range n {
		c := randomHand(r, 13+r.IntN(2))
		target := NormalTarget
		if r.IntN(4) != 0 {
			for s := range target.Rules {
				target.Rules[s] = randomRule(r, 9-2*(s/tile.Honor))
				if r.IntN(5) == 0 {
					target.Rules[s] = RuleNone
				}
			}
			target.Melds = 1 + r.IntN(4)
			if r.IntN(4) == 0 {
				target.MinTrips = r.IntN(4)
			}
		}
		ev := e.Evaluate(&c, &target)
		var got, want [tile.NumKinds]bool
		ev.Ukeire(&got)
		if ev.Dist != Inf {
			for k := range tile.NumKinds {
				want[k] = c[k] < 4 && ev.DistWith(tile.Kind(k)) < ev.Dist
			}
		}
		if got != want {
			t.Fatalf("case %d: hand %s target %+v: ukeire %v, want %v", i, c, target, kinds(&got), kinds(&want))
		}
		if kinds(&want) != nil {
			some++
		}
	}
	if some < n/2 {
		t.Fatalf("only %d of %d cases have ukeire", some, n)
	}
}

// Fold against the full scan it replaced, on suit tables and their folds.
func TestFoldMatchesFullScan(t *testing.T) {
	r := rand.New(rand.NewPCG(11, 12))
	var dp dpScratch
	table := func() Table {
		var t Table
		v, n, rule := randomSuit(r)
		dp.suitDP(&v, n, &rule, &t, nil)
		return t
	}
	for i := range testmode.N(100_000, 30_000, 5_000) {
		a, b := table(), table()
		if r.IntN(2) == 0 {
			a = Fold(&a, &b)
			b = table()
		}
		if got, want := Fold(&a, &b), refFold(&a, &b); got != want {
			t.Fatalf("case %d: Fold(%v, %v) = %v, want %v", i, a, b, got, want)
		}
	}
}

func BenchmarkSuitDP(b *testing.B) {
	r := rand.New(rand.NewPCG(7, 8))
	type in struct {
		v    [9]int8
		n    int
		rule SuitRule
	}
	ins := make([]in, 256)
	for i := range ins {
		ins[i].v, ins[i].n, ins[i].rule = randomSuit(r)
	}
	var t Table
	var dp dpScratch
	for i := 0; b.Loop(); i++ {
		x := &ins[i%len(ins)]
		dp.suitDP(&x.v, x.n, &x.rule, &t, nil)
	}
}

// refSuitDP is the dense-scan suitDP before issue #197, kept as an oracle:
// it scans ranks left to right. State: x = sequences started two ranks
// ago, y = sequences started one rank ago (both use the current rank),
// k = free melds, p = pair used, r = free triplets. Costs are stored plus one
// so that the zero value means unreachable and a rank's state clears with a
// single zeroing assignment.
func refSuitDP(c *[9]int8, n int, rule *SuitRule) *Table {
	type state [5][5][5][2][MaxTrips + 1]uint8
	rMax := 0
	if rule.TrackTrips {
		rMax = MaxTrips
	}
	var bufA, bufB state
	cur, nxt := &bufA, &bufB
	cur[0][0][0][0][0] = 1
	// live[x][y] marks the (x, y) with a reachable state, and maxK the most
	// free melds reached: the scan skips the rest (most of the state space).
	var live, nlive [5][5]bool
	live[0][0] = true
	maxK := 0
	for i := 0; i < n; i++ {
		*nxt = state{}
		nlive = [5][5]bool{}
		nMaxK := 0
		ci := int(c[i])
		f := int(rule.Forced[i])
		canSeq := i+2 < n && rule.Seq>>i&1 == 1
		canTrip := rule.Trip>>i&1 == 1
		canPair := rule.Pair>>i&1 == 1
		for x := 0; x <= 4; x++ {
			for y := 0; x+y <= 4; y++ {
				base := x + y + f
				if base > 4 || !live[x][y] {
					continue
				}
				for k := 0; k <= maxK; k++ {
					for p := 0; p <= 1; p++ {
						for r := 0; r <= rMax; r++ {
							v := cur[x][y][k][p][r]
							if v == 0 {
								continue
							}
							for z := 0; base+z <= 4 && k+z <= 4; z++ {
								if z > 0 && !canSeq {
									break
								}
								for tp := 0; tp <= 1; tp++ {
									if tp == 1 && !canTrip {
										break
									}
									w := base + z + 3*tp
									nk := k + z + tp
									if w > 4 || nk > 4 {
										break
									}
									nr := r
									if rMax > 0 {
										nr = min(r+tp, MaxTrips)
									}
									for q := 0; q <= 1; q++ {
										if q == 1 && (p == 1 || !canPair) {
											break
										}
										w2 := w + 2*q
										if w2 > 4 {
											break
										}
										cost := w2 - ci
										if cost < 0 {
											cost = 0
										}
										nv := int(v) + cost
										if old := nxt[y][z][nk][p+q][nr]; old == 0 || nv < int(old) {
											nxt[y][z][nk][p+q][nr] = uint8(nv)
											nlive[y][z] = true
											nMaxK = max(nMaxK, nk)
										}
									}
								}
							}
						}
					}
				}
			}
		}
		cur, nxt = nxt, cur
		live, maxK = nlive, nMaxK
	}
	t := new(Table)
	for k := range t {
		for p := range t[k] {
			for r := range t[k][p] {
				if v := cur[0][0][k][p][r]; v == 0 {
					t[k][p][r] = Inf
				} else {
					t[k][p][r] = v - 1
				}
			}
		}
	}
	return t
}

// refFold is Fold before issue #197, kept as an oracle.
func refFold(a, b *Table) Table {
	var out Table
	fill(&out)
	for k1 := 0; k1 <= 4; k1++ {
		for p1 := 0; p1 <= 1; p1++ {
			for r1 := 0; r1 <= MaxTrips; r1++ {
				v1 := a[k1][p1][r1]
				if v1 == Inf {
					continue
				}
				for k2 := 0; k1+k2 <= 4; k2++ {
					for p2 := 0; p1+p2 <= 1; p2++ {
						for r2 := 0; r2 <= MaxTrips; r2++ {
							v2 := b[k2][p2][r2]
							if v2 == Inf {
								continue
							}
							r := min(r1+r2, MaxTrips)
							if s := int(v1) + int(v2); s < int(out[k1+k2][p1+p2][r]) {
								out[k1+k2][p1+p2][r] = uint8(s)
							}
						}
					}
				}
			}
		}
	}
	return out
}
