package match

import (
	"testing"

	"github.com/litencatt/mhj2/internal/apiview"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

// A shanpon on 55m/77z that pons 中 holds 11 complete tiles but must still
// discard: its analysis is the best over the discards, never a win (-1).
func TestAnalysisAfterPonIsBestDiscard(t *testing.T) {
	hand := tile.MustParseHand("234m567p345s55m") // after 77z + the called 7z
	melds := []yaku.Meld{{Type: yaku.Trip, Kind: tile.Chun, Open: true}}
	a := yakushanten.NewAnalyzer()
	visible := tile.CountsOf(hand)
	visible[tile.Chun] += 3
	han := func(key string) int { return yaku.HanOpenFor(key, yaku.EastEast, true) }
	byDiscard := map[string][]apiview.YakuRow{}
	var discards []string
	c := tile.CountsOf(hand)
	for _, x := range hand {
		key := x.String()
		if _, ok := byDiscard[key]; ok {
			continue
		}
		discards = append(discards, key)
		c[x.Kind]--
		byDiscard[key] = apiview.Rows(a.AnalyzeWith(c, melds), &visible, han)
		c[x.Kind]++
	}
	rows := bestRows(byDiscard, discards)
	get := func(key string) apiview.YakuRow {
		for _, r := range rows {
			if r.Key == key {
				return r
			}
		}
		t.Fatalf("missing row %s", key)
		return apiview.YakuRow{}
	}
	for _, r := range rows {
		if r.Shanten != nil && *r.Shanten < 0 {
			t.Errorf("%s: shanten %d after a call", r.Key, *r.Shanten)
		}
	}
	// Every discard leaves chun tenpai; the row keeps the most ukeire.
	most := 0
	for _, d := range discards {
		for _, r := range byDiscard[d] {
			if r.Key == "chun" && r.Shanten != nil && *r.Shanten == 0 {
				most = max(most, r.UkeireTotal)
			}
		}
	}
	if s := get("chun").Shanten; s == nil || *s != 0 || get("chun").UkeireTotal != most || most == 0 {
		t.Errorf("chun: %+v, want tenpai with %d ukeire", get("chun"), most)
	}
	if get("tanyao").Shanten != nil || get("pinfu").Shanten != nil {
		t.Error("tanyao or pinfu possible with a 中 pon")
	}
	if len(bestRows(nil, nil)) != 0 || bestRows(nil, nil) == nil {
		t.Error("no discards: want an empty, non-nil analysis")
	}
}

// After a call the combos are those of the discard whose first combo ranks
// best: lower rank first, then more han, then more ukeire.
func TestCombosAfterCallAreBestDiscard(t *testing.T) {
	row := func(han, shanten, ukeire int) apiview.ComboRow {
		return apiview.ComboRow{Name: "x", Han: han, Shanten: shanten, UkeireTotal: ukeire}
	}
	by := map[string][]apiview.ComboRow{
		"1m": {row(2, 1, 20)},               // rank 0
		"2m": {row(4, 2, 10)},               // rank 0, more han
		"3m": {row(4, 2, 12), row(2, 3, 0)}, // the same, more ukeire
		"4m": {},
	}
	if got := bestCombos(by, []string{"4m", "1m", "2m", "3m"}); len(got) != 2 || got[0].UkeireTotal != 12 {
		t.Errorf("got %+v, want the 3m combos", got)
	}
	if got := bestCombos(nil, nil); got == nil || len(got) != 0 {
		t.Errorf("no discards: %+v, want empty non-nil", got)
	}
}
