// Package shanten computes shanten numbers and ukeire.
//
// The normal (4 melds + pair) shanten is computed as a target distance:
// shanten(H) = min |W \ H| - 1 over complete hands W with at most 4 copies of
// each tile. W is built from per-suit tables produced by a small dynamic
// program; SuitRule restricts which groups a suit may contribute, which is how
// package yakushanten expresses yaku constraints on the same engine.
package shanten

import (
	"github.com/litencatt/mhj-dojo/internal/memo"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

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

// rankMasks maps each entry of a Table to the ranks one more tile of which
// lowers it (bit i for rank i): the ranks where some cheapest target behind
// the entry needs more tiles than the suit holds. Only TrackTrips tables
// reach entries with free triplets (r > 0), so the others leave track nil
// and take 32 bytes.
type rankMasks struct {
	r0    [5][2]uint16
	track *[5][2][MaxTrips]uint16
}

func (m *rankMasks) at(k, p, r int) uint16 {
	if r == 0 {
		return m.r0[k][p]
	}
	if m.track == nil { // no free triplets without TrackTrips
		return 0
	}
	return m.track[k][p][r-1]
}

// suitEntry is a memoized table, with its masks once Ukeire has needed them
// (most tables are never asked for ukeire, so they don't carry the masks).
// Ukeire fills masks in after the entry is in the memo, although memo.Memo
// says its values never change: the table itself never does, and the
// engine is single-threaded, so no reader sees a half-written entry.
type suitEntry struct {
	t     Table
	masks *rankMasks
}

type memoKey struct {
	c    [9]int8
	n    int8
	rule SuitRule
}

// MemoGen is the number of suit tables in each generation of NewEngine's
// memo (see memo.Memo), which holds at most twice as many: ~7 MiB at ~127
// bytes per table, map included. A practice session's per-yaku analysis
// (every row of every discard candidate, and the advice's waits) reuses
// tables across several turns and rewinds; below ~28,000 its misses grow
// (see docs/api.md "Memory").
const MemoGen = 28_000

// Engine memoizes suit tables. It is not safe for concurrent use.
type Engine struct {
	memo *memo.Memo[memoKey, *suitEntry]
	dp   dpScratch
}

// NewEngine returns an engine with an empty memo of MemoGen tables per
// generation.
func NewEngine() *Engine { return NewEngineGen(MemoGen) }

// NewEngineGen returns an engine with an empty memo of gen tables per
// generation.
func NewEngineGen(gen int) *Engine { return &Engine{memo: memo.New[memoKey, *suitEntry](gen)} }

// MemoSize returns the number of memoized suit tables.
func (e *Engine) MemoSize() int { return e.memo.Len() }

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

var noneEntry = func() *suitEntry {
	en := &suitEntry{masks: new(rankMasks)}
	fill(&en.t)
	en.t[0][0][0] = 0
	return en
}()

var noneTable = &noneEntry.t

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
	return &e.suit(v, n, rule).t
}

func (e *Engine) suit(v [9]int8, n int, rule SuitRule) *suitEntry {
	if rule == RuleNone {
		return noneEntry
	}
	key := memoKey{c: v, n: int8(n), rule: rule}
	if en, ok := e.memo.Get(key); ok {
		return en
	}
	en := new(suitEntry)
	e.dp.suitDP(&v, n, &rule, &en.t, nil)
	e.memo.Put(key, en)
	return en
}

// Strides of suitDP's flat state index x*sX + y*sY + k*sK + p*sP + r.
const (
	sP       = MaxTrips + 1
	sK       = 2 * sP
	sY       = 5 * sK
	sX       = 5 * sY
	dpStates = 5 * sX
)

// dpDecode splits a state index into x, y, k, p, r.
var dpDecode = func() (d [dpStates][5]uint8) {
	for i := range d {
		d[i] = [5]uint8{uint8(i / sX), uint8(i % sX / sY), uint8(i % sY / sK), uint8(i % sK / sP), uint8(i % sP)}
	}
	return d
}()

// dpScratch is suitDP's working memory: two ranks of costs and masks, and
// the lists of their reachable states. suitDP leaves it all zero, so an
// engine reuses one instead of clearing ~12 KiB per table.
type dpScratch struct {
	cost [2][dpStates]uint8
	mask [2][dpStates]uint16
	list [2][dpStates]uint16
}

// suitDP scans ranks left to right. State: x = sequences started two ranks
// ago, y = sequences started one rank ago (both use the current rank),
// k = free melds, p = pair used, r = free triplets. Costs are stored plus one
// so that the zero value means unreachable. Only a few dozen of the 1250
// states of a rank are reachable, so the scan walks a list of them instead of
// the whole array, and clears only those afterwards.
//
// It fills t and, if masks is not nil, masks: alongside each state's cost
// it keeps the union, over the cheapest ways to reach the state, of the
// ranks where the way's target holds more tiles than c. One more tile of
// such a rank lowers that way's cost by one, and so the state's (and the
// entry's) cost; and a way that gets cheaper with one more tile of rank i
// was already a cheapest one needing more of rank i than c holds.
func (d *dpScratch) suitDP(c *[9]int8, n int, rule *SuitRule, t *Table, masks *rankMasks) {
	rMax := 0
	if rule.TrackTrips {
		rMax = MaxTrips
	}
	cur, nxt := &d.cost[0], &d.cost[1]
	mcur, mnxt := &d.mask[0], &d.mask[1]
	live, nlive := d.list[0][:0], d.list[1][:0]
	cur[0] = 1
	live = append(live, 0)
	for i := 0; i < n; i++ {
		ci := int(c[i])
		f := int(rule.Forced[i])
		canSeq := i+2 < n && rule.Seq>>i&1 == 1
		canTrip := rule.Trip>>i&1 == 1
		canPair := rule.Pair>>i&1 == 1
		for _, idx := range live {
			v, m := cur[idx], mcur[idx]
			cur[idx], mcur[idx] = 0, 0
			st := dpDecode[idx]
			x, y, k, p, r := int(st[0]), int(st[1]), int(st[2]), int(st[3]), int(st[4])
			base := x + y + f
			if base > 4 {
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
						nv := int(v) + max(w2-ci, 0)
						ni := y*sX + z*sY + nk*sK + (p+q)*sP + nr
						old := nxt[ni]
						if old == 0 {
							nlive = append(nlive, uint16(ni))
						}
						if old == 0 || nv < int(old) {
							nxt[ni] = uint8(nv)
							if masks != nil {
								mnxt[ni] = m
								if w2 > ci {
									mnxt[ni] |= 1 << i
								}
							}
						} else if masks != nil && nv == int(old) {
							mnxt[ni] |= m
							if w2 > ci {
								mnxt[ni] |= 1 << i
							}
						}
					}
				}
			}
		}
		cur, nxt = nxt, cur
		mcur, mnxt = mnxt, mcur
		live, nlive = nlive, live[:0]
	}
	for k := range t {
		for p := range t[k] {
			for r := range t[k][p] {
				if v := cur[k*sK+p*sP+r]; v == 0 {
					t[k][p][r] = Inf
				} else {
					t[k][p][r] = v - 1
				}
				if m := mcur[k*sK+p*sP+r]; masks != nil && r == 0 {
					masks.r0[k][p] = m
				} else if masks != nil && rMax > 0 {
					masks.track[k][p][r-1] = m
				}
			}
		}
	}
	for _, idx := range live {
		cur[idx], mcur[idx] = 0, 0
	}
}

// Fold combines two tables by min-plus convolution. Tables are mostly
// unreachable entries (all but r = 0 without TrackTrips), so it pairs the
// reachable entries of a with a list of b's.
func Fold(a, b *Table) Table {
	var out Table
	fill(&out)
	type entry struct{ k, p, r, v uint8 }
	var list [len(b) * len(b[0]) * len(b[0][0])]entry
	nb := 0
	for k := range b {
		for p := range b[k] {
			for r, v := range b[k][p] {
				if v != Inf {
					list[nb] = entry{uint8(k), uint8(p), uint8(r), v}
					nb++
				}
			}
		}
	}
	for k1 := range a {
		for p1 := range a[k1] {
			for r1, v1 := range a[k1][p1] {
				if v1 == Inf {
					continue
				}
				for _, e := range list[:nb] {
					k, p := k1+int(e.k), p1+int(e.p)
					if k > 4 || p > 1 {
						continue
					}
					r := min(r1+int(e.r), MaxTrips)
					if s := int(v1) + int(e.v); s < int(out[k][p][r]) {
						out[k][p][r] = uint8(s)
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
	suits  [4]*suitEntry
	others [4]Table // fold of all suits but s
	Dist   int      // min |W \ H|, Inf if no target exists
}

// Evaluate computes the distance of c to target.
func (e *Engine) Evaluate(c *tile.Counts, target *Target) *Eval {
	ev := new(Eval)
	e.EvaluateInto(ev, c, target)
	return ev
}

// EvaluateInto is Evaluate into ev, which a caller can reuse.
func (e *Engine) EvaluateInto(ev *Eval, c *tile.Counts, target *Target) {
	*ev = Eval{e: e, target: target, counts: *c}
	for s := 0; s < 4; s++ {
		v, n := SuitCounts(c, s)
		ev.suits[s] = e.suit(v, n, target.Rules[s])
	}
	// prefix/suffix folds give "all but s" for each s (folding with
	// noneTable is the identity, so the ends are copies).
	var pre [5]Table
	pre[0], pre[1] = *noneTable, ev.suits[0].t
	for s := 1; s < 4; s++ {
		pre[s+1] = Fold(&pre[s], &ev.suits[s].t)
	}
	ev.others[3] = pre[3]
	suf := ev.suits[3].t
	for s := 2; s >= 1; s-- {
		ev.others[s] = Fold(&pre[s], &suf)
		suf = Fold(&ev.suits[s].t, &suf)
	}
	ev.others[0] = suf
	ev.Dist = Final(&pre[4], target.Melds, target.MinTrips)
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

// Ukeire appends to set the kinds whose draw lowers the distance: the kinds
// k with DistWith(k) < Dist, read off the suit tables' masks without
// building a table per kind. One more tile lowers a suit's entry by at most
// one, so the distance drops exactly when some entry e of k's suit with
// table[e] + others[complement of e] = Dist (as FinalPair pairs them) has
// k's rank in its mask.
func (ev *Eval) Ukeire(set *[tile.NumKinds]bool) {
	if ev.Dist == Inf {
		return
	}
	melds, minTrips := ev.target.Melds, ev.target.MinTrips
	for s := 0; s < 4; s++ {
		en := ev.suits[s]
		if en.masks == nil {
			v, n := SuitCounts(&ev.counts, s)
			var t Table
			en.masks = new(rankMasks)
			if ev.target.Rules[s].TrackTrips {
				en.masks.track = new([5][2][MaxTrips]uint16)
			}
			ev.e.dp.suitDP(&v, n, &ev.target.Rules[s], &t, en.masks)
		}
		a, b := &en.t, &ev.others[s]
		var ranks uint16
		for k := 0; k <= melds; k++ {
			for p := 0; p <= 1; p++ {
				for r1 := 0; r1 <= MaxTrips; r1++ {
					v1 := a[k][p][r1]
					if v1 == Inf {
						continue
					}
					for r2 := 0; r2 <= MaxTrips; r2++ {
						v2 := b[melds-k][1-p][r2]
						if v2 != Inf && min(r1+r2, MaxTrips) >= minTrips && int(v1)+int(v2) == ev.Dist {
							ranks |= en.masks.at(k, p, r1)
							break
						}
					}
				}
			}
		}
		for i := 0; ranks != 0; i, ranks = i+1, ranks>>1 {
			if ranks&1 == 1 {
				set[s*9+i] = true
			}
		}
	}
}

// NormalTarget is the unconstrained 4 melds + pair target.
var NormalTarget = Target{
	Rules: [4]SuitRule{RuleAll, RuleAll, RuleAll, RuleHonorAll},
	Melds: 4,
}
