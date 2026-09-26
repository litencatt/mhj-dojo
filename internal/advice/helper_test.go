package advice

import (
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// input builds the decision on 14 tiles; extra lists the other visible
// tiles (discards, dora indicators).
func input(a *yakushanten.Analyzer, hand, extra string, turn, maxTurns int) Input {
	tiles := tile.MustParseHand(hand)
	visible := tile.CountsOf(tiles)
	if extra != "" {
		for _, t := range tile.MustParseHand(extra) {
			visible[t.Kind]++
		}
	}
	c := tile.CountsOf(tiles)
	by := map[tile.Kind][]yakushanten.Result{}
	for _, t := range tiles {
		if _, ok := by[t.Kind]; !ok {
			c[t.Kind]--
			by[t.Kind] = a.Analyze(c)
			c[t.Kind]++
		}
	}
	return Input{
		Tiles: tiles, Visible: visible, Turn: turn, MaxTurns: maxTurns, ByDiscard: by,
		Han: func(key string) int { return yaku.HanFor(key, yaku.EastEast) }, Analyzer: a,
	}
}
