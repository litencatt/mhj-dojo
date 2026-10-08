// Package advice ranks the discards of a practice hand and explains the
// choice with fixed rules, so the same position always gets the same advice
// (docs/api.md "Advice"). Discards are compared, in order, by:
//
//  1. the shanten of the 13 tiles left (lower first): the lowest of the
//     normal form, chiitoitsu and kokushi, as the CPU counts it,
//  2. their ukeire: unseen copies of the tiles that lower it in any form
//     reaching that shanten (more first),
//  3. at 1-shanten or tenpai, the expected wait at tenpai (more first): the
//     wait itself at tenpai; at 1-shanten, for each ukeire tile, the widest
//     wait any discard reaches after drawing it, averaged with the tile's
//     unseen copies as weights,
//  4. near yaku: rows (yakuman aside) at 1-shanten or better, or no further
//     than the normal-form shanten, by count and then by total han,
//  5. dora kept (a dora or red five is discarded last), terminals and
//     honors before simples, and finally kind order.
//
// Rough chances of tenpai and of winning before the practice game ends come
// from a step model: each remaining draw advances the hand by one step with
// probability (useful tiles) / (unseen tiles); see chances.
package advice

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/litencatt/mhj-dojo/internal/handshape"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// Input is one decision: 14 tiles to discard one from.
type Input struct {
	Tiles    []tile.Tile // hand + drawn tile
	Visible  tile.Counts // tiles visible to the player, the 14 tiles included
	Dora     []tile.Kind // dora kinds
	Turn     int         // discards made so far
	MaxTurns int         // the discard that ends the game is number MaxTurns
	// ByDiscard holds, for every kind in Tiles, the per-yaku analysis of the
	// 13 tiles left after discarding it.
	ByDiscard map[tile.Kind][]yakushanten.Result
	Han       func(key string) int
	// Allowed, when set, keeps only the rows of the yaku it allows out of
	// the near yaku (the dojo's learned yaku); nil allows every row.
	Allowed func(key string) bool
	// Analyzer computes the shanten of hypothetical hands (the waits).
	Analyzer *yakushanten.Analyzer
}

// Advice is the ranked discards and the notes for one decision.
type Advice struct {
	Candidates   []Candidate `json:"candidates"` // the best three discards, best first
	Junme        int         `json:"junme"`      // the discard being chosen: turn + 1
	Phase        string      `json:"phase"`      // early | middle | late
	Guideline    string      `json:"guideline"`
	DrawsLeft    int         `json:"draws_left"`    // draws after this discard
	TenpaiChance float64     `json:"tenpai_chance"` // 0..1, after the best discard
	WinChance    float64     `json:"win_chance"`
	Shape        string      `json:"shape"` // the blocks after the best discard
	NearYaku     []NearYaku  `json:"near_yaku"`
	Notes        []string    `json:"notes"`

	all []cand // every distinct discard, best first
}

// Candidate is one ranked discard.
type Candidate struct {
	Tile        string   `json:"tile"` // exact tile (a plain five before a red one)
	Shanten     int      `json:"shanten"`
	UkeireKinds int      `json:"ukeire_kinds"`
	Ukeire      int      `json:"ukeire"` // unseen copies
	Wait        *float64 `json:"wait"`   // expected wait at tenpai; null above 1-shanten
	Yaku        []string `json:"yaku"`   // names of the near yaku of the 13 tiles left
}

// NearYaku is a yaku at 1-shanten or better, or as close as the fastest hand.
type NearYaku struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Han     int    `json:"han"`
	Shanten int    `json:"shanten"` // the best over all discards
	Kept    bool   `json:"kept"`    // the best discard keeps that shanten
}

// Review compares a discard that was made with the best one.
type Review struct {
	Tile        string `json:"tile"`
	Best        string `json:"best"`
	Rank        int    `json:"rank"`    // 1 = as good as the best (ties share a rank)
	IsBest      bool   `json:"is_best"` // ranks with the best on shanten, ukeire and wait
	Shanten     int    `json:"shanten"`
	BestShanten int    `json:"best_shanten"`
	Ukeire      int    `json:"ukeire"`
	BestUkeire  int    `json:"best_ukeire"`
	Text        string `json:"text"`
}

// Phase bounds: 序盤 up to junme 6, 中盤 up to 12, 終盤 after (or with
// lateDraws draws left).
const (
	earlyEnd  = 6
	middleEnd = 12
	// lateDraws: with this many draws left or fewer it is 終盤 anyway.
	lateDraws = 5
	// typicalWait stands in for the tenpai wait of a hand two or more steps
	// away, whose waits are not known yet.
	typicalWait = 6
	// lowChance is where the late-game guideline calls tenpai unlikely.
	lowChance = 0.3
	maxNear   = 6
)

type cand struct {
	t       tile.Tile
	res     []yakushanten.Result
	shanten int
	form    shanten.Form
	normal  int // normal-form shanten: the near-yaku range
	ukeire  int
	uke     []tile.Kind
	wait    float64
	hasWait bool
	yakuN   int
	yakuHan int
	yaku    []string
	dora    int
}

// allowed reports whether in.Allowed allows the row key.
func (in Input) allowed(key string) bool { return in.Allowed == nil || in.Allowed(key) }

// Compute ranks the discards of in.Tiles.
func Compute(in Input) *Advice {
	w := waiter{a: in.Analyzer, memo: map[tile.Counts]form{}}
	all14 := tile.CountsOf(in.Tiles)
	var cs []cand
	seen := map[tile.Kind]int{}
	for _, t := range in.Tiles {
		if i, ok := seen[t.Kind]; ok {
			if cs[i].t.Red && !t.Red {
				cs[i].t = t // keep the red five: discard the plain one
				cs[i].dora--
			}
			continue
		}
		seen[t.Kind] = len(cs)
		res := in.ByDiscard[t.Kind]
		c := cand{t: t, res: res}
		left := all14
		left[t.Kind]--
		f := lowest(res[0], left)
		c.shanten, c.form, c.uke, c.normal = f.shanten, f.form, f.uke, res[0].Shanten
		for _, k := range c.uke {
			c.ukeire += max(4-in.Visible[k], 0)
		}
		switch c.shanten {
		case 0:
			c.wait, c.hasWait = float64(c.ukeire), true
		case 1:
			c.wait, c.hasWait = w.expected(left, in.Visible, c.uke), true
		}
		for _, r := range res[1:] {
			if r.Possible && !r.Yakuman && r.Shanten <= max(c.normal, 1) && in.allowed(r.Key) {
				c.yakuN++
				c.yakuHan += in.Han(r.Key)
				c.yaku = append(c.yaku, r.Name)
			}
		}
		for _, d := range in.Dora {
			if d == t.Kind {
				c.dora++
			}
		}
		if t.Red {
			c.dora++
		}
		cs = append(cs, c)
	}
	sortx.Func(cs, compare)

	adv := &Advice{all: cs, Junme: in.Turn + 1, DrawsLeft: max(in.MaxTurns-in.Turn-1, 0), NearYaku: []NearYaku{}, Notes: []string{}}
	for _, c := range cs[:min(3, len(cs))] {
		adv.Candidates = append(adv.Candidates, c.export())
	}
	best := cs[0]
	unseen := tile.NumKinds*4 - in.Visible.Total()
	winWait := float64(min(best.ukeire, typicalWait))
	if best.hasWait {
		winWait = best.wait
	}
	adv.TenpaiChance, adv.WinChance = chances(best.shanten, best.ukeire, winWait, unseen, adv.DrawsLeft)
	adv.TenpaiChance, adv.WinChance = round(adv.TenpaiChance, 1000), round(adv.WinChance, 1000)
	adv.Phase, adv.Guideline = phase(adv.Junme, best.shanten, adv.TenpaiChance, adv.DrawsLeft)

	left := all14
	left[best.t.Kind]--
	adv.Shape = "打 " + name(best.t) + " 後: "
	switch best.form {
	case shanten.FormChiitoitsu:
		adv.Shape += pairsShape(left)
	case shanten.FormKokushi:
		adv.Shape += kokushiShape(left)
	default:
		adv.Shape += shape(handshape.Groups(left, 0))
	}
	adv.NearYaku = nearYaku(cs, in.Han, in.allowed)
	if len(cs) > 1 {
		adv.Notes = append(adv.Notes, versus(cs[0], cs[1]))
	}
	var lost []string
	for _, y := range adv.NearYaku {
		if !y.Kept {
			lost = append(lost, y.Name)
		}
	}
	if len(lost) > 0 {
		adv.Notes = append(adv.Notes, fmt.Sprintf("打 %s では %s が遠のく。", name(best.t), strings.Join(lost, "・")))
	}
	return adv
}

// Review compares discarding t with the best discard.
func (a *Advice) Review(t tile.Tile) *Review {
	best := a.all[0]
	var c cand
	rank := 1
	for _, x := range a.all {
		if x.t.Kind == t.Kind {
			c = x
		}
	}
	for _, x := range a.all {
		if primary(x, c) < 0 {
			rank++
		}
	}
	r := &Review{
		Tile: t.String(), Best: best.t.String(), Rank: rank, IsBest: rank == 1,
		Shanten: c.shanten, BestShanten: best.shanten, Ukeire: c.ukeire, BestUkeire: best.ukeire,
	}
	head := "前巡の打 " + name(t) + ": "
	switch {
	case r.IsBest && t.Red && !c.t.Red && best.t.Kind == t.Kind:
		// A plain copy was held: the red five gave up a dora for nothing.
		r.IsBest = false
		r.Text = head + "最善と同じ牌種だが赤ドラを失う（打 " + name(best.t) + " が最善）"
	case r.IsBest && t.Red && !c.t.Red:
		r.IsBest = false
		r.Text = head + "最善（打 " + name(best.t) + "）と同等だが赤ドラを失う"
	case r.IsBest && best.t.Kind == t.Kind:
		r.Text = head + "最善"
	case r.IsBest:
		r.Text = head + "最善（打 " + name(best.t) + " と同等）"
	case c.shanten > best.shanten:
		r.Text = fmt.Sprintf("%s最善（打 %s）より向聴が%dつ遠い（%d位）", head, name(best.t), c.shanten-best.shanten, rank)
	case c.ukeire < best.ukeire:
		r.Text = fmt.Sprintf("%s最善（打 %s）より%sが%d枚少ない（%d枚と%d枚、%d位）", head, name(best.t), ukeTerm(c.shanten), best.ukeire-c.ukeire, c.ukeire, best.ukeire, rank)
	default:
		r.Text = fmt.Sprintf("%s最善（打 %s）より聴牌時の待ちが平均%.1f枚少ない（%d位）", head, name(best.t), waitKey(best)-waitKey(c), rank)
	}
	return r
}

func (c cand) export() Candidate {
	out := Candidate{Tile: c.t.String(), Shanten: c.shanten, UkeireKinds: len(c.uke), Ukeire: c.ukeire, Yaku: c.yaku}
	if out.Yaku == nil {
		out.Yaku = []string{}
	}
	if c.hasWait {
		v := round(c.wait, 10)
		out.Wait = &v
	}
	return out
}

// primary compares the first three keys: shanten, ukeire, expected wait.
func primary(a, b cand) int {
	if d := cmp.Compare(a.shanten, b.shanten); d != 0 {
		return d
	}
	if d := cmp.Compare(b.ukeire, a.ukeire); d != 0 {
		return d
	}
	if a.hasWait && b.hasWait {
		return cmp.Compare(waitKey(b), waitKey(a))
	}
	return 0
}

// waitKey is the expected wait as shown (0.1 steps): closer waits tie, so
// no text ever reports a difference of 0.0.
func waitKey(c cand) float64 { return round(c.wait, 10) }

// compare orders discards best first (see the package comment).
func compare(a, b cand) int {
	if d := primary(a, b); d != 0 {
		return d
	}
	if d := cmp.Compare(b.yakuN, a.yakuN); d != 0 {
		return d
	}
	if d := cmp.Compare(b.yakuHan, a.yakuHan); d != 0 {
		return d
	}
	if d := cmp.Compare(a.dora, b.dora); d != 0 {
		return d
	}
	if ay, by := a.t.Kind.IsYaochu(), b.t.Kind.IsYaochu(); ay != by {
		if ay {
			return -1
		}
		return 1
	}
	return cmp.Compare(a.t.Kind, b.t.Kind)
}

// form is the lowest shanten of a 13-tile hand, the form reaching it and
// the kinds that lower it.
type form struct {
	shanten int
	form    shanten.Form
	uke     []tile.Kind
}

// lowest takes the lowest shanten of the 13 tiles c over the normal form
// (already computed as normal), chiitoitsu and kokushi (shanten.Lowest). It
// assumes a concealed hand: practice mode has no calls.
func lowest(normal yakushanten.Result, c tile.Counts) form {
	var set [tile.NumKinds]bool
	for _, k := range normal.Ukeire {
		set[k] = true
	}
	var f form
	f.shanten, f.form = shanten.Lowest(&c, normal.Shanten, &set)
	for k, ok := range set {
		if ok {
			f.uke = append(f.uke, tile.Kind(k))
		}
	}
	return f
}

// waiter computes expected waits, memoizing the lowest shanten of the
// hypothetical 13-tile hands (many draw/discard pairs lead to the same one).
type waiter struct {
	a    *yakushanten.Analyzer
	memo map[tile.Counts]form
}

func (w *waiter) lowest(c tile.Counts) form {
	f, ok := w.memo[c]
	if !ok {
		f = lowest(w.a.NormalShanten(c), c)
		w.memo[c] = f
	}
	return f
}

// expected returns the expected tenpai wait of a 1-shanten hand c: for each
// ukeire kind with unseen copies, the most unseen waits any discard reaches
// after drawing it (in any form: a chiitoitsu tanki or kokushi wait counts),
// weighted by those copies. The drawn copy counts as seen.
func (w *waiter) expected(c, visible tile.Counts, uke []tile.Kind) float64 {
	var sum, weight float64
	for _, u := range uke {
		r := 4 - visible[u]
		if r <= 0 {
			continue
		}
		c[u]++
		visible[u]++
		best := 0
		for x := range c {
			if c[x] == 0 || tile.Kind(x) == u {
				continue
			}
			c[x]--
			if f := w.lowest(c); f.shanten == 0 {
				n := 0
				for _, k := range f.uke {
					n += max(4-visible[k], 0)
				}
				best = max(best, n)
			}
			c[x]++
		}
		c[u]--
		visible[u]--
		sum += float64(r * best)
		weight += float64(r)
	}
	if weight == 0 {
		return 0
	}
	return sum / weight
}

// chances returns the probabilities of reaching tenpai and of winning within
// draws draws, for a hand at the given shanten: each draw advances one step
// with probability useful/unseen, where useful is ukeire for every step up
// to tenpai and wait for the winning step. A tenpai hand has already reached
// tenpai.
func chances(shanten, ukeire int, wait float64, unseen, draws int) (tenpai, win float64) {
	steps := shanten + 1
	p := func(step int) float64 {
		if unseen <= 0 {
			return 0
		}
		if step == shanten {
			return min(wait/float64(unseen), 1)
		}
		return min(float64(ukeire)/float64(unseen), 1)
	}
	// dist[j] = probability of having advanced j steps.
	dist := make([]float64, steps+1)
	dist[0] = 1
	for range draws {
		for j := steps - 1; j >= 0; j-- {
			moved := dist[j] * p(j)
			dist[j] -= moved
			dist[j+1] += moved
		}
	}
	for j := shanten; j <= steps; j++ {
		tenpai += dist[j]
	}
	return tenpai, dist[steps]
}

// phase names the stage of the game: by junme, except that the last
// lateDraws draws are 終盤 however short the game is.
func phase(junme, shanten int, tenpai float64, draws int) (string, string) {
	switch {
	case draws > lateDraws && junme <= earlyEnd:
		return "early", "序盤は受け入れの広さと好形を優先。浮いた字牌・端牌から切る。"
	case draws > lateDraws && junme <= middleEnd:
		return "middle", "中盤は聴牌までの速さを優先。"
	case draws == 0 && shanten == 0:
		return "late", "最後の打牌。聴牌を保って流局を迎える。"
	case draws == 0:
		return "late", "最後の打牌。この後のツモはない。"
	case shanten == 0:
		return "late", fmt.Sprintf("終盤。聴牌を保って残りツモ%d回で和了を待つ。", draws)
	case tenpai < lowChance:
		return "late", fmt.Sprintf("終盤。残りツモ%d回で聴牌の見込みは低い（約%d%%）。", draws, int(math.Round(tenpai*100)))
	default:
		return "late", fmt.Sprintf("終盤。残りツモ%d回、聴牌までの速さを最優先。", draws)
	}
}

// nearYaku lists the rows (yakuman aside) whose best shanten over all
// discards is 1 or less, or no more than the best normal-form shanten (so a
// near chiitoitsu does not hide the normal-form yaku), closest first, and
// whether the best discard keeps that best.
func nearYaku(cs []cand, han func(string) int, allowed func(string) bool) []NearYaku {
	limit := cs[0].normal
	for _, c := range cs {
		limit = min(limit, c.normal)
	}
	limit = max(limit, 1)
	var out []NearYaku
	for i, r := range cs[0].res {
		if i == 0 || r.Yakuman || !allowed(r.Key) {
			continue
		}
		bestSh, ok := 0, false
		for _, c := range cs {
			if x := c.res[i]; x.Possible && (!ok || x.Shanten < bestSh) {
				bestSh, ok = x.Shanten, true
			}
		}
		if !ok || bestSh > limit {
			continue
		}
		out = append(out, NearYaku{Key: r.Key, Name: r.Name, Han: han(r.Key), Shanten: bestSh, Kept: r.Possible && r.Shanten == bestSh})
	}
	sortx.Func(out, func(a, b NearYaku) int {
		if d := cmp.Compare(a.Shanten, b.Shanten); d != 0 {
			return d
		}
		return cmp.Compare(b.Han, a.Han)
	})
	if out == nil {
		return []NearYaku{}
	}
	return out[:min(len(out), maxNear)]
}

// versus explains why a ranks above b.
func versus(a, b cand) string {
	A, B := name(a.t), name(b.t)
	if a.shanten != b.shanten {
		return fmt.Sprintf("打 %s は%s、打 %s は%s。%s を切るほうが聴牌に%d歩近い。", A, shantenText(a.shanten), B, shantenText(b.shanten), A, b.shanten-a.shanten)
	}
	head := fmt.Sprintf("打 %s と打 %s はどちらも%s。", A, B, shantenText(a.shanten))
	term := ukeTerm(a.shanten)
	if a.ukeire != b.ukeire {
		s := fmt.Sprintf("%s%s を切るほうが%sが%d枚多い（%d枚と%d枚）。", head, A, term, a.ukeire-b.ukeire, a.ukeire, b.ukeire)
		if extra := missingKinds(a.uke, b.uke); len(extra) > 0 {
			s += fmt.Sprintf("打 %s なら %s も%sになる。", A, extra, term)
		}
		return s
	}
	if a.hasWait && b.hasWait && waitKey(a) != waitKey(b) {
		return fmt.Sprintf("%s%sは同じ%d枚だが、%s を切るほうが聴牌時の待ちが平均%.1f枚多い。", head, term, a.ukeire, A, waitKey(a)-waitKey(b))
	}
	same := head + term + "・待ちは同じ。"
	if a.shanten == 0 {
		same = head + "待ちは同じ。"
	}
	switch {
	case a.yakuN != b.yakuN:
		return same + fmt.Sprintf("%s を切るほうが近い役が多い（%s）。", A, strings.Join(a.yaku, "・"))
	case a.yakuHan != b.yakuHan:
		return same + fmt.Sprintf("%s を切るほうが近い役の翻数が高い（%s）。", A, strings.Join(a.yaku, "・"))
	case a.dora != b.dora:
		return same + fmt.Sprintf("%s はドラなので %s から切る。", B, A)
	default:
		return same + "差はほとんどない。"
	}
}

// missingKinds formats the kinds of a that are not in b.
func missingKinds(a, b []tile.Kind) string {
	var out []string
	for _, k := range a {
		if !slices.Contains(b, k) {
			out = append(out, name(tile.Tile{Kind: k}))
		}
	}
	return strings.Join(out, "・")
}

// pairsShape describes a chiitoitsu hand: its pairs and the other tiles.
func pairsShape(c tile.Counts) string {
	pairs := 0
	var rest []string
	for k, n := range c {
		if n >= 2 {
			pairs++
		}
		if n%2 == 1 {
			rest = append(rest, name(tile.Tile{Kind: tile.Kind(k)}))
		}
	}
	s := fmt.Sprintf("七対子: 対子%d", pairs)
	if len(rest) > 0 {
		s += "。浮き牌は " + strings.Join(rest, "・")
	}
	return s
}

// kokushiShape describes a kokushi hand: its terminal and honor kinds and
// whether one is paired.
func kokushiShape(c tile.Counts) string {
	kinds, pair := 0, "なし"
	for k, n := range c {
		if tile.Kind(k).IsYaochu() && n > 0 {
			kinds++
			if n >= 2 {
				pair = "あり"
			}
		}
	}
	return fmt.Sprintf("国士無双: %d種・対子%s", kinds, pair)
}

// shape describes a split: meld and taatsu counts, the pair and the floats.
func shape(gs []handshape.Group) string {
	var n = map[handshape.Type]int{}
	var floats []string
	for _, g := range gs {
		if g.Type == handshape.Float {
			for _, k := range g.Kinds {
				floats = append(floats, name(tile.Tile{Kind: k}))
			}
			continue
		}
		n[g.Type]++
	}
	parts := []string{fmt.Sprintf("面子%d", n[handshape.Seq]+n[handshape.Trip])}
	for _, p := range []struct {
		t     handshape.Type
		label string
	}{{handshape.Ryanmen, "両面"}, {handshape.Kanchan, "嵌張"}, {handshape.Penchan, "辺張"}, {handshape.Toitsu, "対子"}} {
		if n[p.t] > 0 {
			parts = append(parts, fmt.Sprintf("%s%d", p.label, n[p.t]))
		}
	}
	if n[handshape.Pair] > 0 {
		parts = append(parts, "雀頭あり")
	} else {
		parts = append(parts, "雀頭なし")
	}
	s := strings.Join(parts, "・")
	if len(floats) > 0 {
		s += "。浮き牌は " + strings.Join(floats, "・")
	}
	return s
}

var (
	honorNames = [...]string{"東", "南", "西", "北", "白", "發", "中"}
	suitNames  = [...]string{"萬", "筒", "索"}
)

// name writes a tile for the notes as the web UI does: 9萬, 赤5筒, 北.
func name(t tile.Tile) string {
	if t.Kind.IsHonor() {
		return honorNames[t.Kind-tile.East]
	}
	s := strconv.Itoa(t.Kind.Num()) + suitNames[t.Kind.Suit()]
	if t.Red {
		return "赤" + s
	}
	return s
}

func shantenText(s int) string {
	if s == 0 {
		return "聴牌"
	}
	return fmt.Sprintf("%d向聴", s)
}

// ukeTerm is what the useful tiles are called: the wait at tenpai.
func ukeTerm(shanten int) string {
	if shanten == 0 {
		return "待ち"
	}
	return "有効牌"
}

func round(v, unit float64) float64 { return math.Round(v*unit) / unit }
