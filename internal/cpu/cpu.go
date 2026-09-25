// Package cpu is the computer player: it always takes a win, declares
// riichi when tenpai, calls when the hand keeps a yaku (see calls.go),
// discards for tile efficiency (lowest shanten, then most unseen accepting
// tiles) and folds against a riichi when it is two or more steps from
// tenpai. It is deterministic.
package cpu

import (
	"slices"

	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/shanten"
	"github.com/litencatt/mhj2/internal/tile"
)

// foldShanten is the shanten from which the player folds against a riichi.
const foldShanten = 2

// memoLimit resets the shanten memo when it grows past this many tables.
const memoLimit = 100_000

// kyuushuKeep is the thirteen-orphans shanten up to which the player goes
// for kokushi instead of declaring 九種九牌 (ten kinds and a pair, or more).
const kyuushuKeep = 2

// kokushiShanten returns the thirteen-orphans shanten of the viewer's 14
// tiles, drawn tile included (a hand one discard from 13).
func kokushiShanten(v game.View) int {
	me := v.Seats[v.Viewer]
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil {
		tiles = append(tiles, *me.Drawn)
	}
	c := tile.CountsOf(tiles)
	kinds, pair := 0, false
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if k.IsYaochu() && c[k] > 0 {
			kinds++
			pair = pair || c[k] >= 2
		}
	}
	return 13 - kinds - b2i(pair)
}

// Player decides moves for CPU seats. It keeps a shanten memo, so use one
// Player per game (it is not safe for concurrent use).
type Player struct {
	eng *shanten.Engine
}

// New returns a player with an empty memo.
func New() *Player { return &Player{eng: shanten.NewEngine()} }

// Decide implements game.Decider.
func (p *Player) Decide(v game.View, l game.Legal) game.Action {
	if p.eng.MemoSize() > memoLimit {
		p.eng = shanten.NewEngine()
	}
	switch {
	case l.Tsumo:
		return game.Action{Type: game.Tsumo}
	case l.Ron:
		return game.Action{Type: game.Ron}
	case l.Skip:
		if a, ok := p.decideCall(v, l); ok {
			return a
		}
		return game.Action{Type: game.Skip}
	case l.Kyuushu && kokushiShanten(v) > kyuushuKeep:
		return game.Action{Type: game.Kyuushu}
	}
	if len(l.Kan) > 0 {
		if a, ok := p.decideSelfKan(v, l); ok {
			return a
		}
	}
	me := v.Seats[v.Viewer]
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil { // no drawn tile right after a call
		tiles = append(tiles, *me.Drawn)
	}
	visible := v.Visible()

	best := p.byEfficiency(tiles, len(me.Melds), l.Discards, &visible)
	if best[0].shanten >= foldShanten {
		if threats := riichiRivers(v); len(threats) > 0 {
			choice := safest(best, threats, &visible)
			return game.Action{Type: game.Discard, Tile: choice}
		}
	}
	choice := best[0].tile
	if best[0].shanten == 0 && slices.Contains(l.Riichi, choice) {
		return game.Action{Type: game.Riichi, Tile: choice}
	}
	return game.Action{Type: game.Discard, Tile: choice}
}

// option is a discard with the shanten and unseen accepting tiles it leaves.
type option struct {
	tile    string
	kind    tile.Kind
	red     bool
	shanten int
	ukeire  int
}

// byEfficiency ranks the discards: lowest shanten, most ukeire, then honors
// before terminals before simples, then tile order, keeping red fives.
func (p *Player) byEfficiency(tiles []tile.Tile, melds int, discards []string, visible *tile.Counts) []option {
	var opts []option
	for _, s := range discards {
		i := slices.IndexFunc(tiles, func(t tile.Tile) bool { return t.String() == s })
		c := tile.CountsOf(slices.Delete(slices.Clone(tiles), i, i+1))
		sh, acc := p.shanten(c, melds)
		n := 0
		for _, k := range acc {
			n += max(0, 4-visible[k])
		}
		opts = append(opts, option{tile: s, kind: tiles[i].Kind, red: tiles[i].Red, shanten: sh, ukeire: n})
	}
	slices.SortStableFunc(opts, func(a, b option) int {
		switch {
		case a.shanten != b.shanten:
			return a.shanten - b.shanten
		case a.ukeire != b.ukeire:
			return b.ukeire - a.ukeire
		case outer(a.kind) != outer(b.kind):
			return outer(b.kind) - outer(a.kind)
		case a.kind != b.kind:
			return int(a.kind) - int(b.kind)
		case a.red != b.red:
			return b2i(a.red) - b2i(b.red) // a red five is dora: discard the plain one
		}
		return 0
	})
	return opts
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// outer ranks how isolated a tile tends to be: honors 2, terminals 1.
func outer(k tile.Kind) int {
	switch {
	case k.IsHonor():
		return 2
	case k.IsTerminal():
		return 1
	}
	return 0
}

// shanten returns the lowest shanten of the concealed tiles c, with melds
// called melds, and the kinds that lower it. Seven pairs and thirteen
// orphans count only without melds.
func (p *Player) shanten(c tile.Counts, melds int) (int, []tile.Kind) {
	target := shanten.NormalTarget
	target.Melds -= melds
	ev := p.eng.Evaluate(&c, &target)
	var set [tile.NumKinds]bool
	ev.Ukeire(&set)
	best := ev.Dist - 1
	if melds > 0 {
		return best, kindsOf(&set)
	}
	for _, r := range []shanten.Result{shanten.Chiitoitsu(c), shanten.Kokushi(c)} {
		if r.Shanten > best {
			continue
		}
		if r.Shanten < best {
			best, set = r.Shanten, [tile.NumKinds]bool{}
		}
		for _, k := range r.Ukeire {
			set[k] = true
		}
	}
	return best, kindsOf(&set)
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

// riichiRivers returns the river kinds of every other seat in riichi.
func riichiRivers(v game.View) []map[tile.Kind]bool {
	var out []map[tile.Kind]bool
	for _, s := range v.Seats {
		if s.Seat == v.Viewer || !s.Riichi {
			continue
		}
		river := map[tile.Kind]bool{}
		for _, rt := range s.River {
			river[rt.Tile.Kind] = true
		}
		out = append(out, river)
	}
	return out
}

// safest picks the discard with the least danger summed over the riichi
// seats, keeping the efficiency order among equals.
func safest(opts []option, threats []map[tile.Kind]bool, visible *tile.Counts) string {
	best, bestDanger := "", -1
	for _, o := range opts {
		d := 0
		for _, river := range threats {
			d += danger(o.kind, river, visible)
		}
		if bestDanger < 0 || d < bestDanger {
			best, bestDanger = o.tile, d
		}
	}
	return best
}

// danger scores how likely a tile is to deal into one riichi (0 = safe):
// genbutsu or an honor with all 4 seen, then honors with 3 seen, suji,
// honors with 2 seen, half suji, other honors, then terminals, 2/8 and
// middle tiles.
func danger(k tile.Kind, river map[tile.Kind]bool, visible *tile.Counts) int {
	if river[k] {
		return 0 // genbutsu
	}
	if k.IsHonor() {
		switch visible[k] {
		case 4:
			return 0 // nobody can wait on it
		case 3:
			return 1
		case 2:
			return 3
		}
		return 6
	}
	n := k.Num()
	lo, hi := n-3 >= 1 && river[k-3], n+3 <= 9 && river[k+3]
	switch {
	case (n <= 3 && hi) || (n >= 7 && lo) || (lo && hi):
		return 2 // suji
	case lo || hi:
		return 5 // half suji of 4, 5, 6
	case n == 1 || n == 9:
		return 7
	case n == 2 || n == 8:
		return 8
	}
	return 9
}
