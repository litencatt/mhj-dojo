package game

import (
	"reflect"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Kan dora timing: a concealed kan turns its indicator over at once; an open
// or added kan when the declarer discards, before the claims on that discard
// (後めくり), or when the declarer makes another kan before discarding. The seed-1 wall of
// newRound has rinshan tiles 9p 6z 5p 4z and dora indicators 4p 9m 7s 3z 1m,
// so the first kan dora is 1m and the second 8s.

// daiminkan5z has seat 0 discard 5z and seat 2 call an open kan of it with
// hand (5z5z5z plus ten tiles); seat 2 then holds the rinshan tile 9p.
func daiminkan5z(t *testing.T, hand string) *Round {
	t.Helper()
	r := newRound(t)
	setHand(r, 0, "147m258p369s1236z", "5z")
	setHand(r, 2, hand, "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Kan})
	return r
}

func indicators(r *Round) (dora, ura int) {
	return len(r.doraIndicators()), len(r.uraIndicators())
}

// A rinshan win after an open kan does not count the kan's dora.
func TestRinshanAfterDaiminkanHasNoKanDora(t *testing.T) {
	r := daiminkan5z(t, "5z5z5z123m456m789m9p") // 1m would be the kan dora
	mustApply(t, r, Action{Seat: 2, Type: Tsumo})
	res := r.Result()
	if !hasYaku(res, "rinshan") || res.Win.Dora != 0 {
		t.Fatalf("dora %d yaku %v", res.Win.Dora, yakuKeys(res))
	}
	if d, u := indicators(r); d != 1 || u != 1 {
		t.Fatalf("indicators %d ura %d", d, u)
	}
}

// A rinshan win after a concealed kan counts the kan's dora.
func TestRinshanAfterAnkanCountsKanDora(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, "111m234m567m789p9p", "1m")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "1m"})
	if d, _ := indicators(r); d != 2 {
		t.Fatalf("indicators %d after the ankan", d)
	}
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	res := r.Result()
	if !hasYaku(res, "rinshan") || res.Win.Dora != 4 {
		t.Fatalf("dora %d yaku %v", res.Win.Dora, yakuKeys(res))
	}
	if d, u := indicators(r); d != 2 || u != 2 {
		t.Fatalf("indicators %d ura %d", d, u)
	}
}

// An added kan's dora also waits for the declarer's discard.
func TestKakanDoraAfterTheDiscard(t *testing.T) {
	r := newRound(t)
	setPon(r, 0, 2, "7z", "147m258p369s1z", "7z")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	if r.Phase() != PhaseDiscard || r.kans != 1 {
		t.Fatalf("phase %s kans %d", r.Phase(), r.kans)
	}
	if d, _ := indicators(r); d != 1 {
		t.Fatalf("indicators %d before the discard", d)
	}
	passSafe(t, r, 0)
	if d, _ := indicators(r); d != 2 {
		t.Fatalf("indicators %d after the discard", d)
	}
}

// The kan dora shows while the other seats answer the discard, and stays
// when the discard is called.
func TestKanDoraShownDuringTheClaimsOnTheDiscard(t *testing.T) {
	r := daiminkan5z(t, "5z5z5z147m258p369s2z")
	setHand(r, 3, "2z2z147m258p369s13z", "")
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "2z"})
	if r.Phase() != PhaseCall || !r.LegalFor(3).Pon || len(r.ViewFor(3).DoraIndicators) != 2 {
		t.Fatalf("phase %s legal %+v indicators %v", r.Phase(), r.LegalFor(3), r.ViewFor(3).DoraIndicators)
	}
	mustApply(t, r, Action{Seat: 3, Type: Pon})
	if d, _ := indicators(r); d != 2 {
		t.Fatalf("indicators %d after the pon", d)
	}
}

// A second kan before the discard turns the first kan's dora over; the
// second's follows its own rule.
func TestKanDoraAcrossTwoKansInOneTurn(t *testing.T) {
	// open kan, then a concealed kan: both show at once
	r := daiminkan5z(t, "5z5z5z1111m258p369s")
	mustApply(t, r, Action{Seat: 2, Type: Kan, Tile: "1m"})
	if d, _ := indicators(r); d != 3 {
		t.Fatalf("open kan + ankan: indicators %d", d)
	}

	// open kan, then an added kan: the first shows, the second after the discard
	r = daiminkan5z(t, "5z5z5z7z147m258p")
	p := &r.players[2]
	p.melds = append([]Called{called("7z", 1, false)}, p.melds...)
	mustApply(t, r, Action{Seat: 2, Type: Kan, Tile: "7z"})
	if r.Phase() != PhaseDiscard || r.kans != 2 {
		t.Fatalf("phase %s kans %d", r.Phase(), r.kans)
	}
	if d, _ := indicators(r); d != 2 {
		t.Fatalf("open kan + kakan: indicators %d before the discard", d)
	}
	passSafe(t, r, 2)
	if d, _ := indicators(r); d != 3 {
		t.Fatalf("open kan + kakan: indicators %d after the discard", d)
	}
}

// A robbed added kan never completes: neither it nor an earlier open kan of
// the same turn turns an indicator over (house rule), and the chankan
// scores without them.
func TestChankanRevealsNoKanDora(t *testing.T) {
	r := daiminkan5z(t, "5z5z5z4p147m258s")
	p := &r.players[2]
	p.melds = append([]Called{called("4p", 1, false)}, p.melds...)
	setHand(r, 3, "123m456m789s23p55s", "") // waits 1p/4p; 1m would be the kan dora
	mustApply(t, r, Action{Seat: 2, Type: Kan, Tile: "4p"})
	if r.Phase() != PhaseCall || !r.LegalFor(3).Ron {
		t.Fatalf("phase %s legal %+v", r.Phase(), r.LegalFor(3))
	}
	mustApply(t, r, Action{Seat: 3, Type: Ron})
	res := r.Result()
	if !hasYaku(res, "chankan") || res.Win.Dora != 0 {
		t.Fatalf("dora %d yaku %v", res.Win.Dora, yakuKeys(res))
	}
	if d, u := indicators(r); d != 1 || u != 1 {
		t.Fatalf("indicators %d ura %d", d, u)
	}
}

// Before the declarer's discard the kan's indicator is still face down:
// the other seats do not see it.
func TestPendingKanDoraIsNotVisible(t *testing.T) {
	r := daiminkan5z(t, "5z5z5z147m258p369s2z")
	setHand(r, 1, "147p258s368m2467z", "") // no 9m in the viewer's hand
	nine := tile.MakeKind(tile.Man, 9)     // the second indicator
	if n := r.ViewFor(1).Visible()[nine]; n != 0 {
		t.Fatalf("9m visible %d before the discard", n)
	}
	passSafe(t, r, 2)
	if n := r.ViewFor(1).Visible()[nine]; n != 1 {
		t.Fatalf("9m visible %d after the discard", n)
	}
}

// Replaying the log of a round with an open kan reproduces it exactly.
func TestReplayWithDaiminkan(t *testing.T) {
	for seed := range int64(200) {
		r := New(seed)
		playAll(t, r, greedy{})
		if !slices.ContainsFunc(r.Events(), func(e Action) bool { return e.Type == Kan && len(e.Tiles) == 3 }) {
			continue
		}
		again := New(seed)
		for _, a := range r.Log() {
			mustApply(t, again, a)
		}
		if again.Phase() != PhaseEnded || !reflect.DeepEqual(again.ViewFor(0), r.ViewFor(0)) {
			t.Fatalf("seed %d: replay differs", seed)
		}
		return
	}
	t.Fatal("no round with an open kan")
}
