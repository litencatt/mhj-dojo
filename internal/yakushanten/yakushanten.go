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
// satisfies junchan. Called melds and concealed kans are fixed groups of W
// (AnalyzeWith). W is won by tsumo, as ukeire are draws: a triplet the
// winning tile completes is concealed (sanankou, suuankou), though a ron on
// the same tile would make it open.
package yakushanten

import (
	"math/bits"
	"slices"

	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// RowDef names one analysis row.
type RowDef struct {
	Key, Name string
	Yakuman   bool
}

// Winds are the round and seat winds, which decide the value-wind rows and
// which pairs block pinfu.
type Winds = yaku.Winds

// EastEast is the East round, East seat of practice mode.
var EastEast = yaku.EastEast

// windRows marks where RowsFor inserts the value-wind rows.
const windRows = "winds"

// Rows lists the practice-mode (East, East) rows in their fixed API order.
var Rows = RowsFor(EastEast)

// RowsFor lists the rows for the given winds. The value-wind rows come after
// the dragons: one row when the round and seat winds match (a double wind),
// else the round wind row then the seat wind row.
func RowsFor(w Winds) []RowDef {
	out := make([]RowDef, 0, len(baseRows)+1)
	for _, r := range baseRows {
		if r.Key != windRows {
			out = append(out, r)
			continue
		}
		ri, si := w.Round-tile.East, w.Seat-tile.East
		if ri == si {
			out = append(out, RowDef{yaku.WindKeys[ri], "役牌 " + yaku.WindNames[ri] + "（場風・自風）", false})
			continue
		}
		out = append(out,
			RowDef{yaku.WindKeys[ri], "役牌 " + yaku.WindNames[ri] + "（場風）", false},
			RowDef{yaku.WindKeys[si], "役牌 " + yaku.WindNames[si] + "（自風）", false})
	}
	return out
}

var baseRows = []RowDef{
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
	{windRows, "", false},
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
)

// pinfuTargets allows every sequence and any pair but a value tile: the
// dragons and the round and seat winds.
func pinfuTargets(w Winds) []shanten.Target {
	var pair uint16
	for k := tile.East; k <= tile.North; k++ {
		if k != w.Round && k != w.Seat {
			pair |= 1 << (k - tile.East)
		}
	}
	honor := shanten.SuitRule{Pair: pair}
	return []shanten.Target{{Rules: [4]shanten.SuitRule{numSeq, numSeq, numSeq, honor}, Melds: 4}}
}

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
	m["pinfu"] = pinfuTargets(EastEast) // East, East; analyzers use their own winds
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
	yakuhai := map[string]tile.Kind{"haku": tile.Haku, "hatsu": tile.Hatsu, "chun": tile.Chun}
	for i, key := range yaku.WindKeys {
		yakuhai[key] = tile.East + tile.Kind(i)
	}
	for key, k := range yakuhai {
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
	// Won by tsumo, every triplet of a closed hand is concealed, so suuankou
	// is the toitoi shape (AnalyzeWith drops it for an open hand).
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
	eng    *shanten.Engine
	winds  Winds
	rows   []RowDef
	pinfuT []shanten.Target
	// melds and meldTargets cache each row's targets for the last melds
	// AnalyzeWith saw: every discard candidate of a turn shares them.
	melds       []yaku.Meld
	meldTargets map[string][]shanten.Target
	// comboMelds and comboTargets cache the combo target families (in
	// combosFor order) for the last melds Combos saw.
	comboMelds   []yaku.Meld
	comboTargets [][]shanten.Target
	folds        *foldMemo         // see comboDist
	names        map[string]string // see comboNames
	// rowsMemo and combosMemo hold the last results of AnalyzeWith and
	// Combos by hand: a request asks for the same hand more than once (a
	// game's analysis is also its drawn tile's discard preview, and the
	// hand recorded after a discard is the preview of that discard).
	rowsMemo   resultMemo[[]Result]
	combosMemo resultMemo[[]Combo]
	// scratch buffers of combos, reused across calls.
	todo  []pending
	evald []comboCand
	sel   []comboCand
}

// resultMemoSize is how many hands each result memo holds: a turn's discard
// candidates (at most 14 kinds) and the hand itself, twice over, so a turn's
// results are still there on the next one.
const resultMemoSize = 32

// handKey identifies a hand for the result memos: its concealed tiles and
// fixed melds (at most four).
type handKey struct {
	c     tile.Counts
	melds [4]yaku.Meld
	n     int
}

func keyOf(c *tile.Counts, melds []yaku.Meld) (handKey, bool) {
	k := handKey{c: *c, n: len(melds)}
	if len(melds) > len(k.melds) {
		return k, false
	}
	copy(k.melds[:], melds)
	return k, true
}

// resultMemo is a small FIFO of results by hand. The results are shared
// between callers, which must not modify them. One that is off memoizes
// nothing.
type resultMemo[T any] struct {
	keys []handKey
	vals []T
	next int
	off  bool
}

func (m *resultMemo[T]) get(k *handKey) (T, bool) {
	for i := range m.keys {
		if m.keys[i] == *k {
			return m.vals[i], true
		}
	}
	var zero T
	return zero, false
}

func (m *resultMemo[T]) put(k *handKey, v T) {
	if m.off {
		return
	}
	if len(m.keys) < resultMemoSize {
		m.keys, m.vals = append(m.keys, *k), append(m.vals, v)
		return
	}
	m.keys[m.next], m.vals[m.next] = *k, v
	m.next = (m.next + 1) % resultMemoSize
}

// DisableResultMemo turns off the memo of AnalyzeWith and Combos results,
// for tests comparing results with and without it.
func (a *Analyzer) DisableResultMemo() {
	a.rowsMemo = resultMemo[[]Result]{off: true}
	a.combosMemo = resultMemo[[]Combo]{off: true}
}

// NewAnalyzer returns a practice-mode (East, East) analyzer with an empty memo.
func NewAnalyzer() *Analyzer { return NewAnalyzerFor(EastEast) }

// NewAnalyzerFor returns an analyzer whose rows follow the given winds.
func NewAnalyzerFor(w Winds) *Analyzer {
	return &Analyzer{eng: shanten.NewEngine(), folds: newFoldMemo(), winds: w, rows: RowsFor(w), pinfuT: pinfuTargets(w)}
}

// ForWinds returns an analyzer whose rows follow the given winds and that
// shares this one's memo: the suit tables (and the folds of two of them) do
// not depend on the winds, so a game's next round starts warm instead of
// recomputing the tables its hands share with the last round's. The two
// must not be used concurrently, as one analyzer may not be either. The
// results memo is not shared (the rows differ), only turned off if a's is.
func (a *Analyzer) ForWinds(w Winds) *Analyzer {
	b := &Analyzer{eng: a.eng, folds: a.folds, winds: w, rows: RowsFor(w), pinfuT: pinfuTargets(w)}
	if a.rowsMemo.off {
		b.DisableResultMemo()
	}
	return b
}

// Rows returns the analyzer's rows in API order.
func (a *Analyzer) Rows() []RowDef { return a.rows }

// MemoSize returns the number of memoized suit tables, both generations
// counted (see memo.Memo.Len: a table copied forward counts twice).
func (a *Analyzer) MemoSize() int { return a.eng.MemoSize() }

// Analyze returns every row for a 13-tile hand, in the analyzer's row order. A 14-tile hand
// is accepted too (shanten -1 = satisfied); its pinfu row is the relaxed value.
// The result may be shared with other calls (see AnalyzeWith): do not modify it.
func (a *Analyzer) Analyze(c tile.Counts) []Result {
	return a.AnalyzeWith(c, nil)
}

func (a *Analyzer) analyze(c tile.Counts) []Result {
	out := make([]Result, 0, len(a.rows))
	var toitoi Result
	for _, row := range a.rows {
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

// Rows that no hand with a meld satisfies: seven pairs and thirteen orphans
// have no melds, chuuren needs fourteen concealed tiles, and pinfu and
// ryanpeikou need four concealed sequences.
var needNoMelds = map[string]bool{"pinfu": true, "ryanpeikou": true, "chiitoitsu": true, "kokushi": true, "chuuren": true}

// Rows that need a closed hand; a concealed kan keeps them possible.
var needClosed = map[string]bool{"iipeikou": true, "suuankou": true}

// AnalyzeWith is Analyze for a hand with fixed melds: c holds the concealed
// tiles (13 - 3*len(melds), or 14 - 3*len(melds)) and melds the called melds
// and concealed kans. Each meld is a group of every target hand, standing for
// one of the target's forced groups or for one of its free melds. A called
// meld opens the hand, which rules out the closed-only rows.
//
// The last results are memoized by hand, so the result may be shared with
// other calls: callers must not modify it.
func (a *Analyzer) AnalyzeWith(c tile.Counts, melds []yaku.Meld) []Result {
	k, ok := keyOf(&c, melds)
	if ok {
		if res, hit := a.rowsMemo.get(&k); hit {
			return res
		}
	}
	res := a.analyzeWith(c, melds)
	if ok {
		a.rowsMemo.put(&k, res)
	}
	return res
}

func (a *Analyzer) analyzeWith(c tile.Counts, melds []yaku.Meld) []Result {
	if len(melds) == 0 {
		return a.analyze(c)
	}
	open := slices.ContainsFunc(melds, func(m yaku.Meld) bool { return m.Open })
	// The meld tiles join the hand and the target alike (as forced tiles), so
	// they cost nothing and count toward the 4-copy limit.
	full := c
	for _, m := range melds {
		addMeld(&full, m)
	}
	if a.meldTargets == nil || !slices.Equal(a.melds, melds) {
		a.melds = slices.Clone(melds)
		a.meldTargets = map[string][]shanten.Target{}
		for _, row := range a.rows {
			if !needNoMelds[row.Key] && (!open || !needClosed[row.Key]) {
				a.meldTargets[row.Key] = withMelds(targets[row.Key], melds)
			}
		}
	}
	out := make([]Result, 0, len(a.rows))
	for _, row := range a.rows {
		var r Result
		if ts, ok := a.meldTargets[row.Key]; ok {
			r = a.target(full, ts)
		}
		r.Key, r.Name, r.Yakuman = row.Key, row.Name, row.Yakuman
		out = append(out, r)
	}
	return out
}

// addMeld adds the tiles of m to c.
func addMeld(c *tile.Counts, m yaku.Meld) {
	switch {
	case m.Type == yaku.Seq:
		c[m.Kind]++
		c[m.Kind+1]++
		c[m.Kind+2]++
	case m.Kan:
		c[m.Kind] += 4
	default:
		c[m.Kind] += 3
	}
}

// forcedGroups reads the forced tiles of t back as groups. Every target's
// forced tiles are triplets or runs of sequences, which a scan from the
// lowest rank reads uniquely: three or more copies start with a triplet,
// fewer copies each start a sequence.
func forcedGroups(t *shanten.Target) []yaku.Meld {
	var out []yaku.Meld
	for s := 0; s < 4; s++ {
		f := t.Rules[s].Forced
		for r := 0; r < 9; r++ {
			k := tile.Kind(9*s + r)
			for ; f[r] >= 3; f[r] -= 3 {
				out = append(out, yaku.Meld{Type: yaku.Trip, Kind: k})
			}
			for ; f[r] > 0 && r+2 < 9; f[r]-- {
				f[r+1]--
				f[r+2]--
				out = append(out, yaku.Meld{Type: yaku.Seq, Kind: k})
			}
		}
	}
	return out
}

// withMelds returns the targets of ts that hold melds as fixed groups: each
// meld either stands for a forced group of the same shape (a kan adds its
// fourth tile) or takes a free meld its suit's rule allows. A concealed kan
// taking a free meld counts as one of the concealed triplets MinTrips asks
// for; a called triplet does not.
func withMelds(ts []shanten.Target, melds []yaku.Meld) []shanten.Target {
	var out []shanten.Target
	for i := range ts {
		groups := forcedGroups(&ts[i])
		used := make([]bool, len(groups))
		var rec func(t shanten.Target, j int)
		rec = func(t shanten.Target, j int) {
			if j == len(melds) {
				if !slices.Contains(out, t) {
					out = append(out, t)
				}
				return
			}
			m := melds[j]
			s, rank := m.Kind.Suit(), m.Kind.Num()-1
			for g, fg := range groups {
				if used[g] || fg.Type != m.Type || fg.Kind != m.Kind {
					continue
				}
				used[g] = true
				u := t
				if m.Kan {
					u.Rules[s].Forced[rank]++
				}
				rec(u, j+1)
				used[g] = false
			}
			rule := t.Rules[s]
			bits := rule.Trip
			if m.Type == yaku.Seq {
				bits = rule.Seq
			}
			if t.Melds == 0 || bits>>rank&1 == 0 {
				return
			}
			u := t
			u.Melds--
			f := &u.Rules[s].Forced
			switch {
			case m.Type == yaku.Seq:
				f[rank]++
				f[rank+1]++
				f[rank+2]++
			case m.Kan:
				f[rank] += 4
			default:
				f[rank] += 3
			}
			if m.Kan && !m.Open && u.MinTrips > 0 {
				u.MinTrips--
			}
			rec(u, j+1)
		}
		rec(ts[i], 0)
	}
	return out
}

// TargetsWith returns the target family of the 4-meld row key with melds as
// fixed groups, as AnalyzeWith uses it, for a caller with its own engine
// (the computer player): a hand's distance to it is that of its concealed
// tiles plus WithMeldTiles. It is nil for a row that is not a target family
// or that no hand with these melds satisfies.
func TargetsWith(key string, melds []yaku.Meld) []shanten.Target {
	return withMelds(targets[key], melds)
}

// WithMeldTiles returns c with the tiles of melds added.
func WithMeldTiles(c tile.Counts, melds []yaku.Meld) tile.Counts {
	for _, m := range melds {
		addMeld(&c, m)
	}
	return c
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

// NormalShanten computes just the normal-form (4 melds + pair) row: one
// target family, instead of Analyze's whole row set. A caller that only
// needs this one row (e.g. a tree view listing every node's shanten) does
// much less work, and grows the suit-table memo much less, than calling
// Analyze and reading row 0.
func (a *Analyzer) NormalShanten(c tile.Counts) Result {
	r := a.family(c, targets["normal"], explicit["normal"])
	r.Key, r.Name = "normal", "一般形（役なし）"
	return r
}

func fromShanten(s shanten.Result) Result {
	return Result{Possible: true, Shanten: s.Shanten, Ukeire: s.Ukeire}
}

// dist returns the minimum distance over a target family and the evals
// achieving it. The distances come from the shared fold cache (comboDist);
// only the members at the minimum get a full Eval, for their ukeire.
func (a *Analyzer) dist(c *tile.Counts, ts []shanten.Target) (int, []*shanten.Eval) {
	dd := a.comboDist(c)
	best := shanten.Inf
	var idx []int
	for i := range ts {
		d := dd.dist(&ts[i])
		switch {
		case d < best:
			best, idx = d, append(idx[:0], i)
		case d == best && best != shanten.Inf:
			idx = append(idx, i)
		}
	}
	at := make([]*shanten.Eval, len(idx))
	for j, i := range idx {
		at[j] = a.eng.Evaluate(c, &ts[i])
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
	relaxed := a.target(c, a.pinfuT)
	// The exact wait check only applies to 13-tile hands.
	if !relaxed.Possible || relaxed.Shanten > 0 || c.Total() != 13 {
		relaxed.Approx = relaxed.Possible
		return relaxed
	}
	if waits := PinfuWaitsFor(c, a.winds); len(waits) > 0 {
		return Result{Possible: true, Shanten: 0, Ukeire: waits}
	}
	// All-sequence tenpai without a two-sided pinfu wait: one more exchange is
	// needed. Ukeire = draws after which some discard reaches exact pinfu tenpai.
	return Result{Possible: true, Shanten: 1, Approx: true, Ukeire: a.pinfuUkeire(c, a.pinfuT)}
}

// PinfuWaits is PinfuWaitsFor with the practice-mode winds (East, East).
func PinfuWaits(c tile.Counts) []tile.Kind { return PinfuWaitsFor(c, EastEast) }

// PinfuWaitsFor returns the kinds that complete a 13-tile hand into four
// sequences + a non-value pair with the winning tile on a two-sided wait.
func PinfuWaitsFor(c tile.Counts, w Winds) []tile.Kind {
	ctx := yaku.Context{Winds: w}
	var set [tile.NumKinds]bool
	for t := tile.Kind(0); t < tile.NumKinds; t++ {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		for _, r := range yaku.Readings(c, t) {
			if yaku.IsPinfu(r, ctx) {
				set[t] = true
				break
			}
		}
		c[t]--
	}
	return kindsOf(&set)
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
