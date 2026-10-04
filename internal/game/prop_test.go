package game

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// randomMove picks one legal move at random, leaning toward calls, kans and
// riichi so the rarer rules get exercised.
func randomMove(rng *rand.Rand, h []tile.Tile, l Legal) Action {
	var opts []Action
	if l.Tsumo {
		opts = append(opts, Action{Type: Tsumo}, Action{Type: Tsumo})
	}
	if l.Ron {
		opts = append(opts, Action{Type: Ron})
	}
	if l.Kyuushu {
		opts = append(opts, Action{Type: Kyuushu})
	}
	for _, k := range l.Kan {
		opts = append(opts, Action{Type: Kan, Tile: k}, Action{Type: Kan, Tile: k})
	}
	if l.Pon {
		opts = append(opts, Action{Type: Pon}, Action{Type: Pon})
	}
	for _, c := range l.Chii {
		opts = append(opts, Action{Type: Chii, Tiles: c})
	}
	for _, t := range l.Riichi {
		opts = append(opts, Action{Type: Riichi, Tile: t}, Action{Type: Riichi, Tile: t})
	}
	if l.Skip {
		opts = append(opts, Action{Type: Skip}, Action{Type: Skip})
	}
	for _, t := range l.Discards {
		opts = append(opts, Action{Type: Discard, Tile: t})
	}
	if best := bestDiscard(h, l); best != "" && rng.IntN(10) != 0 {
		return Action{Type: Discard, Tile: best}
	}
	return opts[rng.IntN(len(opts))]
}

// refWaits lists the kinds that complete the concealed tiles, by brute force
// over the winning-shape check alone.
func refWaits(c tile.Counts, melds []yaku.Meld) []tile.Kind {
	var out []tile.Kind
	for k := range c {
		c[k]++
		if yaku.IsCompleteWith(c, melds) {
			out = append(out, tile.Kind(k))
		}
		c[k]--
	}
	return out
}

// checkRules verifies, from the seat's hand alone, that the offered moves obey
// the rules, and that a tsumo on a complete closed hand is never withheld.
func checkRules(t *testing.T, r *Round, seed int64) {
	t.Helper()
	seat := r.Actor()
	l := r.LegalFor(seat)
	p := &r.players[seat]
	if r.Phase() == PhaseCall {
		if l.Ron {
			waits := refWaits(tile.CountsOf(p.hand), p.meldShapes())
			if !slices.Contains(waits, r.lastDiscard.Kind) {
				t.Fatalf("seed %d: ron offered on %s without a wait", seed, r.lastDiscard)
			}
			for _, rt := range p.river {
				if slices.Contains(waits, rt.Tile.Kind) {
					t.Fatalf("seed %d: ron offered to furiten seat %d (river %s)", seed, seat, rt.Tile)
				}
			}
		}
		return
	}
	if p.drawn == nil {
		return
	}
	c := tile.CountsOf(p.concealed())
	complete := yaku.IsCompleteWith(c, p.meldShapes())
	if l.Tsumo && !complete {
		t.Fatalf("seed %d: tsumo offered on an incomplete hand %s", seed, c)
	}
	if complete && !p.open() && !l.Tsumo {
		t.Fatalf("seed %d: closed complete hand %s cannot tsumo", seed, c)
	}
	if p.riichi && (len(l.Riichi) > 0 || len(l.Discards) != 1) {
		t.Fatalf("seed %d: riichi seat offered %v / %v", seed, l.Riichi, l.Discards)
	}
	for _, d := range l.Riichi {
		if p.open() {
			t.Fatalf("seed %d: riichi offered to an open hand", seed)
		}
		dt, _ := tile.Parse(d)
		c[dt.Kind]--
		if len(refWaits(c, p.meldShapes())) == 0 {
			t.Fatalf("seed %d: riichi on %s leaves %s without a wait", seed, d, c)
		}
		c[dt.Kind]++
	}
}

// checkTiles verifies no kind exists more than four times across hands,
// melds, rivers and the revealed dora indicators, and that what a seat can see
// never exceeds four either.
func checkTiles(t *testing.T, r *Round, seed int64) {
	t.Helper()
	var all tile.Counts
	for _, p := range r.players {
		for _, h := range p.concealed() {
			all[h.Kind]++
		}
		for _, m := range p.meldTiles() {
			all[m.Kind]++
		}
		for _, rt := range p.river {
			if !rt.Called {
				all[rt.Tile.Kind]++
			}
		}
	}
	for k, n := range all {
		if n > 4 {
			t.Fatalf("seed %d: %d copies of %s on the table", seed, n, tile.Kind(k))
		}
	}
	for s := range 4 {
		v := r.ViewFor(s)
		vis := v.Visible()
		for k, n := range vis {
			if n > 4 {
				t.Fatalf("seed %d: seat %d sees %d copies of %s", seed, s, n, tile.Kind(k))
			}
		}
	}
}

func TestRandomLegalPlay(t *testing.T) {
	n := testmode.N(2000, 300, 60)
	outcomes := map[string]int{}
	for seed := range int64(n) {
		rng := rand.New(rand.NewPCG(uint64(seed), 99))

		r := New(seed)
		for steps := 0; r.Actor() >= 0; steps++ {
			if steps > 2000 {
				t.Fatalf("seed %d: round does not end", seed)
			}
			checkRules(t, r, seed)
			seat := r.Actor()
			a := randomMove(rng, r.players[seat].concealed(), r.LegalFor(seat))
			a.Seat = seat
			if err := r.Apply(a); err != nil {
				t.Fatalf("seed %d: legal move %+v rejected: %v", seed, a, err)
			}
			if r.robbing == nil { // an added kan in limbo is in neither hand nor meld
				checkInvariants(t, r)
			}
			checkTiles(t, r, seed)
		}
		res := r.Result()
		outcomes[res.Kind]++
		sum := 0
		for _, d := range res.Deltas {
			sum += d
		}
		// riichi sticks left on the table are the only points not paid out
		if res.Kind == "draw" || res.Kind == "abort" {
			if sum != -res.Deposit {
				t.Fatalf("seed %d: deltas %v sum %d, deposit %d", seed, res.Deltas, sum, res.Deposit)
			}
		} else if sum != 0 {
			t.Fatalf("seed %d: win deltas %v do not sum to 0", seed, res.Deltas)
		}
		if res.Win != nil && (!res.Win.HasYaku() || res.Win.HanTotal <= 0) {
			t.Fatalf("seed %d: won without a yaku: %+v", seed, res.Win)
		}
	}
	t.Logf("outcomes: %v", outcomes)
}

// bestDiscard is the legal discard with the lowest normal shanten, so that
// random games reach tenpai and wins often enough to test them.
func bestDiscard(h []tile.Tile, l Legal) string {
	if len(h) != 14 || len(l.Discards) == 0 || l.Skip || l.Pon {
		return ""
	}
	best, bestS := "", 99
	for _, d := range l.Discards {
		dt, _ := tile.Parse(d)
		c := tile.CountsOf(h)
		c[dt.Kind]--
		if s := shanten.Normal(c); s < bestS {
			best, bestS = d, s
		}
	}
	return best
}
