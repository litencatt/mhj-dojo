// Package shanten computes shanten numbers and ukeire.
//
// The normal (4 melds + pair) shanten is computed as a target distance:
// shanten(H) = min |W \ H| - 1 over complete hands W with at most 4 copies of
// each tile. W is built from per-suit tables produced by a small dynamic
// program; SuitRule restricts which groups a suit may contribute, which is how
// package yakushanten expresses yaku constraints on the same engine.
package shanten

import "github.com/litencatt/mhj2/internal/tile"

// Inf marks an unreachable cost.
const Inf = 255

// MaxTrips is the cap of the triplet counter in tables tracking triplets.
const MaxTrips = 4

// SuitRule restricts the groups of a target hand inside one suit.
// Bit r of Seq allows the sequence starting at rank r (0-based, 0..6);
// bit r of Trip/Pair allows the triplet/pair of rank r.
type SuitRule struct {
	Seq, Trip, Pair uint16
	// Forced tiles are always part of the target (fixed groups such as the
	// sequences of sanshoku). They count toward the 4-copy limit and cost
	// but not toward the free meld count of the table.
	Forced [9]int8
	// TrackTrips makes the table distinguish the number of free triplets.
	TrackTrips bool
}

// Common rules.
var (
	RuleAll      = SuitRule{Seq: 0x7f, Trip: 0x1ff, Pair: 0x1ff}
	RuleNone     = SuitRule{}
	RuleHonorAll = SuitRule{Trip: 0x7f, Pair: 0x7f}
)

// Table maps (free melds, pair used, free triplets) to the minimum number of
// tiles missing from the suit's part of the target.
type Table [5][2][MaxTrips + 1]uint8

type memoKey struct {
	c    [9]int8
	n    int8
	rule SuitRule
}

// Engine memoizes suit tables. It is not safe for concurrent use.
type Engine struct {
	memo map[memoKey]*Table
}

// NewEngine returns an engine with an empty memo.
func NewEngine() *Engine { return &Engine{memo: make(map[memoKey]*Table)} }

// MemoSize returns the number of memoized suit tables.
func (e *Engine) MemoSize() int { return len(e.memo) }

// SuitCounts extracts the counts of suit s (9 kinds, or 7 for honors).
func SuitCounts(c *tile.Counts, s int) (v [9]int8, n int) {
	n = 9
	if s == tile.Honor {
		n = 7
	}
	for i := 0; i < n; i++ {
		v[i] = int8(c[s*9+i])
	}
	return v, n
}

var noneTable = func() *Table {
	var t Table
	fill(&t)
	t[0][0][0] = 0
	return &t
}()

func fill(t *Table) {
	for k := range t {
		for p := range t[k] {
			for r := range t[k][p] {
				t[k][p][r] = Inf
			}
		}
	}
}

// Suit returns the (memoized) table of one suit's counts under rule.
func (e *Engine) Suit(v [9]int8, n int, rule SuitRule) *Table {
	if rule == RuleNone {
		return noneTable
	}
	key := memoKey{c: v, n: int8(n), rule: rule}
	if t, ok := e.memo[key]; ok {
		return t
	}
	t := suitDP(&v, n, &rule)
	e.memo[key] = t
	return t
}

// suitDP scans ranks left to right. State: x = sequences started two ranks
// ago, y = sequences started one rank ago (both use the current rank),
// k = free melds, p = pair used, r = free triplets. Costs are stored plus one
// so that the zero value means unreachable and a rank's state clears with a
// single zeroing assignment.
func suitDP(c *[9]int8, n int, rule *SuitRule) *Table {
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

// Fold combines two tables by min-plus convolution.
func Fold(a, b *Table) Table {
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

// Final returns the minimum cost of a with exactly melds free melds, the pair,
// and at least minTrips free triplets.
func Final(a *Table, melds, minTrips int) int {
	best := Inf
	for r := minTrips; r <= MaxTrips; r++ {
		best = min(best, int(a[melds][1][r]))
	}
	return best
}

// FinalPair is Final(Fold(a, b)) without materializing the fold.
func FinalPair(a, b *Table, melds, minTrips int) int {
	best := Inf
	for k := 0; k <= melds; k++ {
		for p := 0; p <= 1; p++ {
			for r1 := 0; r1 <= MaxTrips; r1++ {
				v1 := a[k][p][r1]
				if v1 == Inf {
					continue
				}
				for r2 := 0; r2 <= MaxTrips; r2++ {
					v2 := b[melds-k][1-p][r2]
					if v2 == Inf || min(r1+r2, MaxTrips) < minTrips {
						continue
					}
					best = min(best, int(v1)+int(v2))
				}
			}
		}
	}
	return best
}

// Target describes a family of target hands: a rule per suit, the number of
// free melds to add on top of the forced groups, and a minimum number of free
// triplets (only meaningful with TrackTrips rules).
type Target struct {
	Rules    [4]SuitRule
	Melds    int
	MinTrips int
}

// Eval holds the per-suit tables of a hand under a target, enabling fast
// re-evaluation after drawing one tile.
type Eval struct {
	e      *Engine
	target *Target
	counts tile.Counts
	tables [4]*Table
	others [4]Table // fold of all suits but s
	Dist   int      // min |W \ H|, Inf if no target exists
}

// Evaluate computes the distance of c to target.
func (e *Engine) Evaluate(c *tile.Counts, target *Target) *Eval {
	ev := &Eval{e: e, target: target, counts: *c}
	for s := 0; s < 4; s++ {
		v, n := SuitCounts(c, s)
		ev.tables[s] = e.Suit(v, n, target.Rules[s])
	}
	// prefix/suffix folds give "all but s" for each s.
	var pre [5]Table
	pre[0] = *noneTable
	for s := 0; s < 4; s++ {
		pre[s+1] = Fold(&pre[s], ev.tables[s])
	}
	suf := *noneTable
	for s := 3; s >= 0; s-- {
		ev.others[s] = Fold(&pre[s], &suf)
		suf = Fold(ev.tables[s], &suf)
	}
	ev.Dist = Final(&pre[4], target.Melds, target.MinTrips)
	return ev
}

// Dist is Evaluate(c, target).Dist without the per-suit folds that ukeire
// needs.
func (e *Engine) Dist(c *tile.Counts, target *Target) int {
	var t [4]*Table
	for s := 0; s < 4; s++ {
		v, n := SuitCounts(c, s)
		t[s] = e.Suit(v, n, target.Rules[s])
	}
	ab, cd := Fold(t[0], t[1]), Fold(t[2], t[3])
	return FinalPair(&ab, &cd, target.Melds, target.MinTrips)
}

// DistWith returns the distance after adding one tile of kind k.
func (ev *Eval) DistWith(k tile.Kind) int {
	s := k.Suit()
	c := ev.counts
	c[k]++
	v, n := SuitCounts(&c, s)
	t := ev.e.Suit(v, n, ev.target.Rules[s])
	return FinalPair(t, &ev.others[s], ev.target.Melds, ev.target.MinTrips)
}

// Ukeire appends to set the kinds whose draw lowers the distance.
func (ev *Eval) Ukeire(set *[tile.NumKinds]bool) {
	if ev.Dist == Inf {
		return
	}
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if set[k] || ev.counts[k] >= 4 {
			continue
		}
		if ev.DistWith(k) < ev.Dist {
			set[k] = true
		}
	}
}

// NormalTarget is the unconstrained 4 melds + pair target.
var NormalTarget = Target{
	Rules: [4]SuitRule{RuleAll, RuleAll, RuleAll, RuleHonorAll},
	Melds: 4,
}
