package game

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// pastFirstDraw gives seat a discard, so its next tsumo is not its first
// draw (no 天和/地和) in tests that rig a win on the opening draw.
func pastFirstDraw(r *Round, seat int) {
	r.players[seat].river = append(r.players[seat].river, RiverTile{Tile: tile.MustParseHand("1z")[0]})
}

// skipCalls passes every pending claim.
func skipCalls(t *testing.T, r *Round) {
	t.Helper()
	for r.Phase() == PhaseCall {
		mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
	}
}

// The dealer winning on its first draw scores 天和 alone (a yakuman).
func TestTenhou(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, "123m456m789m23p55s", "1p")
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	res := r.Result()
	if !slices.Equal(yakuKeys(res), []string{"tenhou"}) || res.Win.HanTotal != 13 || res.Points.FromNonDealer != 16000 {
		t.Fatalf("yaku %v han %d points %+v", yakuKeys(res), res.Win.HanTotal, res.Points)
	}
	checkDeltas(t, r, res)
}

// A non-dealer winning on its first draw, with no call before it, scores 地和.
func TestChiihou(t *testing.T) {
	r := newRound(t)
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "9s"})
	skipCalls(t, r)
	setHand(r, 1, "123m456m789m23p55s", "1p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	res := r.Result()
	if !slices.Equal(yakuKeys(res), []string{"chiihou"}) || res.Points.FromDealer != 16000 || res.Points.FromNonDealer != 8000 {
		t.Fatalf("yaku %v points %+v", yakuKeys(res), res.Points)
	}
	checkDeltas(t, r, res)
}

// 地和 is a tsumo only: a ron on the first go-around is not a yakuman.
func TestChiihouNotOnRon(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, junk[0], "1p")
	setHand(r, 1, "123m456m789m23p55s", "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "1p"})
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	if res := r.Result(); hasYaku(res, "chiihou") || !hasYaku(res, "ittsu") {
		t.Fatalf("yaku %v", yakuKeys(res))
	}
}

// A pon before the seat's first draw voids 地和.
func TestChiihouVoidedByCall(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, junk[0], "7z")
	setHand(r, 2, "147s258m369p1277z", "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "7z"})
	mustApply(t, r, Action{Seat: 2, Type: Pon})
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "1s"})
	skipCalls(t, r)
	setHand(r, 3, "123m456m789m23p55s", "1p")
	mustApply(t, r, Action{Seat: 3, Type: Tsumo})
	if res := r.Result(); hasYaku(res, "chiihou") || !hasYaku(res, "tsumo") {
		t.Fatalf("yaku %v", yakuKeys(res))
	}
}

// A concealed kan voids it too: another seat's before the first draw, and the
// dealer's own (its win is then 嶺上開花, not 天和).
func TestTenhouChiihouVoidedByKan(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, "7777z147m258p369s", "1z")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "1z"})
	skipCalls(t, r)
	setHand(r, 1, "123m456m789m23p55s", "1p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	if res := r.Result(); hasYaku(res, "chiihou") || !hasYaku(res, "tsumo") {
		t.Fatalf("after another seat's kan: yaku %v", yakuKeys(res))
	}

	r = newRound(t)
	setHand(r, 0, "7777z123m456m23p5s", "5s")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	setHand(r, 0, "123m456m23p55s", "1p")
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	if res := r.Result(); hasYaku(res, "tenhou") || !hasYaku(res, "rinshan") {
		t.Fatalf("after its own kan: yaku %v", yakuKeys(res))
	}
}
