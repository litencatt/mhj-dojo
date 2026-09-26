package game

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// setPon gives seat a called pon of kind s from seat from and replaces its
// concealed tiles (and drawn tile, if given).
func setPon(r *Round, seat, from int, s, hand, drawn string) {
	setHand(r, seat, hand, drawn)
	p := &r.players[seat]
	k, _ := tile.Parse(s)
	p.melds = []Called{{Meld: yaku.Meld{Type: yaku.Trip, Kind: k.Kind, Open: true}, Tiles: []tile.Tile{k, k, k}, From: from}}
}

// An open hand can ron with an open yaku and scores open fu.
func TestRonWithCalledMeld(t *testing.T) {
	r := newRound(t)
	setPon(r, 1, 3, "8p", "234m567m34s66s", "") // tanyao, waits 2s / 5s
	setHand(r, 0, junk[0], "5s")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5s"})
	if r.Actor() != 1 || !r.LegalFor(1).Ron {
		t.Fatalf("no ron offered: phase %s actor %d", r.Phase(), r.Actor())
	}
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	res := r.Result()
	if !hasYaku(res, "tanyao") || hasYaku(res, "pinfu") || res.Win.Fu != 30 || res.Points.Ron != 1000 {
		t.Fatalf("win %+v points %+v", res.Win, res.Points)
	}
}

// After a call a seat discards without a drawn tile; riichi is not offered
// to an open hand; the meld is public and counts as visible.
func TestTurnWithoutDrawnTile(t *testing.T) {
	r := newRound(t)
	setPon(r, 0, 2, "8p", "234m567m34s66s1z", "") // 11 concealed tiles, no draw
	l := r.LegalFor(0)
	if len(l.Discards) != 10 || len(l.Riichi) != 0 || l.Tsumo { // 11 tiles, 10 kinds (66s)
		t.Fatalf("legal %+v", l)
	}
	v := r.ViewFor(1)
	if len(v.Seats[0].Melds) != 1 || v.Seats[0].HandCount != 11 || v.Seats[0].Hand != nil {
		t.Fatalf("seat 0 as seen by seat 1: %+v", v.Seats[0])
	}
	v.Seats[0].Melds[0].Tiles[0] = tile.Tile{} // a view must not share the round's tiles
	if r.players[0].melds[0].Tiles[0].Kind != tile.MakeKind(tile.Pin, 8) {
		t.Fatal("changing a view changed the round")
	}
	v = r.ViewFor(1)
	if vis := v.Visible(); vis[tile.MakeKind(tile.Pin, 8)] != 3 {
		t.Fatalf("called 8p not visible: %d", vis[tile.MakeKind(tile.Pin, 8)])
	}
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "1z"})
	if r.Actor() != 1 || !slices.Equal(tile.Strings(r.players[0].hand), tile.Strings(tile.MustParseHand("234m567m34s66s"))) {
		t.Fatalf("after the discard: actor %d hand %v", r.Actor(), r.players[0].hand)
	}
	// the open hand is tenpai on 2s / 5s
	if w := r.waits(0); len(w) != 2 {
		t.Fatalf("open hand waits %v", w)
	}
	// riichi is never offered to an open hand, even with a draw
	setPon(r, 0, 2, "8p", "234m567m34s66s", "9s")
	r.turn, r.phase = 0, PhaseDiscard
	if l := r.LegalFor(0); len(l.Riichi) != 0 {
		t.Fatalf("riichi offered to an open hand: %v", l.Riichi)
	}
}

// A wait on a kind whose four tiles are all in the seat's hand (concealed or
// called) is no wait: here 8p is pon'd and the fourth 8p is concealed.
func TestNoWaitOnOwnFourthTile(t *testing.T) {
	r := newRound(t)
	setPon(r, 1, 3, "8p", "234m567m666s8p", "")
	if w := r.waits(1); len(w) != 0 {
		t.Fatalf("waits %v", w)
	}
	r.draws = wall.LiveDraws4
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "9s"})
	if res := r.Result(); res.Tenpai[1] {
		t.Fatal("dead wait counted as tenpai at the draw")
	}
}
