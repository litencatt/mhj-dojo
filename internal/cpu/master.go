package cpu

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// The master player (NewMaster) plays as the normal one and sees no more
// than it does (no cheats), but:
//   - Shape: one step from tenpai it ranks discards by the waits each draw
//     leads to, and at tenpai counts a furiten wait at half (shape).
//   - Value: among discards of the lowest shanten it keeps dora (red fives
//     included) and value honors unless dropping them gains doraUkeire
//     unseen accepting tiles each (byValue).
//   - Dama: it does not declare riichi on a closed tenpai worth damaHan
//     without it.
//   - Folding: it folds by the hand's value and its standing (masterFolds)
//     instead of the normal player's fixed steps.
//   - Pushing: against a riichi or an open hand of openMelds calls, it
//     discards the safest tile that keeps the shanten and pushRatio of the
//     ukeire (guarded).
// TestMasterStronger in internal/match measures it against the normal one.

// doraUkeire is the ukeire a dora (or value honor, at half) is worth when
// ranking discards.
const doraUkeire = 4

// bigLead is the lead over second place from which the master folds more.
const bigLead = 12000

// pushRatio is the share, in percent, of the best ukeire a discard must
// keep to be chosen for safety while pushing against a riichi.
const pushRatio = 75

// doraOf returns how many dora t counts for (red five included).
func doraOf(v game.View, t tile.Tile) int {
	n := b2i(t.Red)
	for _, ind := range v.DoraIndicators {
		if t.Kind == tile.DoraFromIndicator(ind.Kind) {
			n++
		}
	}
	return n
}

// byValue reorders the discards of the lowest shanten (the head of opts)
// by ukeire less doraUkeire for each dora the discard gives away and half
// that for a value honor, keeping the order among equals.
func byValue(v game.View, opts []option) {
	n := 1
	for n < len(opts) && opts[n].shanten == opts[0].shanten {
		n++
	}
	score := func(o option) int {
		t := tile.Tile{Kind: o.kind, Red: o.red}
		s := 2 * o.ukeire
		s -= 2 * doraUkeire * doraOf(v, t)
		if o.kind.IsHonor() && isValue(v, o.kind) {
			s -= doraUkeire
		}
		return s
	}
	sortx.Func(opts[:n], func(a, b option) int { return score(b) - score(a) })
}

// handValue estimates the han the viewer's hand has without riichi or its
// waits: dora (red fives included) and value triplets, called or held.
func handValue(v game.View) int {
	me := v.Seats[v.Viewer]
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil {
		tiles = append(tiles, *me.Drawn)
	}
	n := 0
	for _, m := range me.Melds {
		tiles = append(tiles, m.Tiles...)
		if isValue(v, m.Meld.Kind) && m.Meld.Kind.IsHonor() {
			n++
		}
	}
	c := tile.CountsOf(me.Hand)
	if me.Drawn != nil {
		c[me.Drawn.Kind]++
	}
	for k := tile.East; k < tile.NumKinds; k++ {
		if c[k] >= 3 && isValue(v, k) {
			n++
		}
	}
	for _, t := range tiles {
		n += doraOf(v, t)
	}
	return n
}

// standing returns the viewer's rank by points (1 to 4, ties to the lower
// seat) and its lead over the nearest seat below it (0 when last).
func standing(v game.View) (rank, lead int) {
	me := v.Seats[v.Viewer].Points
	rank, lead = 1, -1
	for _, s := range v.Seats {
		switch {
		case s.Seat == v.Viewer:
		case s.Points > me || s.Points == me && s.Seat < v.Viewer:
			rank++
		case lead < 0 || me-s.Points < lead:
			lead = me - s.Points
		}
	}
	return rank, max(0, lead)
}

// masterFolds reports whether the master folds a hand at shanten sh with
// ukeire unseen accepting tiles (ukeire < 0: not known) against threats
// riichi seats: always from two steps; one step from tenpai unless against
// a single riichi with some value (a dora, a value triplet or the deal) and
// no big lead, or when last in the South round; at tenpai only a cheap hand
// on a thin wait, or a cheap one with a big lead (bigLead).
func (p *Player) masterFolds(v game.View, sh, ukeire, threats int) bool {
	if threats == 0 {
		return false
	}
	value := handValue(v)
	if v.Dealer == v.Viewer {
		value++
	}
	rank, lead := standing(v)
	safeLead := rank == 1 && lead >= bigLead
	behind := rank == 4 && v.RoundWind != tile.East
	switch {
	case sh >= 2:
		return true
	case sh == 1 && behind:
		return threats >= 2
	case sh == 1:
		return safeLead || threats >= 2 || value < 1
	}
	// Tenpai: fold a cheap hand on a thin wait, or any cheap hand when
	// well ahead.
	if ukeire < 0 || behind {
		return false
	}
	if safeLead && value < 2 {
		return true
	}
	return value == 0 && (ukeire <= 2 || threats >= 2 && ukeire <= 4)
}

// guarded returns, from the ranked opts of a hand pushing against threats,
// the safest discard that keeps the lowest shanten and pushRatio of the
// best ukeire.
func guarded(opts []option, threats [][tile.NumKinds]bool, visible *tile.Counts) option {
	best, bestDanger := opts[0], -1
	for _, o := range opts {
		if o.shanten != opts[0].shanten || o.ukeire*100 < opts[0].ukeire*pushRatio {
			continue
		}
		d := 0
		for i := range threats {
			d += danger(o.kind, &threats[i], visible)
		}
		if bestDanger < 0 || d < bestDanger {
			best, bestDanger = o, d
		}
	}
	return best
}

// openMelds is how many open melds make another seat's hand one the master
// guards against while pushing (guarded) and folding (safest), though only
// a riichi makes it fold.
const openMelds = 2

// openThreats adds to the riichi threats the safe kinds (their own river)
// of the other seats with openMelds or more open melds.
func openThreats(v game.View, riichi [][tile.NumKinds]bool) [][tile.NumKinds]bool {
	out := riichi
	for _, s := range v.Seats {
		open := 0
		for _, m := range s.Melds {
			open += b2i(m.Meld.Open)
		}
		if s.Seat != v.Viewer && !s.Riichi && open >= openMelds {
			out = append(out, safeKinds(v, s.Seat))
		}
	}
	return out
}

// shape reweighs the ukeire of the discards of the lowest shanten (the head
// of opts) of a hand with melds calls by what the draws lead to: one step
// from tenpai, each accepting tile counts the unseen tiles of the best wait
// it reaches over tenpaiWait; at tenpai, a furiten wait counts half.
func (p *Player) shape(v game.View, opts []option, tiles []tile.Tile, melds int, visible *tile.Counts) {
	sh := opts[0].shanten
	if sh > 1 {
		return
	}
	var river [tile.NumKinds]bool
	for _, rt := range v.Seats[v.Viewer].River {
		river[rt.Tile.Kind] = true
	}
	all := tile.CountsOf(tiles)
	for i := 0; i < len(opts) && opts[i].shanten == sh; i++ {
		if j := slices.IndexFunc(opts[:i], func(x option) bool { return x.kind == opts[i].kind }); j >= 0 {
			opts[i].ukeire = opts[j].ukeire
			continue
		}
		c := all
		c[opts[i].kind]--
		_, acc := p.shanten(c, melds)
		if sh == 0 {
			if slices.ContainsFunc(acc, func(k tile.Kind) bool { return river[k] }) {
				opts[i].ukeire /= 2
			}
			continue
		}
		sum := 0
		for _, k := range acc {
			left := 4 - visible[k]
			if left <= 0 {
				continue
			}
			c[k]++
			sum += left * p.bestNext(&c, melds, sh-1, visible, k)
			c[k]--
		}
		opts[i].ukeire = sum / tenpaiWait
	}
	sortx.Func(opts, func(a, b option) int {
		if a.shanten != b.shanten {
			return a.shanten - b.shanten
		}
		return b.ukeire - a.ukeire
	})
}

// tenpaiWait is the unseen tiles of a typical two-sided wait, the unit
// shape weighs one step from tenpai by.
const tenpaiWait = 6

// bestNext returns the most unseen accepting tiles of a hand at shanten sh
// the concealed tiles c reach with one discard, drawn having just been
// drawn.
func (p *Player) bestNext(c *tile.Counts, melds, sh int, visible *tile.Counts, drawn tile.Kind) int {
	best := 0
	for j := range c {
		if c[j] == 0 {
			continue
		}
		c[j]--
		if s, acc := p.shanten(*c, melds); s == sh {
			u := 0
			for _, k := range acc {
				u += max(0, 4-visible[k]-b2i(k == drawn))
			}
			best = max(best, u)
		}
		c[j]++
	}
	return best
}

// damaHan is the han from which the master stays dama: a closed tenpai
// whose every wait wins by ron without riichi with at least this many han.
const damaHan = 4

// dama reports whether the master stays dama discarding s from tiles.
func dama(v game.View, tiles []tile.Tile, s string, waits []tile.Kind) bool {
	i := slices.IndexFunc(tiles, func(t tile.Tile) bool { return t.String() == s })
	rest := slices.Delete(slices.Clone(tiles), i, i+1)
	ctx := yaku.Context{Ron: true, Winds: yaku.Winds{Round: v.RoundWind, Seat: v.Seats[v.Viewer].Wind}, DoraIndicators: v.DoraIndicators}
	for _, k := range waits {
		ctx.WinTile = k
		w, ok := yaku.Evaluate(append(slices.Clone(rest), tile.Tile{Kind: k}), ctx)
		if !ok || !w.HasYaku() || w.HanTotal < damaHan {
			return false
		}
	}
	return len(waits) > 0
}
