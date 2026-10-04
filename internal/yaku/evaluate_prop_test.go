package yaku

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

func yakuKeys(w Win) []string {
	var ks []string
	for _, y := range w.Yaku {
		ks = append(ks, y.Key)
	}
	return ks
}

func tilesOf(c tile.Counts) []tile.Tile {
	var ts []tile.Tile
	for k, n := range c {
		for range n {
			ts = append(ts, tile.Tile{Kind: tile.Kind(k)})
		}
	}
	return ts
}

// TestEvaluateInvariants checks properties that must hold for every winning
// hand, closed or open, against definitions written from the tile set alone.
func TestEvaluateInvariants(t *testing.T) {
	r := rand.New(rand.NewPCG(31, 32))
	for range testmode.N(40000, 10000, 2000) {
		conc, called, ctx, ok := randomWinCase(r)
		if !ok {
			continue
		}
		ts := tilesOf(conc)
		for _, m := range called {
			for j := range 3 {
				k := m.Kind
				if m.Type == Seq {
					k += tile.Kind(j)
				}
				ctx.MeldTiles = append(ctx.MeldTiles, tile.Tile{Kind: k})
			}
			if m.Kan {
				ctx.MeldTiles = append(ctx.MeldTiles, tile.Tile{Kind: m.Kind})
			}
		}
		// situational flags, exclusive as in play
		closed := !ctx.Open()
		if closed && r.IntN(3) == 0 {
			ctx.Riichi = true
			ctx.Ippatsu = r.IntN(2) == 0
		}
		if ctx.Ron {
			ctx.Houtei = r.IntN(4) == 0
		} else {
			ctx.Haitei = r.IntN(4) == 0
		}
		w, ok := Evaluate(ts, ctx)
		if !ok {
			t.Fatalf("conc %s called %+v: complete hand rejected", conc, called)
		}
		ks := yakuKeys(w)
		has := func(k string) bool { return slices.Contains(ks, k) }
		all := conc
		for _, m := range called {
			for j := range 3 {
				if m.Type == Seq {
					all[m.Kind+tile.Kind(j)]++
				} else {
					all[m.Kind]++
				}
			}
		}
		yakuman := w.HanTotal >= 13 && len(w.Yaku) > 0 && w.Yaku[0].Han >= 13
		if yakuman {
			if w.HanTotal != sumHan(w.Yaku) {
				t.Fatalf("%s %+v: yakuman counted dora", conc, ctx)
			}
			if w.HanTotal%13 != 0 {
				t.Fatalf("%s: yakuman han %d", conc, w.HanTotal)
			}
			continue
		}
		if !w.HasYaku() {
			if w.HanTotal != 0 {
				t.Fatalf("%s: no yaku but han %d", conc, w.HanTotal)
			}
			continue
		}
		if want := sumHan(w.Yaku) + w.Dora + w.UraDora; w.HanTotal != want {
			t.Fatalf("%s: han %d, parts %d", conc, w.HanTotal, want)
		}
		if w.Fu%10 != 0 && (w.Fu != 25 || w.Reading != nil) {
			t.Fatalf("%s: fu %d", conc, w.Fu)
		}
		if w.Fu < 20 {
			t.Fatalf("%s: fu %d below the minimum", conc, w.Fu)
		}
		// tile-set yaku
		noYaochu, suits, honors := true, map[int]bool{}, false
		for k, n := range all {
			if n == 0 {
				continue
			}
			noYaochu = noYaochu && !tile.Kind(k).IsYaochu()
			if tile.Kind(k).IsHonor() {
				honors = true
			} else {
				suits[tile.Kind(k).Suit()] = true
			}
		}
		if has("tanyao") != noYaochu {
			t.Fatalf("%s called %+v: tanyao=%v with no-yaochu=%v (%v)", conc, called, has("tanyao"), noYaochu, ks)
		}
		if has("chinitsu") != (len(suits) == 1 && !honors) || has("honitsu") != (len(suits) == 1 && honors) {
			t.Fatalf("%s called %+v: flush yaku %v for suits=%d honors=%v", conc, called, ks, len(suits), honors)
		}
		// closed-only yaku never score in an open hand
		if ctx.Open() {
			for _, k := range []string{"riichi", "ippatsu", "tsumo", "pinfu", "iipeikou", "ryanpeikou", "chiitoitsu"} {
				if has(k) {
					t.Fatalf("%s called %+v: open hand scored %s", conc, called, k)
				}
			}
		}
		// situational yaku follow the flags
		if has("ippatsu") && !has("riichi") && !has("double_riichi") {
			t.Fatalf("%s: ippatsu without riichi", conc)
		}
		if has("tsumo") != (!ctx.Ron && closed) {
			t.Fatalf("%s: tsumo yaku=%v ron=%v closed=%v", conc, has("tsumo"), ctx.Ron, closed)
		}
		if has("haitei") != (ctx.Haitei && !ctx.Ron) || has("houtei") != (ctx.Houtei && ctx.Ron) {
			t.Fatalf("%s: haitei/houtei %v flags %+v", conc, ks, ctx)
		}
		if has("pinfu") {
			want := 20
			if ctx.Ron {
				want = 30
			}
			if w.Fu != want {
				t.Fatalf("%s: pinfu fu %d", conc, w.Fu)
			}
		}
		// the order of the tiles must not matter
		sh := slices.Clone(ts)
		r.Shuffle(len(sh), func(i, j int) { sh[i], sh[j] = sh[j], sh[i] })
		w2, _ := Evaluate(sh, ctx)
		if w2.HanTotal != w.HanTotal || w2.Fu != w.Fu || !slices.Equal(yakuKeys(w2), ks) {
			t.Fatalf("%s: tile order changed the result", conc)
		}
	}
}
