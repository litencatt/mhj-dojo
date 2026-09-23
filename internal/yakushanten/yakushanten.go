// Package yakushanten computes, per yaku, the shanten toward a complete hand
// that satisfies the yaku, and the tiles that lower it (docs/api.md):
//
//	shanten_Y(H) = min |W \ H| - 1 over complete hands W satisfying Y.
//
// 4-meld yaku are expressed as shanten.Target families on the shared
// target-distance engine: either allowed-group sets per suit (tanyao, chanta,
// junchan, honitsu, chinitsu, toitoi, pinfu) or fixed required groups plus
// free groups (sanshoku, ittsu, iipeikou, yakuhai), or a triplet count
// (sanankou). Shape yaku use containment: e.g. a chinitsu-shaped W also
// satisfies honitsu, and an all-triplet terminal W satisfies junchan.
package yakushanten

import (
	"github.com/litencatt/mhj2/internal/shanten"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
)

// RowDef names one analysis row.
type RowDef struct{ Key, Name string }

// Rows lists the rows in their fixed API order.
var Rows = []RowDef{
	{"normal", "一般形（役なし）"},
	{"tanyao", "断么九"},
	{"pinfu", "平和"},
	{"iipeikou", "一盃口"},
	{"sanshoku", "三色同順"},
	{"ittsu", "一気通貫"},
	{"chanta", "混全帯么九"},
	{"junchan", "純全帯么九"},
	{"honitsu", "混一色"},
	{"chinitsu", "清一色"},
	{"toitoi", "対々和"},
	{"sanankou", "三暗刻"},
	{"haku", "役牌 白"},
	{"hatsu", "役牌 發"},
	{"chun", "役牌 中"},
	{"ton", "役牌 東（場風・自風）"},
	{"chiitoitsu", "七対子"},
	{"kokushi", "国士無双"},
}

// Result is one analysis row.
type Result struct {
	Key, Name string
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
	return m
}()

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
	for _, row := range Rows {
		var r Result
		switch row.Key {
		case "chiitoitsu":
			r = fromShanten(shanten.Chiitoitsu(c))
		case "kokushi":
			r = fromShanten(shanten.Kokushi(c))
		case "pinfu":
			r = a.pinfu(c)
		default:
			r = a.target(c, targets[row.Key])
		}
		r.Key, r.Name = row.Key, row.Name
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

// target evaluates a family of targets. Only targets at the minimum distance
// can yield ukeire, since one draw lowers any distance by at most one.
func (a *Analyzer) target(c tile.Counts, ts []shanten.Target) Result {
	best, at := a.dist(&c, ts)
	if best == shanten.Inf {
		return Result{}
	}
	var set [tile.NumKinds]bool
	for _, ev := range at {
		ev.Ukeire(&set)
	}
	return Result{Possible: true, Shanten: best - 1, Ukeire: kindsOf(&set)}
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
