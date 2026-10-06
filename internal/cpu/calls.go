package cpu

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// The player calls only when the hand keeps a yaku to win with: a value
// triplet (dragons, the round wind, its seat wind), tanyao (every meld of
// simples and at most one terminal or honor left in hand), or a yaku route
// (yakuRoutes: honitsu, toitoi, a value pair to triplet) at most
// routeShanten from tenpai. It pons a value tile whenever that does not set
// the hand back, and makes other calls only when they bring it closer to
// tenpai. It never calls while folding against a riichi. An open hand
// without a value triplet then discards toward its nearest route (byYaku).

// decideCall answers a call offer (pon, chii or open kan); ok is false to
// skip.
func (p *Player) decideCall(v game.View, l game.Legal) (game.Action, bool) {
	me := v.Seats[v.Viewer]
	if v.LastDiscard == nil {
		return game.Action{}, false
	}
	visible := v.Visible()
	cur := p.handShanten(me.Hand, len(me.Melds))
	if needsRoute(v, me.Melds) { // as byYaku counts it for the discards
		ms := meldShapes(me.Melds)
		c := tile.CountsOf(me.Hand)
		if routes := yakuRoutes(v, ms, c, &visible); len(routes) > 0 {
			cur = p.routeDist(c, ms, routes)
		}
	}
	if p.folds(v, cur, len(riichiThreats(v))) {
		return game.Action{}, false
	}
	t := *v.LastDiscard
	value := isValue(v, t.Kind)
	best, bestSh := game.Action{}, cur+1
	try := func(a game.Action, used []tile.Tile, meld yaku.Meld, needDiscard bool) {
		rest := removeTiles(me.Hand, used)
		melds := append(meldShapes(me.Melds), meld)
		banned := bannedAfter(a.Type, t.Kind, meld)
		var sh int
		if keepsYaku(v, melds, rest) {
			sh = p.afterCall(rest, len(melds), needDiscard, banned)
		} else {
			sh = p.afterCallRoutes(rest, melds, needDiscard, banned, yakuRoutes(v, melds, tile.CountsOf(rest), &visible))
			if sh > routeShanten {
				return
			}
		}
		limit := cur - 1 // a call must bring the hand closer to tenpai
		if meld.Type == yaku.Trip && value {
			limit = cur // a value triplet is worth it as long as it does not hurt
		}
		if sh <= limit && sh < bestSh {
			best, bestSh = a, sh
		}
	}
	if l.Pon {
		try(game.Action{Type: game.Pon}, pick(me.Hand, t.Kind, 2), yaku.Meld{Type: yaku.Trip, Kind: t.Kind, Open: true}, true)
	}
	if len(l.Kan) > 0 && value { // an open kan only of a value tile
		try(game.Action{Type: game.Kan}, pick(me.Hand, t.Kind, 3), yaku.Meld{Type: yaku.Trip, Kind: t.Kind, Open: true, Kan: true}, false)
	}
	for _, pair := range l.Chii {
		used := byString(me.Hand, pair)
		ks := []tile.Kind{used[0].Kind, used[1].Kind, t.Kind}
		sortx.Ordered(ks)
		try(game.Action{Type: game.Chii, Tiles: pair}, used, yaku.Meld{Type: yaku.Seq, Kind: ks[0], Open: true}, true)
	}
	return best, best.Type != ""
}

// decideSelfKan declares a concealed or added kan on the player's turn when
// it does not set the hand back; in riichi the legal kans already keep the
// waits.
func (p *Player) decideSelfKan(v game.View, l game.Legal) (game.Action, bool) {
	me := v.Seats[v.Viewer]
	if me.Riichi {
		return game.Action{Type: game.Kan, Tile: l.Kan[0]}, true
	}
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil {
		tiles = append(tiles, *me.Drawn)
	}
	n := len(me.Melds)
	now := p.afterCall(tiles, n, true, nil)
	for _, s := range l.Kan {
		k := kindOf(s)
		added := slices.ContainsFunc(me.Melds, func(m game.Called) bool { return m.Meld.Type == yaku.Trip && m.Meld.Kind == k })
		var sh int
		if added {
			sh = p.handShanten(removeTiles(tiles, pick(tiles, k, 1)), n)
		} else {
			sh = p.handShanten(removeTiles(tiles, pick(tiles, k, 4)), n+1)
		}
		if sh <= now {
			return game.Action{Type: game.Kan, Tile: s}, true
		}
	}
	return game.Action{}, false
}

// afterCall returns the shanten of rest (with melds called melds), after
// the best discard when one is due; banned kinds may not be discarded.
func (p *Player) afterCall(rest []tile.Tile, melds int, needDiscard bool, banned []tile.Kind) int {
	if !needDiscard {
		return p.handShanten(rest, melds)
	}
	best := 99
	for i, t := range rest {
		if slices.Contains(banned, t.Kind) {
			continue
		}
		best = min(best, p.handShanten(slices.Delete(slices.Clone(rest), i, i+1), melds))
	}
	return best
}

// routeShanten is how far from tenpai a call toward a yaku route (other
// than a value triplet or tanyao) may leave the hand.
const routeShanten = 2

// route is the targets of one yaku for a hand with fixed melds (see
// yakushanten.TargetsWith).
type route []shanten.Target

// yakuRoutes returns the routes an open hand with these melds and
// concealed tiles c may win on: tanyao, honitsu, toitoi and a triplet of
// each value honor that still has enough tiles left.
func yakuRoutes(v game.View, melds []yaku.Meld, c tile.Counts, visible *tile.Counts) []route {
	var out []route
	add := func(key string) {
		if ts := yakushanten.TargetsWith(key, melds); len(ts) > 0 {
			out = append(out, ts)
		}
	}
	add("tanyao")
	add("honitsu")
	add("toitoi")
	for k := tile.East; k < tile.NumKinds; k++ {
		if !isValue(v, k) || c[k]+4-visible[k] < 3 {
			continue
		}
		if k >= tile.Haku {
			add(dragonKeys[k-tile.Haku])
		} else {
			add(yaku.WindKeys[k-tile.East])
		}
	}
	return out
}

var dragonKeys = [3]string{"haku", "hatsu", "chun"}

// routeDist returns the shanten of concealed tiles c with melds toward the
// nearest of routes.
func (p *Player) routeDist(c tile.Counts, melds []yaku.Meld, routes []route) int {
	full := yakushanten.WithMeldTiles(c, melds)
	best := shanten.Inf
	for _, r := range routes {
		for i := range r {
			best = min(best, p.eng.Dist(&full, &r[i]))
		}
	}
	return best - 1
}

// afterCallRoutes is afterCall toward the nearest of routes.
func (p *Player) afterCallRoutes(rest []tile.Tile, melds []yaku.Meld, needDiscard bool, banned []tile.Kind, routes []route) int {
	c := tile.CountsOf(rest)
	if !needDiscard {
		return p.routeDist(c, melds, routes)
	}
	best := 99
	for k := range c {
		if c[k] == 0 || slices.Contains(banned, tile.Kind(k)) {
			continue
		}
		c[k]--
		best = min(best, p.routeDist(c, melds, routes))
		c[k]++
	}
	return best
}

// byYaku reorders the ranked discards of a hand that needsRoute by the shanten toward its nearest yaku route, keeping the order
// among equals; each option's shanten becomes that route shanten.
func (p *Player) byYaku(v game.View, opts []option, tiles []tile.Tile, visible *tile.Counts) {
	melds := meldShapes(v.Seats[v.Viewer].Melds)
	all := tile.CountsOf(tiles)
	routes := yakuRoutes(v, melds, all, visible)
	if len(routes) == 0 {
		return
	}
	for i := range opts {
		if j := slices.IndexFunc(opts[:i], func(x option) bool { return x.kind == opts[i].kind }); j >= 0 {
			opts[i].shanten = opts[j].shanten
			continue
		}
		c := all
		c[opts[i].kind]--
		opts[i].shanten = p.routeDist(c, melds, routes)
	}
	sortx.Func(opts, func(a, b option) int { return a.shanten - b.shanten })
}

// needsRoute reports whether a hand with melds is open (a concealed kan
// keeps it closed, riichi still a yaku) without a value triplet, so its
// shanten counts toward its nearest yaku route.
func needsRoute(v game.View, melds []game.Called) bool {
	open, value := false, false
	for _, m := range melds {
		open = open || m.Meld.Open
		value = value || m.Meld.Type == yaku.Trip && isValue(v, m.Meld.Kind)
	}
	return open && !value
}

func (p *Player) handShanten(ts []tile.Tile, melds int) int {
	sh, _ := p.shanten(tile.CountsOf(ts), melds)
	return sh
}

// isValue reports whether a triplet of k is a yaku for the viewer.
func isValue(v game.View, k tile.Kind) bool {
	return k >= tile.Haku || k == v.RoundWind || k == v.Seats[v.Viewer].Wind
}

// keepsYaku reports whether an open hand with these melds and concealed
// tiles still has a yaku to win with (see the package comment above).
func keepsYaku(v game.View, melds []yaku.Meld, rest []tile.Tile) bool {
	simples := true
	for _, m := range melds {
		if m.Type == yaku.Trip && isValue(v, m.Kind) {
			return true
		}
		simples = simples && allSimples(m)
	}
	yaochu := 0
	for _, t := range rest {
		if t.Kind.IsYaochu() {
			yaochu++
		}
	}
	return simples && yaochu <= 1
}

// allSimples reports whether every tile of meld m is a 2-8 number tile.
func allSimples(m yaku.Meld) bool {
	if m.Type == yaku.Seq {
		return m.Kind.Num() >= 2 && m.Kind.Num() <= 6
	}
	return !m.Kind.IsYaochu()
}

// bannedAfter is the kuikae the engine applies after a call (for the
// player's own planning).
func bannedAfter(typ game.ActionType, called tile.Kind, m yaku.Meld) []tile.Kind {
	if typ != game.Chii {
		return []tile.Kind{called}
	}
	banned := []tile.Kind{called}
	switch {
	case called == m.Kind && m.Kind.Num() <= 6:
		banned = append(banned, m.Kind+3)
	case called == m.Kind+2 && m.Kind.Num() >= 2:
		banned = append(banned, m.Kind-1)
	}
	return banned
}

func meldShapes(ms []game.Called) []yaku.Meld {
	out := make([]yaku.Meld, len(ms))
	for i, m := range ms {
		out[i] = m.Meld
	}
	return out
}

// pick returns n tiles of kind k, plain before red (the engine's choice).
func pick(ts []tile.Tile, k tile.Kind, n int) []tile.Tile {
	var plain, red []tile.Tile
	for _, t := range ts {
		switch {
		case t.Kind != k:
		case t.Red:
			red = append(red, t)
		default:
			plain = append(plain, t)
		}
	}
	all := append(plain, red...)
	if len(all) < n {
		return nil
	}
	return all[:n]
}

func byString(ts []tile.Tile, ss []string) []tile.Tile {
	left := slices.Clone(ts)
	var out []tile.Tile
	for _, s := range ss {
		i := slices.IndexFunc(left, func(t tile.Tile) bool { return t.String() == s })
		if i < 0 {
			return nil
		}
		out = append(out, left[i])
		left = slices.Delete(left, i, i+1)
	}
	return out
}

func removeTiles(ts, used []tile.Tile) []tile.Tile {
	out := slices.Clone(ts)
	for _, u := range used {
		if i := slices.Index(out, u); i >= 0 {
			out = slices.Delete(out, i, i+1)
		}
	}
	return out
}

func kindOf(s string) tile.Kind {
	t, _ := tile.Parse(s)
	return t.Kind
}
