package yakushanten

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
)

// openHand is a hand with fixed melds for the brute-force oracle: c holds
// the concealed tiles, used the tiles in the melds (a kan as four).
type openHand struct {
	c     tile.Counts
	melds []yaku.Meld
	used  tile.Counts
}

func newOpenHand(c tile.Counts, melds []yaku.Meld) *openHand {
	h := &openHand{c: c, melds: melds}
	for _, m := range melds {
		addMeld(&h.used, m)
	}
	return h
}

func (h *openHand) open() bool {
	return slices.ContainsFunc(h.melds, func(m yaku.Meld) bool { return m.Open })
}

// satisfies is the oracle's "the concealed tiles with the melds make a
// complete hand satisfying key", independent of the target families.
func (h *openHand) satisfies(key string) bool {
	switch key {
	case "chiitoitsu", "kokushi", "chuuren":
		return false // need fourteen concealed tiles
	case "pinfu", "iipeikou", "ryanpeikou", "suuankou":
		if h.open() {
			return false
		}
	}
	full := h.c // a kan counts as three tiles here
	for _, m := range h.melds {
		addMeld(&full, yaku.Meld{Type: m.Type, Kind: m.Kind})
	}
	if !quickComplete(full) { // fast reject
		return false
	}
	ds := yaku.DecomposeWith(h.c, h.melds)
	if len(ds) == 0 {
		return false
	}
	switch key {
	case "normal", "tanyao", "honitsu", "chinitsu", "ryuuiisou", "chinroutou", "honroutou", "tsuuiisou":
		return satisfies(key, full)
	}
	for _, d := range ds {
		if key == "sanankou" {
			n := 0
			for _, m := range d.Melds {
				if m.Type == yaku.Trip && !m.Open {
					n++
				}
			}
			if n >= 3 {
				return true
			}
			continue
		}
		if readingSatisfies(key, d) {
			return true
		}
	}
	return false
}

func (h *openHand) full(k tile.Kind) bool { return h.c[k]+h.used[k] >= 4 }

func (h *openHand) waits(key string) []tile.Kind {
	var out []tile.Kind
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if h.full(k) {
			continue
		}
		h.c[k]++
		if h.satisfies(key) {
			out = append(out, k)
		}
		h.c[k]--
	}
	return out
}

// dist returns the exact distance if it is 1 or 2, else 3.
func (h *openHand) dist(key string) int {
	if len(h.waits(key)) > 0 {
		return 1
	}
	for x := tile.Kind(0); x < tile.NumKinds; x++ {
		if h.c[x] == 0 {
			continue
		}
		h.c[x]--
		for a := tile.Kind(0); a < tile.NumKinds; a++ {
			if h.full(a) {
				continue
			}
			h.c[a]++
			ok := len(h.waits(key)) > 0
			h.c[a]--
			if ok {
				h.c[x]++
				return 2
			}
		}
		h.c[x]++
	}
	return 3
}

func (h *openHand) ukeire(key string, dist int) []tile.Kind {
	if dist == 1 {
		return h.waits(key)
	}
	var out []tile.Kind
	for t := tile.Kind(0); t < tile.NumKinds; t++ {
		if h.full(t) {
			continue
		}
		h.c[t]++
		found := false
		for x := tile.Kind(0); x < tile.NumKinds && !found; x++ {
			if h.c[x] == 0 {
				continue
			}
			h.c[x]--
			found = len(h.waits(key)) > 0
			h.c[x]++
		}
		if found {
			out = append(out, t)
		}
		h.c[t]--
	}
	return out
}

// randomOpen turns one to four groups of a complete 4 melds + pair hand into
// melds (chii, pon, open kan or ankan) and perturbs the concealed rest by one
// or two exchanges.
func randomOpen(r *rand.Rand, c tile.Counts) *openHand {
	ds := yaku.Decompose(c)
	d := ds[r.IntN(len(ds))]
	orig := c // a kan needs the fourth copy to be free
	var melds []yaku.Meld
	for _, i := range r.Perm(4)[:1+r.IntN(4)] {
		m := d.Melds[i]
		switch {
		case m.Type == yaku.Seq:
			m.Open = true
		case orig[m.Kind] == 3 && r.IntN(3) == 0:
			m.Kan, m.Open = true, r.IntN(2) == 0
		default:
			m.Open = r.IntN(4) != 0 // a concealed triplet stays in the hand
			if !m.Open {
				continue
			}
		}
		melds = append(melds, m)
		var g tile.Counts
		addMeld(&g, yaku.Meld{Type: m.Type, Kind: m.Kind})
		for k := range c {
			c[k] -= g[k]
		}
	}
	h := newOpenHand(c, melds)
	for {
		d := c
		remove(r, &d)
		if r.IntN(2) == 0 {
			remove(r, &d)
			add(r, &d)
		}
		add(r, &d)
		remove(r, &d)
		ok := true
		for k := range d {
			ok = ok && d[k]+h.used[k] <= 4
		}
		if ok {
			h.c = d
			return h
		}
	}
}

// TestOpenRowsMatchBruteForce compares every row of hands with melds with
// the brute-force definition.
func TestOpenRowsMatchBruteForce(t *testing.T) {
	r := rand.New(rand.NewPCG(31, 32))
	a := NewAnalyzer()
	perKey := 16
	if testing.Short() {
		perKey = 4
	}
	for _, row := range Rows {
		for i := 0; i < perKey; i++ {
			key := row.Key
			switch key {
			case "chiitoitsu", "kokushi", "chuuren", "ryanpeikou", "pinfu":
				key = "normal" // no meld keeps these shapes; test them on other hands
			}
			c := randomTarget(r, key)
			for len(yaku.Decompose(c)) == 0 { // a seven-pairs form
				c = randomTarget(r, key)
			}
			h := randomOpen(r, c)
			var res Result
			for _, x := range a.AnalyzeWith(h.c, h.melds) {
				if x.Key == row.Key {
					res = x
				}
			}
			want := h.dist(row.Key)
			if !res.Possible {
				if want != 3 {
					t.Fatalf("%s %s %v: impossible, brute dist %d", row.Key, h.c, h.melds, want)
				}
				continue
			}
			if got := min(res.Shanten+1, 3); got != want {
				t.Fatalf("%s %s %v: shanten %d, brute dist %d", row.Key, h.c, h.melds, res.Shanten, want)
			}
			if want <= 2 {
				if wantU := h.ukeire(row.Key, want); !slices.Equal(res.Ukeire, wantU) {
					t.Fatalf("%s %s %v: ukeire %v, brute %v", row.Key, h.c, h.melds, names(res.Ukeire), names(wantU))
				}
			}
		}
	}
}

func mustMeld(t *testing.T, typ yaku.GroupType, s string, open, kan bool) yaku.Meld {
	t.Helper()
	k, err := tile.Parse(s)
	if err != nil {
		t.Fatal(err)
	}
	return yaku.Meld{Type: typ, Kind: k.Kind, Open: open, Kan: kan}
}

func TestOpenHandRows(t *testing.T) {
	a := NewAnalyzer()
	row := func(res []Result, key string) Result {
		for _, r := range res {
			if r.Key == key {
				return r
			}
		}
		t.Fatalf("missing row %s", key)
		return Result{}
	}
	shan := func(r Result) any {
		if !r.Possible {
			return nil
		}
		return r.Shanten
	}
	type want map[string]any // key -> shanten, nil = impossible
	for _, tc := range []struct {
		name  string
		hand  string
		melds []yaku.Meld
		want  want
	}{
		{
			// 中 pon; 234m 567p 88s + 3s4s waits on 2s/5s.
			name:  "value pon",
			hand:  "234m567p3488s",
			melds: []yaku.Meld{mustMeld(t, yaku.Trip, "7z", true, false)},
			want: want{
				"normal": 0, "chun": 0, "tanyao": nil, "pinfu": nil, "iipeikou": nil,
				"chiitoitsu": nil, "kokushi": nil, "suuankou": nil, "chuuren": nil, "ryanpeikou": nil,
				"haku": 2,
			},
		},
		{
			// 234m chii; 456p 678s 55m + 3s4s: open tanyao tenpai.
			name:  "open tanyao",
			hand:  "55m456p34678s",
			melds: []yaku.Meld{mustMeld(t, yaku.Seq, "2m", true, false)},
			want:  want{"normal": 0, "tanyao": 0, "chanta": nil, "junchan": nil, "pinfu": nil, "iipeikou": nil},
		},
		{
			// 中 pon + 234m 567p 345s 88s: complete (14 - 3 tiles).
			name:  "complete open hand",
			hand:  "234m567p34588s",
			melds: []yaku.Meld{mustMeld(t, yaku.Trip, "7z", true, false)},
			want:  want{"normal": -1, "chun": -1, "tanyao": nil, "haku": 2, "pinfu": nil},
		},
		{
			// 1z ankan keeps the hand closed: iipeikou and suuankou stay possible.
			name:  "ankan",
			hand:  "112233m456p9s",
			melds: []yaku.Meld{mustMeld(t, yaku.Trip, "1z", false, true)},
			want:  want{"normal": 0, "iipeikou": 0, "ton": 0, "pinfu": nil, "chiitoitsu": nil, "ryanpeikou": nil, "suuankou": 3},
		},
		{
			// 123m and 456m chii: 79m waits on 8m for ittsu.
			name: "open ittsu",
			hand: "79m11p567s",
			melds: []yaku.Meld{
				mustMeld(t, yaku.Seq, "1m", true, false),
				mustMeld(t, yaku.Seq, "4m", true, false),
			},
			want: want{"ittsu": 0, "chiitoitsu": nil, "tanyao": nil},
		},
	} {
		res := a.AnalyzeWith(tile.MustCounts(tc.hand), tc.melds)
		for key, w := range tc.want {
			if got := shan(row(res, key)); got != w {
				t.Errorf("%s: %s = %v, want %v", tc.name, key, got, w)
			}
		}
	}
	// 中 pon waiting on 2s/5s: the chun row's waits.
	r := row(a.AnalyzeWith(tile.MustCounts("234m567p3488s"), []yaku.Meld{mustMeld(t, yaku.Trip, "7z", true, false)}), "chun")
	if got := names(r.Ukeire); !slices.Equal(got, []string{"2s", "5s"}) {
		t.Errorf("value pon: chun ukeire %v, want [2s 5s]", got)
	}
}
