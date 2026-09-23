// Package yakushanten computes, per yaku, the shanten toward a complete hand
// that satisfies the yaku, and the tiles that lower it (docs/api.md):
//
//	shanten_Y(H) = min |W \ H| - 1 over complete hands W satisfying Y.
//
// 4-meld yaku are expressed as shanten.Target families on the shared
// target-distance engine: either allowed-group sets per suit (tanyao, chanta,
// junchan, honitsu, chinitsu, toitoi, pinfu) or fixed required groups plus
// free groups (sanshoku, ittsu, iipeikou, yakuhai, sanshoku_doukou,
// shousangen, daisangen, shousuushii, daisuushii), or a triplet count
// (sanankou). Rows whose complete hands are few and fully determined
// (ryanpeikou, chuuren and the chiitoitsu forms of honroutou and tsuuiisou)
// enumerate them explicitly. Shape yaku use containment: e.g. a
// chinitsu-shaped W also satisfies honitsu, and an all-triplet terminal W
// satisfies junchan.
package yakushanten

import (
	"math/bits"

	"github.com/litencatt/mhj2/internal/shanten"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
)

// RowDef names one analysis row.
type RowDef struct {
	Key, Name string
	Yakuman   bool
}

// Rows lists the rows in their fixed API order.
var Rows = []RowDef{
	{"normal", "一般形（役なし）", false},
	{"tanyao", "断么九", false},
	{"pinfu", "平和", false},
	{"iipeikou", "一盃口", false},
	{"ryanpeikou", "二盃口", false},
	{"sanshoku", "三色同順", false},
	{"sanshoku_doukou", "三色同刻", false},
	{"ittsu", "一気通貫", false},
	{"chanta", "混全帯么九", false},
	{"junchan", "純全帯么九", false},
	{"honroutou", "混老頭", false},
	{"honitsu", "混一色", false},
	{"chinitsu", "清一色", false},
	{"toitoi", "対々和", false},
	{"sanankou", "三暗刻", false},
	{"shousangen", "小三元", false},
	{"haku", "役牌 白", false},
	{"hatsu", "役牌 發", false},
	{"chun", "役牌 中", false},
	{"ton", "役牌 東（場風・自風）", false},
	{"chiitoitsu", "七対子", false},
	{"kokushi", "国士無双", true},
	{"suuankou", "四暗刻", true},
	{"daisangen", "大三元", true},
	{"tsuuiisou", "字一色", true},
	{"shousuushii", "小四喜", true},
	{"daisuushii", "大四喜", true},
	{"ryuuiisou", "緑一色", true},
	{"chinroutou", "清老頭", true},
	{"chuuren", "九蓮宝燈", true},
}

// Result is one analysis row.
type Result struct {
	Key, Name string
	Yakuman   bool
	Possible  bool // false = no complete hand satisfies the yaku (∞)
	Shanten   int  // 0 = tenpai; meaningful only if Possible
	Approx    bool
	Ukeire    []tile.Kind
}

// Suit rules for number suits (bit r = rank r+1).
var (
	numTanyao = shanten.SuitRule{Seq: 0x3e, Trip: 0xfe, Pair: 0xfe} // 234..678, 2..8
	numYaochu = shanten.SuitRule{Seq: 0x41, Trip: 0x101, Pair: 0x101}
	numSeq    = shanten.SuitRule{Seq: 0x7f, Pair: 0x1ff}
	numTrip   = shanten.SuitRule{Trip: 0x1ff, Pair: 0x1ff}
	numTrip19 = shanten.SuitRule{Trip: 0x101, Pair: 0x101}
	// 緑一色: 234s sequences, triplets/pairs of 2 3 4 6 8s and 發.
	souGreen   = shanten.SuitRule{Seq: 0x02, Trip: 0xae, Pair: 0xae}
	honorGreen = shanten.SuitRule{Trip: 0x20, Pair: 0x20}
	// Pinfu pair may not be a value tile: 白發中 and 東 (round and seat wind in Phase 1).
	honorPinfu = shanten.SuitRule{Pair: 0x0e} // 南 西 北
)

func all4() [4]shanten.SuitRule {
	return [4]shanten.SuitRule{shanten.RuleAll, shanten.RuleAll, shanten.RuleAll, shanten.RuleHonorAll}
}

func withForcedSeq(r shanten.SuitRule, rank, times int) shanten.SuitRule {
	for j := 0; j < 3; j++ {
		r.Forced[rank+j] += int8(times)
	}
	return r
}

// targets returns the target families of each 4-meld row.
var targets = func() map[string][]shanten.Target {
	m := map[string][]shanten.Target{}
	m["normal"] = []shanten.Target{shanten.NormalTarget}
	m["tanyao"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numTanyao, numTanyao, numTanyao, shanten.RuleNone}, Melds: 4}}
	m["pinfu"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numSeq, numSeq, numSeq, honorPinfu}, Melds: 4}}
	for s := 0; s < 3; s++ {
		for rank := 0; rank < 7; rank++ {
			rules := all4()
			rules[s] = withForcedSeq(rules[s], rank, 2)
			m["iipeikou"] = append(m["iipeikou"], shanten.Target{Rules: rules, Melds: 2})
		}
	}
	for rank := 0; rank < 7; rank++ {
		rules := all4()
		for s := 0; s < 3; s++ {
			rules[s] = withForcedSeq(rules[s], rank, 1)
		}
		m["sanshoku"] = append(m["sanshoku"], shanten.Target{Rules: rules, Melds: 1})
	}
	for s := 0; s < 3; s++ {
		rules := all4()
		for rank := 0; rank < 9; rank++ {
			rules[s].Forced[rank] = 1
		}
		m["ittsu"] = append(m["ittsu"], shanten.Target{Rules: rules, Melds: 1})
	}
	m["chanta"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numYaochu, numYaochu, numYaochu, shanten.RuleHonorAll}, Melds: 4}}
	m["junchan"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numYaochu, numYaochu, numYaochu, shanten.RuleNone}, Melds: 4}}
	for s := 0; s < 3; s++ {
		var hon, chin [4]shanten.SuitRule
		hon[s], hon[tile.Honor] = shanten.RuleAll, shanten.RuleHonorAll
		chin[s] = shanten.RuleAll
		m["honitsu"] = append(m["honitsu"], shanten.Target{Rules: hon, Melds: 4})
		m["chinitsu"] = append(m["chinitsu"], shanten.Target{Rules: chin, Melds: 4})
	}
	m["toitoi"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numTrip, numTrip, numTrip, shanten.RuleHonorAll}, Melds: 4}}
	track := all4()
	for s := range track {
		track[s].TrackTrips = true
	}
	m["sanankou"] = []shanten.Target{{Rules: track, Melds: 4, MinTrips: 3}}
	for key, k := range map[string]tile.Kind{"haku": tile.Haku, "hatsu": tile.Hatsu, "chun": tile.Chun, "ton": tile.East} {
		rules := all4()
		rules[tile.Honor].Forced[k-tile.East] = 3
		m[key] = []shanten.Target{{Rules: rules, Melds: 3}}
	}
	for rank := 0; rank < 9; rank++ {
		rules := all4()
		for s := 0; s < 3; s++ {
			rules[s].Forced[rank] = 3
		}
		m["sanshoku_doukou"] = append(m["sanshoku_doukou"], shanten.Target{Rules: rules, Melds: 1})
	}
	m["honroutou"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numTrip19, numTrip19, numTrip19, shanten.RuleHonorAll}, Melds: 4}}
	m["chinroutou"] = []shanten.Target{{Rules: [4]shanten.SuitRule{numTrip19, numTrip19, numTrip19, shanten.RuleNone}, Melds: 4}}
	m["tsuuiisou"] = []shanten.Target{{Rules: [4]shanten.SuitRule{shanten.RuleNone, shanten.RuleNone, shanten.RuleNone, shanten.RuleHonorAll}, Melds: 4}}
	m["ryuuiisou"] = []shanten.Target{{Rules: [4]shanten.SuitRule{shanten.RuleNone, shanten.RuleNone, souGreen, honorGreen}, Melds: 4}}
	// Closed solo play: every triplet is concealed, so suuankou is the toitoi shape.
	m["suuankou"] = m["toitoi"]
	// n forced honor triplets (offsets from 東) and the pair restricted to one
	// honor (pairOf < 0: any pair) on top of free melds.
	honorTrips := func(trips []int, pairOf int) shanten.Target {
		rules := all4()
		for _, h := range trips {
			rules[tile.Honor].Forced[h] = 3
		}
		if pairOf >= 0 {
			for s := 0; s < 3; s++ {
				rules[s].Pair = 0
			}
			rules[tile.Honor].Pair = 1 << pairOf
		}
		return shanten.Target{Rules: rules, Melds: 4 - len(trips)}
	}
	const haku, hatsu, chun = 4, 5, 6
	m["daisangen"] = []shanten.Target{honorTrips([]int{haku, hatsu, chun}, -1)}
	m["shousangen"] = []shanten.Target{
		honorTrips([]int{hatsu, chun}, haku), honorTrips([]int{haku, chun}, hatsu), honorTrips([]int{haku, hatsu}, chun),
	}
	m["daisuushii"] = []shanten.Target{honorTrips([]int{0, 1, 2, 3}, -1)}
	for pair := 0; pair < 4; pair++ {
		var trips []int
		for w := 0; w < 4; w++ {
			if w != pair {
				trips = append(trips, w)
			}
		}
		m["shousuushii"] = append(m["shousuushii"], honorTrips(trips, pair))
	}
	return m
}()

// kindCount is one entry of a sparse hand.
type kindCount struct {
	k tile.Kind
	n int
}

// explicit lists, per row, complete hands enumerated in full (in addition to
// any target family of the same row). Every hand respects the 4-copy limit.
var explicit = func() map[string][][]kindCount {
	m := map[string][][]kindCount{}
	sparse := func(c *tile.Counts) []kindCount {
		var out []kindCount
		for k, n := range c {
			if n > 0 {
				out = append(out, kindCount{tile.Kind(k), n})
			}
		}
		return out
	}
	var seqs []tile.Kind
	for s := 0; s < 3; s++ {
		for n := 1; n <= 7; n++ {
			seqs = append(seqs, tile.MakeKind(s, n))
		}
	}
	// ryanpeikou: two (possibly equal) sequences twice each + any pair.
	for i, a := range seqs {
		for _, b := range seqs[i:] {
			for p := tile.Kind(0); p < tile.NumKinds; p++ {
				var c tile.Counts
				for j := tile.Kind(0); j < 3; j++ {
					c[a+j] += 2
					c[b+j] += 2
				}
				c[p] += 2
				if withinFour(&c) {
					m["ryanpeikou"] = append(m["ryanpeikou"], sparse(&c))
				}
			}
		}
	}
	// chuuren: 1112345678999 of one suit + any tile of that suit.
	for s := 0; s < 3; s++ {
		for extra := 1; extra <= 9; extra++ {
			var c tile.Counts
			for n, v := range [9]int{3, 1, 1, 1, 1, 1, 1, 1, 3} {
				c[tile.MakeKind(s, n+1)] = v
			}
			c[tile.MakeKind(s, extra)]++
			m["chuuren"] = append(m["chuuren"], sparse(&c))
		}
	}
	// chiitoitsu forms: seven distinct pairs of terminals/honors, or of honors.
	var yaochu []tile.Kind
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if k.IsYaochu() {
			yaochu = append(yaochu, k)
		}
	}
	for mask := 0; mask < 1<<len(yaochu); mask++ {
		if bits.OnesCount(uint(mask)) != 7 {
			continue
		}
		var c tile.Counts
		for i, k := range yaochu {
			if mask>>i&1 == 1 {
				c[k] = 2
			}
		}
		m["honroutou"] = append(m["honroutou"], sparse(&c))
		if mask&(1<<6-1) == 0 { // no terminal among the first six yaochu kinds
			m["tsuuiisou"] = append(m["tsuuiisou"], sparse(&c))
		}
	}
	return m
}()

func withinFour(c *tile.Counts) bool {
	for _, n := range c {
		if n > 4 {
			return false
		}
	}
	return true
}

// Analyzer computes rows, sharing a memo of suit tables across hands.
// It is not safe for concurrent use.
type Analyzer struct {
	eng *shanten.Engine
}

// NewAnalyzer returns an analyzer with an empty memo.
func NewAnalyzer() *Analyzer { return &Analyzer{eng: shanten.NewEngine()} }

// MemoSize returns the number of memoized suit tables.
func (a *Analyzer) MemoSize() int { return a.eng.MemoSize() }

// Analyze returns every row for a 13-tile hand, in Rows order. A 14-tile hand
// is accepted too (shanten -1 = satisfied); its pinfu row is the relaxed value.
func (a *Analyzer) Analyze(c tile.Counts) []Result {
	out := make([]Result, 0, len(Rows))
	var toitoi Result
	for _, row := range Rows {
		var r Result
		switch row.Key {
		case "chiitoitsu":
			r = fromShanten(shanten.Chiitoitsu(c))
		case "kokushi":
			r = fromShanten(shanten.Kokushi(c))
		case "pinfu":
			r = a.pinfu(c)
		case "suuankou":
			r = toitoi // same target family (rows are ordered toitoi first)
		default:
			r = a.family(c, targets[row.Key], explicit[row.Key])
		}
		if row.Key == "toitoi" {
			toitoi = r
		}
		r.Key, r.Name, r.Yakuman = row.Key, row.Name, row.Yakuman
		out = append(out, r)
	}
	return out
}

// Row computes a single row by key (for tests and tools).
func (a *Analyzer) Row(c tile.Counts, key string) Result {
	for _, r := range a.Analyze(c) {
		if r.Key == key {
			return r
		}
	}
	return Result{Key: key}
}

func fromShanten(s shanten.Result) Result {
	return Result{Possible: true, Shanten: s.Shanten, Ukeire: s.Ukeire}
}

// dist returns the minimum distance over a target family and the evals
// achieving it.
func (a *Analyzer) dist(c *tile.Counts, ts []shanten.Target) (int, []*shanten.Eval) {
	best := shanten.Inf
	var at []*shanten.Eval
	for i := range ts {
		ev := a.eng.Evaluate(c, &ts[i])
		switch {
		case ev.Dist < best:
			best, at = ev.Dist, []*shanten.Eval{ev}
		case ev.Dist == best && best != shanten.Inf:
			at = append(at, ev)
		}
	}
	return best, at
}

// target evaluates a family of targets.
func (a *Analyzer) target(c tile.Counts, ts []shanten.Target) Result {
	return a.family(c, ts, nil)
}

// family evaluates a family of targets together with explicitly listed
// complete hands. Only members at the minimum distance can yield ukeire,
// since one draw lowers any distance by at most one.
func (a *Analyzer) family(c tile.Counts, ts []shanten.Target, hands [][]kindCount) Result {
	best, at := a.dist(&c, ts)
	hbest := explicitDist(&c, hands)
	if min(best, hbest) == shanten.Inf {
		return Result{}
	}
	var set [tile.NumKinds]bool
	if best <= hbest {
		for _, ev := range at {
			ev.Ukeire(&set)
		}
	}
	if hbest <= best {
		// For an explicit hand W, the kinds lowering |W \ H| are W \ H itself.
		for _, w := range hands {
			if missing(&c, w) == hbest {
				for _, e := range w {
					if e.n > c[e.k] {
						set[e.k] = true
					}
				}
			}
		}
	}
	return Result{Possible: true, Shanten: min(best, hbest) - 1, Ukeire: kindsOf(&set)}
}

// missing returns |W \ H| for an explicit hand W.
func missing(c *tile.Counts, w []kindCount) int {
	d := 0
	for _, e := range w {
		d += max(e.n-c[e.k], 0)
	}
	return d
}

func explicitDist(c *tile.Counts, hands [][]kindCount) int {
	best := shanten.Inf
	for _, w := range hands {
		best = min(best, missing(c, w))
	}
	return best
}

// pinfu: exact ryanmen check at tenpai, all-sequence approximation otherwise.
func (a *Analyzer) pinfu(c tile.Counts) Result {
	relaxed := a.target(c, targets["pinfu"])
	// The exact wait check only applies to 13-tile hands.
	if !relaxed.Possible || relaxed.Shanten > 0 || c.Total() != 13 {
		relaxed.Approx = relaxed.Possible
		return relaxed
	}
	if waits := PinfuWaits(c); len(waits) > 0 {
		return Result{Possible: true, Shanten: 0, Ukeire: waits}
	}
	// All-sequence tenpai without a two-sided pinfu wait: one more exchange is
	// needed. Ukeire = draws after which some discard reaches exact pinfu tenpai.
	var set [tile.NumKinds]bool
	for t := tile.Kind(0); t < tile.NumKinds; t++ {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		for x := tile.Kind(0); x < tile.NumKinds && !set[t]; x++ {
			if c[x] == 0 || x == t {
				continue
			}
			c[x]--
			if d, _ := a.dist(&c, targets["pinfu"]); d == 1 && len(PinfuWaits(c)) > 0 {
				set[t] = true
			}
			c[x]++
		}
		c[t]--
	}
	return Result{Possible: true, Shanten: 1, Approx: true, Ukeire: kindsOf(&set)}
}

// PinfuWaits returns the kinds that complete a 13-tile hand into four
// sequences + a non-value pair with the winning tile on a two-sided wait.
func PinfuWaits(c tile.Counts) []tile.Kind {
	ctx := yaku.Context{RoundWind: tile.East, SeatWind: tile.East}
	var set [tile.NumKinds]bool
	for t := tile.Kind(0); t < tile.NumKinds; t++ {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		for _, d := range yaku.Decompose(c) {
			if isPinfuReading(d, t, ctx) {
				set[t] = true
				break
			}
		}
		c[t]--
	}
	return kindsOf(&set)
}

func isPinfuReading(d yaku.Decomposition, win tile.Kind, ctx yaku.Context) bool {
	if d.Pair >= tile.Haku || d.Pair == ctx.RoundWind || d.Pair == ctx.SeatWind {
		return false
	}
	ryanmen := false
	for _, m := range d.Melds {
		if m.Type != yaku.Seq {
			return false
		}
		ryanmen = ryanmen || yaku.IsRyanmen(m, win)
	}
	return ryanmen
}

func kindsOf(set *[tile.NumKinds]bool) []tile.Kind {
	var out []tile.Kind
	for k, ok := range set {
		if ok {
			out = append(out, tile.Kind(k))
		}
	}
	return out
}
