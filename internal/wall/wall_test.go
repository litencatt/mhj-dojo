package wall

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
)

func TestSameSeedSameWall(t *testing.T) {
	a, b := New(42), New(42)
	if a.Tiles() != b.Tiles() {
		t.Fatal("same seed produced different walls")
	}
	for k := 0; k < LiveDraws; k++ {
		x, _ := a.Draw(k)
		y, _ := b.Draw(k)
		if x != y {
			t.Fatalf("draw %d differs", k)
		}
	}
	if New(43).Tiles() == a.Tiles() {
		t.Fatal("different seeds produced the same wall")
	}
}

func TestComposition(t *testing.T) {
	for seed := int64(0); seed < 20; seed++ {
		w := New(seed)
		var c tile.Counts
		reds := 0
		for _, tl := range w.Tiles() {
			c[tl.Kind]++
			if tl.Red {
				reds++
				if tl.Kind.Num() != 5 || tl.Kind.IsHonor() {
					t.Fatalf("red flag on %s", tl.Kind)
				}
			}
		}
		for k, n := range c {
			if n != 4 {
				t.Fatalf("seed %d: kind %s has %d copies", seed, tile.Kind(k), n)
			}
		}
		if reds != 3 {
			t.Fatalf("seed %d: %d red fives", seed, reds)
		}
		if len(w.Hand()) != HandSize || len(w.DoraIndicators()) != 1 {
			t.Fatal("bad deal")
		}
	}
}

func TestDrawBounds(t *testing.T) {
	w := New(1)
	if LiveDraws != 109 {
		t.Fatalf("LiveDraws = %d", LiveDraws)
	}
	if _, ok := w.Draw(LiveDraws); ok {
		t.Fatal("draw past live wall should fail")
	}
	if _, ok := w.Draw(-1); ok {
		t.Fatal("negative draw should fail")
	}
	// Hand, draws and dora indicator are disjoint positions of the wall.
	all := w.Tiles()
	d0, _ := w.Draw(0)
	if d0 != all[HandSize] || w.DoraIndicators()[0] != all[Size-DeadWallSize+doraIndicatorPos] {
		t.Fatal("unexpected wall layout")
	}
	// The ura-dora indicator is the tile below the dora indicator.
	if u := w.UraDoraIndicators(); len(u) != 1 || u[0] != all[Size-DeadWallSize+doraIndicatorPos+1] {
		t.Fatalf("ura-dora indicators %v", u)
	}
}

func TestFromTilesValidates(t *testing.T) {
	ts := FullSet()
	if _, err := FromTiles(0, ts); err != nil {
		t.Fatal(err)
	}
	ts[0] = ts[Size-1]
	if _, err := FromTiles(0, ts); err == nil {
		t.Fatal("expected error for non-permutation")
	}
}

func TestWithFront(t *testing.T) {
	front := tile.MustParseHand("0m5m5m5m123p456p789s1z")
	w, err := WithFront(3, front)
	if err != nil {
		t.Fatal(err)
	}
	for i, f := range front {
		if w.Tiles()[i] != f {
			t.Fatalf("position %d = %s, want %s", i, w.Tiles()[i], f)
		}
	}
	if _, err := FromTiles(3, w.Tiles()); err != nil {
		t.Fatal(err)
	}
	if _, err := WithFront(3, tile.MustParseHand("0m0m")); err == nil {
		t.Fatal("two red 5m should fail")
	}
}

func TestFourPlayerDeal(t *testing.T) {
	w := New(7)
	if !slices.Equal(w.Hand(), w.HandOf(0)) {
		t.Error("seat 0 must get the solo hand")
	}
	var all []tile.Tile
	for s := 0; s < Seats; s++ {
		all = append(all, w.HandOf(s)...)
	}
	for k := 0; ; k++ {
		d, ok := w.Draw4(k)
		if !ok {
			if k != LiveDraws4 || LiveDraws4 != 70 {
				t.Fatalf("draws = %d, want %d = 70", k, LiveDraws4)
			}
			break
		}
		all = append(all, d)
	}
	ts := w.Tiles()
	all = append(all, ts[Size-DeadWallSize:]...)
	want := FullSet()
	got := tile.CountsOf(all)
	if got != tile.CountsOf(want[:]) || len(all) != Size {
		t.Fatalf("deal + draws + dead wall is not the full set (%d tiles)", len(all))
	}
	if _, ok := w.Draw4(-1); ok {
		t.Error("negative draw index accepted")
	}
}

func TestHandOfRejectsBadSeat(t *testing.T) {
	w := New(1)
	for _, seat := range []int{-1, Seats} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("HandOf(%d) did not panic", seat)
				}
			}()
			w.HandOf(seat)
		}()
	}
}
