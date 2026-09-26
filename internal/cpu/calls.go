package cpu

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// The player calls only when the hand keeps a yaku to win with: a value
// triplet (dragons, the round wind, its seat wind), or tanyao (every meld
// of simples and at most one terminal or honor left in hand). It pons a
// value tile whenever that does not set the hand back, and makes other
// calls only when they bring it closer to tenpai. It never calls while
// folding against a riichi.

// decideCall answers a call offer (pon, chii or open kan); ok is false to
// skip.
func (p *Player) decideCall(v game.View, l game.Legal) (game.Action, bool) {
	me := v.Seats[v.Viewer]
	if v.LastDiscard == nil || (len(riichiRivers(v)) > 0 && p.handShanten(me.Hand, len(me.Melds)) >= foldShanten) {
		return game.Action{}, false
	}
	t := *v.LastDiscard
	cur := p.handShanten(me.Hand, len(me.Melds))
	value := isValue(v, t.Kind)
	best, bestSh := game.Action{}, cur+1
	try := func(a game.Action, used []tile.Tile, meld yaku.Meld, needDiscard bool) {
		rest := removeTiles(me.Hand, used)
		melds := append(meldShapes(me.Melds), meld)
		if !keepsYaku(v, melds, rest) {
			return
		}
		sh := p.afterCall(rest, len(melds), needDiscard, bannedAfter(a.Type, t.Kind, meld))
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
		slices.Sort(ks)
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
