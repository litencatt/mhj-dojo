package cpu

import (
	"testing"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// With a peek, the players (the weak one aside) never discard a tile a
// tenpai hand they see would ron, and do not fold against a riichi they
// see is not waiting on their discard.
func TestPeekAvoidsDealIn(t *testing.T) {
	v := view("123m456m789p57s23z", "1p")
	if a := New().Decide(v, legal(v)); a.Tile != "2z" {
		t.Fatalf("no peek: got %+v, want 2z (the test needs it)", a)
	}
	// Seat 1 waits on 2z alone (三暗刻), unseen without the peek.
	v.Seats[1].Hand = tile.MustParseHand("111m222p333s456s2z")
	for _, p := range []*Player{New(), NewMaster(), NewUra()} {
		if a := p.Decide(v, legal(v)); a.Tile == "2z" {
			t.Errorf("dealt in with a peek: %+v", a)
		}
	}
	// Furiten on 2z (in its river), it cannot ron it: 2z is safe again.
	v.Seats[1].River = []game.RiverTile{{Tile: mustTile("2z")}}
	if a := New().Decide(v, legal(v)); a.Tile != "2z" {
		t.Errorf("furiten wait: got %+v, want 2z", a)
	}
	// In riichi but waiting elsewhere, the hand is not folded against.
	v = view("123m456m789m23p5s1z", "9s")
	v.Dealer = 2
	v.Seats[1].Riichi = true
	v.Seats[1].River = []game.RiverTile{{Tile: mustTile("2m"), Riichi: true}}
	if a := NewMaster().Decide(v, legal(v)); a.Tile != "2m" {
		t.Fatalf("no peek: got %+v, want genbutsu 2m (the test needs it)", a)
	}
	v.Seats[1].Hand = tile.MustParseHand("111m222p333s456s7z")
	if a := NewMaster().Decide(v, legal(v)); a.Tile == "2m" {
		t.Errorf("folded with a peek: %+v", a)
	}
}
