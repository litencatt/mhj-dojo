// Package cpu is the Phase 2a computer player: it always takes a win,
// declares riichi when tenpai, discards for tile efficiency (lowest
// shanten, then most unseen accepting tiles) and folds against a riichi
// when it is two or more steps from tenpai. It is deterministic.
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

// Player decides moves for CPU seats. It keeps a shanten memo, so use one
// Player per game (it is not safe for concurrent use).
type Player struct {
	eng *shanten.Engine
}

// New returns a player with an empty memo.
func New() *Player { return &Player{eng: shanten.NewEngine()} }

// Decide implements game.Decider.
func (p *Player) Decide(v game.View, l game.Legal) game.Action {
	switch {
	case l.Tsumo:
		return game.Action{Type: game.Tsumo}
	case l.Ron:
		return game.Action{Type: game.Ron}
	case l.Skip:
		return game.Action{Type: game.Skip}
	}
	if p.eng.MemoSize() > memoLimit {
		p.eng = shanten.NewEngine()
	}
	me := v.Seats[v.Viewer]
	tiles := append(slices.Clone(me.Hand), *me.Drawn)
	visible := visibleCounts(v, tiles)

	best := p.byEfficiency(tiles, l.Discards, &visible)
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
	shanten int
	ukeire  int
}

// byEfficiency ranks the discards: lowest shanten, most ukeire, then honors
// before terminals before simples, then tile order.
func (p *Player) byEfficiency(tiles []tile.Tile, discards []string, visible *tile.Counts) []option {
	var opts []option
	for _, s := range discards {
		i := slices.IndexFunc(tiles, func(t tile.Tile) bool { return t.String() == s })
		c := tile.CountsOf(slices.Delete(slices.Clone(tiles), i, i+1))
		sh, acc := p.shanten(c)
		n := 0
		for _, k := range acc {
			n += max(0, 4-visible[k])
		}
		opts = append(opts, option{tile: s, kind: tiles[i].Kind, shanten: sh, ukeire: n})
	}
	slices.SortStableFunc(opts, func(a, b option) int {
		switch {
		case a.shanten != b.shanten:
			return a.shanten - b.shanten
		case a.ukeire != b.ukeire:
			return b.ukeire - a.ukeire
		case outer(a.kind) != outer(b.kind):
			return outer(b.kind) - outer(a.kind)
		}
		return int(a.kind) - int(b.kind)
	})
	return opts
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

// shanten returns the lowest shanten over the normal, seven-pairs and
// thirteen-orphans shapes of a 13-tile hand and the kinds that lower it.
func (p *Player) shanten(c tile.Counts) (int, []tile.Kind) {
	ev := p.eng.Evaluate(&c, &shanten.NormalTarget)
	var set [tile.NumKinds]bool
	ev.Ukeire(&set)
	best := ev.Dist - 1
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
	var acc []tile.Kind
	for k, ok := range set {
		if ok {
			acc = append(acc, tile.Kind(k))
		}
	}
	return best, acc
}

// visibleCounts counts the tiles the seat can see: its own, every river and
// the dora indicators.
func visibleCounts(v game.View, own []tile.Tile) tile.Counts {
	c := tile.CountsOf(own)
	for _, s := range v.Seats {
		for _, rt := range s.River {
			c[rt.Tile.Kind]++
		}
	}
	for _, d := range v.DoraIndicators {
		c[d.Kind]++
	}
	return c
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
// genbutsu, then honors with 3 seen, suji, honors with 2 seen, half suji,
// other honors, then terminals, 2/8 and middle tiles.
func danger(k tile.Kind, river map[tile.Kind]bool, visible *tile.Counts) int {
	if river[k] {
		return 0 // genbutsu
	}
	if k.IsHonor() {
		switch visible[k] {
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
