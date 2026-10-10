package cpu

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// A view that shows the other seats' concealed tiles during a round (a
// peek: game.SeatConfig.Peek, the urashihan's cheat) changes how a player
// other than the weak one defends: it counts their tiles as seen, does not
// fold, and never discards a tile one of them would ron (deadly), as far
// as another discard is left. Without a peek nothing changes.

// peeked reports whether v shows another seat's concealed tiles before
// the round has ended.
func peeked(v game.View) bool {
	if v.Result != nil {
		return false
	}
	for _, s := range v.Seats {
		if s.Seat != v.Viewer && s.Hand != nil {
			return true
		}
	}
	return false
}

// seePeeked adds the other seats' concealed tiles v shows to visible.
func seePeeked(v game.View, visible *tile.Counts) {
	for _, s := range v.Seats {
		if s.Seat == v.Viewer {
			continue
		}
		for _, t := range s.Hand {
			visible[t.Kind]++
		}
		if s.Drawn != nil {
			visible[s.Drawn.Kind]++
		}
	}
}

// deadly returns the kinds another seat whose tiles v shows would ron: the
// waits of a tenpai hand (13 tiles less its calls) that are not furiten
// for it (in its own river) and win with a yaku (riichi counts).
func (p *Player) deadly(v game.View) [tile.NumKinds]bool {
	var out [tile.NumKinds]bool
	for _, s := range v.Seats {
		if s.Seat == v.Viewer || s.Hand == nil || s.Drawn != nil {
			continue
		}
		sh, waits := p.shanten(tile.CountsOf(s.Hand), len(s.Melds))
		if sh != 0 {
			continue
		}
		ctx := yaku.Context{Ron: true, Riichi: s.Riichi, Winds: yaku.Winds{Round: v.RoundWind, Seat: s.Wind}, DoraIndicators: v.DoraIndicators}
		for _, m := range s.Melds {
			ctx.Melds = append(ctx.Melds, m.Meld)
			ctx.MeldTiles = append(ctx.MeldTiles, m.Tiles...)
		}
		for _, k := range waits {
			if slices.ContainsFunc(s.River, func(rt game.RiverTile) bool { return rt.Tile.Kind == k }) {
				continue
			}
			ctx.WinTile = k
			if w, ok := yaku.Evaluate(append(slices.Clone(s.Hand), tile.Tile{Kind: k}), ctx); ok && w.HasYaku() {
				out[k] = true
			}
		}
	}
	return out
}
