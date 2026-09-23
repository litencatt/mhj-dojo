package wall

import (
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
