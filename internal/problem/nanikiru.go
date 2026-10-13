package problem

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/litencatt/mhj-dojo/internal/advice"
	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/session"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// nanikiruLevel is the filter of one nanikiru level (docs/problems.md).
type nanikiruLevel struct {
	minShanten, maxShanten int // the best discard's shanten
	minJunme, maxJunme     int
	// sameShanten: the runner-up keeps the best's shanten, so only the
	// ukeire (or the wait) sets them apart.
	sameShanten bool
}

var nanikiruLevels = []nanikiruLevel{
	{minShanten: 1, maxShanten: 1, minJunme: 4, maxJunme: 9},
	{minShanten: 2, maxShanten: 2, minJunme: 3, maxJunme: 8},
	{minShanten: 1, maxShanten: 2, minJunme: 6, maxJunme: 12, sameShanten: true},
}

// Clarity: what sets the best discard apart from the runner-up when they
// share a shanten.
const (
	minUkeireGap   = 4    // more ukeire, by at least this many tiles
	minUkeireRatio = 0.15 // and by at least this share of the runner-up's
	minWaitGap     = 0.5  // or, at 1-shanten with equal ukeire, a wider expected wait
	maxCorrect     = 2    // kinds ranked first
)

// The practice game's winds and length, which the advice counts with.
var winds = yaku.EastEast

// nanikiru plays the practice wall of src with the advice's best discard
// each turn, and returns the first position from a junme picked by src and
// level on that passes the level's filter; nil if none does by the level's
// last junme. The caller holds mu.
func nanikiru(level int, src int64) *Problem {
	lv := nanikiruLevels[level-1]
	w := wall.New(src)
	// The level picks its own junme, so that levels with overlapping
	// filters seldom show the same position for a seed.
	r := rand.New(rand.NewPCG(uint64(src), 0x6e616e69+uint64(level))) // arbitrary PCG stream constant
	from := lv.minJunme + r.IntN(lv.maxJunme-lv.minJunme+1)
	ind := w.DoraIndicators()
	var dora []tile.Kind
	for _, t := range ind {
		dora = append(dora, tile.DoraFromIndicator(t.Kind))
	}
	hand := w.Hand()
	var discards []tile.Tile
	for turn := range lv.maxJunme {
		d, _ := w.Draw(turn)
		tiles := append(slices.Clone(hand), d)
		visible := tile.CountsOf(tiles)
		for _, t := range append(slices.Clone(discards), ind...) {
			visible[t.Kind]++
		}
		adv := advice.Compute(advice.Input{
			Tiles: tiles, Visible: visible, Dora: dora, Turn: turn, MaxTurns: session.DefaultMaxTurns,
			ByDiscard: byDiscard(tiles), Han: func(key string) int { return yaku.HanFor(key, winds) }, Analyzer: analyzer,
		})
		ranked := adv.Ranked()
		if ranked[0].Shanten < lv.minShanten {
			return nil // the advice never goes back up
		}
		if turn+1 >= from && lv.clear(ranked) {
			return &Problem{
				Choose: "one",
				Position: Position{
					Hand: tile.Strings(hand), Drawn: new(d.String()), DoraIndicators: tile.Strings(ind),
					Junme: turn + 1, RoundWind: winds.Round.String(), SeatWind: winds.Seat.String(),
					Discards: tile.Strings(discards), Remaining: apiview.Remaining(&visible),
				},
				answer: answer{tiles: tiles, advice: adv},
			}
		}
		best := ranked[0].Tile
		i := slices.Index(tiles, best)
		hand = slices.Delete(tiles, i, i+1)
		tile.Sort(hand)
		discards = append(discards, best)
	}
	return nil
}

// byDiscard analyzes the 13 tiles left by each kind of tiles: the normal
// row alone, which is all the first three ranking keys need. Without the
// yaku rows the advice breaks a tie on those keys by dora, terminals and
// kind order instead of near yaku, and the whole yaku analysis, nine tenths
// of the work, is left out.
func byDiscard(tiles []tile.Tile) map[tile.Kind][]yakushanten.Result {
	c := tile.CountsOf(tiles)
	out := map[tile.Kind][]yakushanten.Result{}
	for _, t := range tiles {
		if _, ok := out[t.Kind]; !ok {
			c[t.Kind]--
			out[t.Kind] = []yakushanten.Result{analyzer.NormalShanten(c)}
			c[t.Kind]++
		}
	}
	return out
}

// clear reports whether a position fits the level and its best discards
// stand clearly apart from the runner-up (docs/problems.md).
func (lv nanikiruLevel) clear(ranked []advice.Ranked) bool {
	a := ranked[0]
	if a.Shanten < lv.minShanten || a.Shanten > lv.maxShanten {
		return false
	}
	n := 0
	for n < len(ranked) && ranked[n].Rank == 1 {
		n++
	}
	if n > maxCorrect || n == len(ranked) {
		return false
	}
	b := ranked[n]
	switch {
	case b.Shanten > a.Shanten:
		return !lv.sameShanten
	case a.Ukeire-b.Ukeire >= minUkeireGap && float64(a.Ukeire-b.Ukeire) >= minUkeireRatio*float64(b.Ukeire):
		return true
	case a.Shanten == 1 && a.Ukeire == b.Ukeire && a.Wait != nil && b.Wait != nil:
		// Waits come in 0.1 steps: allow for the float error of the gap.
		return *a.Wait-*b.Wait >= minWaitGap-1e-9
	}
	return false
}

// gradeNanikiru grades a discard: correct when it ranks first.
func (p *Problem) gradeNanikiru(ans []tile.Tile) (*Result, error) {
	if len(ans) != 1 {
		return nil, fmt.Errorf("%w: answer must be one tile", ErrInvalid)
	}
	adv := p.answer.advice
	ranked := adv.Ranked()
	res := &Result{ID: p.ID, Best: []string{}}
	var mine advice.Ranked
	for _, r := range ranked {
		e := eval(r)
		res.Ranking = append(res.Ranking, e)
		if r.Rank == 1 {
			res.Best = append(res.Best, e.Tile)
		}
		if r.Tile.Kind == ans[0].Kind {
			mine = r
		}
	}
	e := eval(mine)
	e.Tile = ans[0].String()
	res.Answer = []Eval{e}
	res.Correct = mine.Rank == 1
	text := review(adv, mine.Tile)
	// Then why the best beats the runner-up (the filter makes sure there
	// is one): the advice's note compares the first two discards, which
	// with two correct kinds are both correct, so a correct answer gets
	// the runner-up's review instead.
	runnerUp := ranked[len(res.Best)].Tile
	switch {
	case len(res.Best) == 1 && len(adv.Notes) > 0:
		text += adv.Notes[0]
	case res.Correct:
		text += review(adv, runnerUp)
	}
	res.Text = text + "向聴・有効牌・聴牌時の待ちで比べ、守備と点数は考えない。"
	return res, nil
}

// review is the advice's review of discarding t, without its 前巡の: here
// it is the discard to make.
func review(adv *advice.Advice, t tile.Tile) string {
	return strings.TrimPrefix(adv.Review(t).Text, "前巡の") + "。"
}

func eval(r advice.Ranked) Eval {
	return Eval{Tile: r.Tile.String(), Rank: r.Rank, Shanten: r.Shanten, Ukeire: r.Ukeire, Wait: r.Wait}
}
