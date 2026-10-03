package yakushanten

import (
	"math"
	"math/bits"
	"slices"
	"strings"
	"sync"

	"github.com/litencatt/mhj-dojo/internal/memo"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// Combo is the shanten toward a complete hand that satisfies several yaku at
// once, in a single reading (docs/api.md "Yaku combos"):
//
//	shanten_{Y1..Yn}(H) = min |W \ H| - 1 over complete W satisfying every Yi.
type Combo struct {
	Keys    []string // the yaku, in row order
	Name    string   // the row names joined with "＋"
	Han     int      // sum of the yaku's han (open or closed)
	Shanten int
	Approx  bool // pinfu combos away from tenpai, as the pinfu row
	Ukeire  []tile.Kind
}

// MaxCombos is how many combos Combos returns.
const MaxCombos = 5

// comboYaku are the yaku combos are built from: the non-yakuman rows except
// ryanpeikou and sanankou (whose shapes are not composable target families)
// and the seven-pairs form, which combines only with the tile-set yaku below.
var comboYaku = []string{
	"tanyao", "pinfu", "iipeikou", "sanshoku", "sanshoku_doukou", "ittsu", "chanta", "junchan",
	"honroutou", "honitsu", "chinitsu", "toitoi", "shousangen", "haku", "hatsu", "chun",
}

// comboRedundant are pairs never combined: one would be scored in place of the
// other (junchan over chanta, chinitsu over honitsu), no hand scores both
// (chanta and junchan need a sequence, so they exclude toitoi and honroutou),
// every hand satisfying both is really a different yaku (a tanyao or junchan
// honitsu is a chinitsu, a chanta chinitsu a junchan), or one is part of the
// other (shousangen always holds two dragon triplets, counted with it).
var comboRedundant = map[[2]string]bool{
	{"chanta", "junchan"}: true, {"honitsu", "chinitsu"}: true, {"junchan", "honitsu"}: true,
	{"chanta", "chinitsu"}: true, {"tanyao", "honitsu"}: true, {"chanta", "honroutou"}: true,
	{"junchan", "honroutou"}: true, {"chanta", "toitoi"}: true, {"junchan", "toitoi"}: true,
	{"shousangen", "haku"}: true, {"shousangen", "hatsu"}: true, {"shousangen", "chun"}: true,
}

// withTerminalSeq returns fam with one terminal sequence (123 or 789 of a
// number suit) fixed: chanta and junchan score only with a sequence, unlike
// their rows, which also count the all-triplet (honroutou) hands.
func withTerminalSeq(fam []shanten.Target) []shanten.Target {
	var out []shanten.Target
	for _, t := range fam {
		for s := 0; s < 3; s++ {
			for _, rank := range []int{0, 6} {
				u := t
				u.Rules[s] = withForcedSeq(u.Rules[s], rank, 1)
				u.Melds--
				out = append(out, u)
			}
		}
	}
	return out
}

// shousangenYakuhai is the han of the two dragon triplets every shousangen
// hand holds; a combo with shousangen counts them under its name.
const shousangenYakuhai = 2

func redundant(a, b string) bool {
	return comboRedundant[[2]string{a, b}] || comboRedundant[[2]string{b, a}]
}

// comboDef is one combination of yaku and its complete hands: a target family
// of 4 melds + pair hands, or (seven pairs) the kinds the pairs may use.
type comboDef struct {
	keys    []string
	targets []shanten.Target
	pairs   []uint64 // seven-pairs form: bit k = kind k allowed; one mask per member
	order   int      // index in the list, the last tie-break of the ranking
	// shape numbers the combos by their keys other than the value tiles:
	// combos of the same shape differ only in which value tiles they use.
	shape int
}

func (d *comboDef) has(key string) bool { return slices.Contains(d.keys, key) }

var (
	combosMu    sync.Mutex
	combosByWin = map[Winds][]comboDef{}
)

// combosFor returns the combos of the given winds (built once per winds).
func combosFor(w Winds) []comboDef {
	combosMu.Lock()
	defer combosMu.Unlock()
	if d, ok := combosByWin[w]; ok {
		return d
	}
	d := buildCombos(w)
	combosByWin[w] = d
	return d
}

// buildCombos lists every combination of two or more compatible yaku with at
// least one complete hand: a depth-first search that composes the target
// families one yaku at a time and drops a branch as soon as its family is empty.
func buildCombos(w Winds) []comboDef {
	type cand struct {
		key string
		fam []shanten.Target
	}
	var cands []cand
	for _, key := range comboYaku {
		fam := targets[key]
		switch key {
		case "pinfu":
			fam = pinfuTargets(w)
		case "chanta", "junchan":
			fam = withTerminalSeq(fam)
		}
		cands = append(cands, cand{key, fam})
	}
	for _, r := range RowsFor(w) {
		if slices.Contains(yaku.WindKeys[:], r.Key) && yaku.HanFor(r.Key, w) > 0 {
			cands = append(cands, cand{r.Key, targets[r.Key]})
		}
	}
	var out []comboDef
	eng := shanten.NewEngine()
	var rec func(keys []string, fam []shanten.Target, next int)
	rec = func(keys []string, fam []shanten.Target, next int) {
		if len(keys) >= 2 {
			out = append(out, comboDef{keys: slices.Clone(keys), targets: fam})
		}
		for i := next; i < len(cands); i++ {
			if slices.ContainsFunc(keys, func(k string) bool { return redundant(k, cands[i].key) }) ||
				cands[i].key == "chun" && slices.Contains(keys, "haku") && slices.Contains(keys, "hatsu") { // daisangen
				continue
			}
			f := cands[i].fam
			if len(keys) > 0 {
				// A target no hand fits (e.g. four junchan triplets of one
				// suit) is far from the empty hand.
				f = slices.DeleteFunc(composeFamilies(fam, f), func(t shanten.Target) bool {
					return eng.Dist(&tile.Counts{}, &t) == shanten.Inf
				})
			}
			if len(f) > 0 {
				rec(append(keys, cands[i].key), f, i+1)
			}
		}
	}
	rec(nil, nil, 0)

	// Seven pairs with the tile-set yaku: the pairs are distinct kinds from
	// the allowed set, so at least seven kinds must remain.
	var simples, yaochu, honors uint64
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		switch {
		case k.IsYaochu():
			yaochu |= 1 << k
		default:
			simples |= 1 << k
		}
		if k.IsHonor() {
			honors |= 1 << k
		}
	}
	suit := func(s int) uint64 { return (1<<9 - 1) << (9 * s) }
	pairSets := map[string][]uint64{
		"tanyao":    {simples},
		"honroutou": {yaochu},
		"honitsu":   {suit(0) | honors, suit(1) | honors, suit(2) | honors},
		"chinitsu":  {suit(0), suit(1), suit(2)},
	}
	pairKeys := []string{"tanyao", "honroutou", "honitsu", "chinitsu"}
	for mask := 1; mask < 1<<len(pairKeys); mask++ {
		keys := []string{}
		sets := []uint64{^uint64(0)}
		for i, key := range pairKeys {
			if mask>>i&1 == 0 {
				continue
			}
			if slices.ContainsFunc(keys, func(k string) bool { return redundant(k, key) }) {
				sets = nil
				break
			}
			keys = append(keys, key)
			var next []uint64
			for _, a := range sets {
				for _, b := range pairSets[key] {
					if m := a & b; bits.OnesCount64(m) >= 7 && !slices.Contains(next, m) {
						next = append(next, m)
					}
				}
			}
			sets = next
		}
		if len(sets) > 0 {
			out = append(out, comboDef{keys: append(keys, "chiitoitsu"), pairs: sets})
		}
	}

	order := map[string]int{}
	for i, r := range RowsFor(w) {
		order[r.Key] = i
	}
	shapes := map[string]int{}
	for i := range out {
		out[i].order = i
		sortx.Func(out[i].keys, func(a, b string) int { return order[a] - order[b] })
		var shape []string
		for _, k := range out[i].keys {
			if !isYakuhai(k) {
				shape = append(shape, k)
			}
		}
		sig := strings.Join(shape, "+")
		if _, ok := shapes[sig]; !ok {
			shapes[sig] = len(shapes)
		}
		out[i].shape = shapes[sig]
	}
	return out
}

// composeFamilies returns the targets whose hands satisfy a member of fa and
// a member of fb in one reading.
func composeFamilies(fa, fb []shanten.Target) []shanten.Target {
	var out []shanten.Target
	for i := range fa {
		for j := range fb {
			if t, ok := compose(&fa[i], &fb[j]); ok && !slices.Contains(out, t) {
				out = append(out, t)
			}
		}
	}
	return out
}

// compose intersects two targets. The allowed groups and pairs are the
// intersection of both rules; the fixed groups are the smallest multiset
// holding both targets' fixed groups (a shared group, e.g. the 123m of
// sanshoku and of an iipeikou, is used once), and each must be allowed by the
// intersected rules. ok is false when no complete hand fits.
func compose(a, b *shanten.Target) (shanten.Target, bool) {
	var t shanten.Target
	for s := range t.Rules {
		ra, rb := a.Rules[s], b.Rules[s]
		t.Rules[s] = shanten.SuitRule{Seq: ra.Seq & rb.Seq, Trip: ra.Trip & rb.Trip, Pair: ra.Pair & rb.Pair}
	}
	union := forcedGroups(a)
	pool := slices.Clone(union)
	for _, g := range forcedGroups(b) {
		if i := slices.Index(pool, g); i >= 0 {
			pool = slices.Delete(pool, i, i+1)
		} else {
			union = append(union, g)
		}
	}
	if len(union) > 4 {
		return t, false
	}
	for _, g := range union {
		s, rank := g.Kind.Suit(), g.Kind.Num()-1
		rule := &t.Rules[s]
		allowed := rule.Trip
		if g.Type == yaku.Seq {
			allowed = rule.Seq
		}
		if allowed>>rank&1 == 0 {
			return t, false
		}
		if g.Type == yaku.Seq {
			rule.Forced[rank]++
			rule.Forced[rank+1]++
			rule.Forced[rank+2]++
		} else {
			rule.Forced[rank] += 3
		}
	}
	pairOK, freeOK := false, len(union) == 4
	for s := range t.Rules {
		freeOK = freeOK || t.Rules[s].Seq != 0 || t.Rules[s].Trip != 0
		for r := 0; r < 9; r++ {
			if t.Rules[s].Forced[r] > 4 {
				return t, false
			}
			if t.Rules[s].Pair>>r&1 == 1 && t.Rules[s].Forced[r] <= 2 {
				pairOK = true
			}
		}
	}
	t.Melds = 4 - len(union)
	return t, pairOK && freeOK && sameGroups(forcedGroups(&t), union)
}

// sameGroups reports whether a and b hold the same groups (in any order).
func sameGroups(a, b []yaku.Meld) bool {
	if len(a) != len(b) {
		return false
	}
	pool := slices.Clone(b)
	for _, g := range a {
		i := slices.Index(pool, g)
		if i < 0 {
			return false
		}
		pool = slices.Delete(pool, i, i+1)
	}
	return true
}

// comboCand is a combo whose shanten is known, before ukeire.
type comboCand struct {
	def     *comboDef
	fam     []shanten.Target
	han     int
	shanten int
	approx  bool
	waits   []tile.Kind // pinfu combos at exact tenpai
	// noWait marks a pinfu combo whose relaxed shape is tenpai without a
	// two-sided wait.
	noWait bool
}

// ComboRank orders combos: one step toward tenpai weighs as much as two han,
// with han valued up to mangan (5) plus one step each for haneman (6) and
// baiman (8). Lower is better.
func ComboRank(han, shanten int) int {
	v := min(han, 5)
	if han >= 6 {
		v++
	}
	if han >= 8 {
		v++
	}
	return 2*shanten - v
}

// Combos returns up to MaxCombos combinations of yaku for a 13-tile hand c
// with the fixed melds (as AnalyzeWith), best first; rows is AnalyzeWith's
// result for the same hand. Every combo satisfies all its yaku in one
// reading. The ranking (docs/api.md "Yaku combos"):
//
//  1. combos sort by comboRank, then more han and list order;
//  2. a combo is dropped when a combo of more yaku containing it has the
//     same shanten (it scores more for the same work);
//  3. a combo that differs from a better-ranked one only in which value
//     tiles it uses, with the same han and shanten, is dropped.
//
// The last results are memoized by hand: the concealed tiles and the melds.
// rows is not part of the key, as it only feeds the pruning's lower bounds
// and must be the same hand's rows anyway. The result may be shared with
// other calls: callers must not modify it.
func (a *Analyzer) Combos(c tile.Counts, melds []yaku.Meld, rows []Result) []Combo {
	k, ok := keyOf(&c, melds)
	if ok {
		if res, hit := a.combosMemo.get(&k); hit {
			return res
		}
	}
	res := a.combos(c, melds, rows, true)
	if ok {
		a.combosMemo.put(&k, res)
	}
	return res
}

// pending is a combo to evaluate: its index in the list, its han and the
// lower bounds of its rank and distance.
type pending struct{ i, han, lb, minDist int }

// combos is Combos; prune evaluates the combos best-first by a lower bound
// on their rank and stops once no unevaluated combo can enter the result.
// The lower bound of a combo's shanten is the largest shanten of its yaku's
// rows (a hand satisfying every yaku satisfies each one), except that the
// seven-pairs combos only take it from the rows that include seven pairs.
// Adding evaluated combos never worsens the fifth rank selected, so a bound
// taken from part of them is safe.
func (a *Analyzer) combos(c tile.Counts, melds []yaku.Meld, rows []Result, prune bool) []Combo {
	defs := combosFor(a.winds)
	open := slices.ContainsFunc(melds, func(m yaku.Meld) bool { return m.Open })
	full := c
	for _, m := range melds {
		addMeld(&full, m)
	}
	if len(melds) > 0 && (a.comboTargets == nil || !slices.Equal(a.comboMelds, melds)) {
		a.comboMelds = slices.Clone(melds)
		a.comboTargets = make([][]shanten.Target, len(defs))
		for i := range defs {
			a.comboTargets[i] = withMelds(defs[i].targets, melds)
		}
	}
	rowShanten := make(map[string]int, len(rows))
	for _, r := range rows {
		if r.Possible {
			rowShanten[r.Key] = r.Shanten
		}
	}
	todo := a.todo[:0]
	for i := range defs {
		d := &defs[i]
		// lb bounds the combo's shanten (its rank), dlb its relaxed
		// distance minus one, which the family search may stop at. They
		// differ for pinfu: a relaxed tenpai without a two-sided wait is
		// row shanten 1 but distance 1.
		han, lb, dlb, ok := 0, -1, -1, true
		for _, k := range d.keys {
			if (len(melds) > 0 && needNoMelds[k]) || (open && needClosed[k]) {
				ok = false
			}
			han += yaku.HanOpenFor(k, a.winds, open)
			if k == "shousangen" {
				han += shousangenYakuhai
			}
			s, possible := rowShanten[k]
			if !possible {
				ok = false
			}
			if d.pairs == nil || k == "chiitoitsu" || k == "honroutou" {
				lb = max(lb, s)
				if k == "pinfu" && s == 1 {
					s = 0
				}
				dlb = max(dlb, s)
			}
		}
		if !prune {
			dlb = -1 // no early stop: the reference for TestCombosPruneMatchesFull
		}
		if ok {
			todo = append(todo, pending{i: i, han: han, lb: ComboRank(han, lb), minDist: dlb + 1})
		}
	}
	if prune {
		sortx.Func(todo, func(x, y pending) int { return x.lb - y.lb })
	}
	a.todo = todo
	evald := a.evald[:0]
	dd := a.comboDist(&full)
	bound, level, seen := math.MaxInt, math.MinInt, 0
	for _, p := range todo {
		if prune && p.lb != level {
			level = p.lb
			if len(evald) >= MaxCombos && len(evald) != seen {
				seen = len(evald)
				if sel := a.selectCombos(evald); len(sel) == MaxCombos {
					bound = ComboRank(sel[MaxCombos-1].han, sel[MaxCombos-1].shanten)
				}
			}
		}
		if p.lb > bound {
			break
		}
		fam := defs[p.i].targets
		if len(melds) > 0 {
			fam = a.comboTargets[p.i]
		}
		if cd, ok := a.evalCombo(&defs[p.i], fam, c, dd, p.minDist); ok {
			cd.han = p.han
			evald = append(evald, cd)
		}
	}
	a.evald = evald
	names := a.comboNames()
	var out []Combo
	for _, cd := range a.selectCombos(evald) {
		var ns []string
		for _, k := range cd.def.keys {
			ns = append(ns, names[k])
		}
		co := Combo{Keys: cd.def.keys, Name: strings.Join(ns, "＋"), Han: cd.han, Shanten: cd.shanten, Approx: cd.approx}
		co.Ukeire = a.comboUkeire(&cd, c, dd)
		out = append(out, co)
	}
	return out
}

// comboNames returns each row's name by key for the combo names, shousangen's
// noting the two yakuhai it brings. It is built once per analyzer (its rows
// are fixed) rather than on each of a turn's discard candidates.
func (a *Analyzer) comboNames() map[string]string {
	if a.names == nil {
		a.names = make(map[string]string, len(a.rows))
		for _, r := range a.rows {
			a.names[r.Key] = r.Name
		}
		a.names["shousangen"] += "（役牌×2込み）"
	}
	return a.names
}

// comboDist computes target distances for one hand (with its meld tiles),
// reusing the folds of suit pairs that many targets share. The folds are
// keyed by the engine's memoized tables, so they stay valid across hands
// (the discard candidates of a turn share most suits) while the engine lives.
type comboDist struct {
	eng   *shanten.Engine
	full  *tile.Counts
	v     [4][9]int8
	n     [4]int
	folds *foldMemo
}

// foldMemo memoizes the folds of two suit tables. A table the engine's memo
// dropped and rebuilt is a new pointer, so its folds are just recomputed
// (and the stale entries age out of this memo in turn).
type foldMemo = memo.Memo[[2]*shanten.Table, *shanten.Table]

// foldGen is the number of folds in each generation of an analyzer's fold
// memo (~100 bytes per entry, see docs/api.md "Memory"). A fold is cheap to
// recompute (~0.4 µs, against ~10 µs for a suit table), so this memo is
// kept much smaller than the engine's.
const foldGen = 4_000

func newFoldMemo() *foldMemo { return memo.New[[2]*shanten.Table, *shanten.Table](foldGen) }

// comboDist returns the distances of full, sharing the analyzer's fold memo.
func (a *Analyzer) comboDist(full *tile.Counts) *comboDist {
	return newComboDist(a.eng, full, a.folds)
}

func newComboDist(eng *shanten.Engine, full *tile.Counts, folds *foldMemo) *comboDist {
	d := &comboDist{eng: eng, full: full, folds: folds}
	for s := range 4 {
		d.v[s], d.n[s] = shanten.SuitCounts(full, s)
	}
	return d
}

func (d *comboDist) fold(a, b *shanten.Table) *shanten.Table {
	key := [2]*shanten.Table{a, b}
	if t, ok := d.folds.Get(key); ok {
		return t
	}
	t := shanten.Fold(a, b)
	d.folds.Put(key, &t)
	return &t
}

// dist is shanten.Engine.Dist for the hand.
func (d *comboDist) dist(t *shanten.Target) int {
	var tb [4]*shanten.Table
	for s := range 4 {
		tb[s] = d.eng.Suit(d.v[s], d.n[s], t.Rules[s])
	}
	return shanten.FinalPair(d.fold(tb[0], tb[1]), d.fold(tb[2], tb[3]), t.Melds, t.MinTrips)
}

// evalCombo computes the shanten of combo d for the concealed tiles c; fam
// is d's target family with the melds, dd the distances of c with the meld
// tiles. minDist is a lower bound of the distance: the search over the family
// stops once it is reached. ok is false when no complete hand fits.
func (a *Analyzer) evalCombo(d *comboDef, fam []shanten.Target, c tile.Counts, dd *comboDist, minDist int) (comboCand, bool) {
	cd := comboCand{def: d, fam: fam}
	dist := shanten.Inf
	if d.pairs != nil {
		for _, m := range d.pairs {
			dist = min(dist, pairsDist(&c, m))
		}
	}
	for j := 0; j < len(fam) && dist > minDist; j++ {
		dist = min(dist, dd.dist(&fam[j]))
	}
	if dist == shanten.Inf {
		return cd, false
	}
	cd.shanten = dist - 1
	if d.has("pinfu") {
		cd.approx = true
		if cd.shanten == 0 && c.Total() == 13 {
			if cd.waits = a.comboPinfuWaits(c, fam); len(cd.waits) > 0 {
				cd.approx = false
			} else {
				cd.shanten, cd.noWait = 1, true
			}
		}
	}
	return cd, true
}

// comboUkeire returns the kinds that lower the shanten of an evaluated combo.
func (a *Analyzer) comboUkeire(cd *comboCand, c tile.Counts, dd *comboDist) []tile.Kind {
	switch {
	case cd.def.pairs != nil:
		return pairsUkeire(c, cd.def.pairs, cd.shanten+1)
	case cd.waits != nil:
		return cd.waits
	case cd.noWait:
		return a.pinfuUkeire(c, cd.fam)
	}
	// Only the targets at the combo's distance can yield ukeire.
	var at []shanten.Target
	for i := range cd.fam {
		if dd.dist(&cd.fam[i]) == cd.shanten+1 {
			at = append(at, cd.fam[i])
		}
	}
	return a.target(*dd.full, at).Ukeire
}

// selectCombos applies the ranking of Combos to the evaluated combos.
func (a *Analyzer) selectCombos(evald []comboCand) []comboCand {
	sorted := append(a.sel[:0], evald...)
	a.sel = sorted
	sortx.Func(sorted, func(x, y comboCand) int {
		if d := ComboRank(x.han, x.shanten) - ComboRank(y.han, y.shanten); d != 0 {
			return d
		}
		if x.han != y.han {
			return y.han - x.han
		}
		return x.def.order - y.def.order // equal rank and han: equal shanten too
	})
	out := make([]comboCand, 0, MaxCombos)
	for _, x := range sorted {
		if slices.ContainsFunc(evald, func(y comboCand) bool {
			return len(y.def.keys) > len(x.def.keys) && y.shanten <= x.shanten && subset(x.def.keys, y.def.keys)
		}) {
			continue
		}
		// Only the value tiles differ from a combo already selected.
		if slices.ContainsFunc(out, func(y comboCand) bool {
			return y.def.shape == x.def.shape && y.han == x.han && y.shanten == x.shanten
		}) {
			continue
		}
		if out = append(out, x); len(out) == MaxCombos {
			break
		}
	}
	return out
}

// isYakuhai reports whether key is a value-tile row (dragon or wind).
func isYakuhai(key string) bool {
	return key == "haku" || key == "hatsu" || key == "chun" || slices.Contains(yaku.WindKeys[:], key)
}

// subset reports whether every key of a is in b.
func subset(a, b []string) bool {
	for _, k := range a {
		if !slices.Contains(b, k) {
			return false
		}
	}
	return true
}

// pairsDist is the seven-pairs distance with the pairs taken from the kinds
// of mask: the seven allowed kinds holding the most tiles (up to two each).
func pairsDist(c *tile.Counts, mask uint64) int {
	var have [3]int // allowed kinds holding 0, 1, 2+ tiles
	for k := range c {
		if mask>>k&1 == 1 {
			have[min(c[k], 2)]++
		}
	}
	if have[0]+have[1]+have[2] < 7 {
		return shanten.Inf
	}
	need, dist := 7, 0
	for held := 2; held >= 0; held-- {
		n := min(have[held], need)
		dist += n * (2 - held)
		need -= n
	}
	return dist
}

// pairsUkeire returns the kinds whose draw lowers the seven-pairs distance
// dist over any of the masks.
func pairsUkeire(c tile.Counts, masks []uint64, dist int) []tile.Kind {
	var set [tile.NumKinds]bool
	for k := range c {
		if c[k] >= 4 {
			continue
		}
		c[k]++
		for _, m := range masks {
			if pairsDist(&c, m) < dist {
				set[k] = true
			}
		}
		c[k]--
	}
	return kindsOf(&set)
}

// comboPinfuWaits returns the kinds that complete the closed 13-tile hand c
// into a pinfu reading (two-sided wait) that fits one of the targets ts.
func (a *Analyzer) comboPinfuWaits(c tile.Counts, ts []shanten.Target) []tile.Kind {
	var set [tile.NumKinds]bool
	for w := tile.Kind(0); w < tile.NumKinds; w++ {
		set[w] = a.pinfuWait(&c, w, ts)
	}
	return kindsOf(&set)
}

// pinfuWait reports whether w completes the 13 tiles c into a pinfu reading
// with w on a two-sided wait that fits one of the targets ts. A two-sided
// wait needs two held tiles of w's suit next to it, which rules out most
// kinds before any decomposition.
func (a *Analyzer) pinfuWait(c *tile.Counts, w tile.Kind, ts []shanten.Target) bool {
	if c[w] >= 4 || w.IsHonor() {
		return false
	}
	n := w.Num()
	lo := n >= 3 && c[w-1] > 0 && c[w-2] > 0
	hi := n <= 7 && c[w+1] > 0 && c[w+2] > 0
	if !lo && !hi {
		return false
	}
	ctx := yaku.Context{Winds: a.winds}
	c[w]++
	defer func() { c[w]-- }()
	for _, r := range yaku.Readings(*c, w) {
		if yaku.IsPinfu(r, ctx) && slices.ContainsFunc(ts, func(x shanten.Target) bool { return fits(&r.Decomposition, &x) }) {
			return true
		}
	}
	return false
}

// pinfuUkeire is the fallback of the pinfu row and combos whose relaxed shape
// is tenpai without a two-sided wait: the draws t after which some discard x
// reaches exact tenpai, i.e. some w completes c+t-x with a two-sided wait.
func (a *Analyzer) pinfuUkeire(c tile.Counts, ts []shanten.Target) []tile.Kind {
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
			for w := tile.Kind(0); w < tile.NumKinds && !set[t]; w++ {
				set[t] = a.pinfuWait(&c, w, ts)
			}
			c[x]++
		}
		c[t]--
	}
	return kindsOf(&set)
}

// fits reports whether a decomposition is a hand of target t: every group and
// the pair allowed by the rules, and the fixed groups among the groups.
func fits(d *yaku.Decomposition, t *shanten.Target) bool {
	s, r := d.Pair.Suit(), d.Pair.Num()-1
	if t.Rules[s].Pair>>r&1 == 0 {
		return false
	}
	for _, m := range d.Melds {
		s, r := m.Kind.Suit(), m.Kind.Num()-1
		allowed := t.Rules[s].Trip
		if m.Type == yaku.Seq {
			allowed = t.Rules[s].Seq
		}
		if allowed>>r&1 == 0 {
			return false
		}
	}
	pool := slices.Clone(d.Melds[:])
	for _, g := range forcedGroups(t) {
		i := slices.IndexFunc(pool, func(m yaku.Meld) bool { return m.Type == g.Type && m.Kind == g.Kind })
		if i < 0 {
			return false
		}
		pool = slices.Delete(pool, i, i+1)
	}
	return true
}
