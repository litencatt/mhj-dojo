package sortx

import (
	"cmp"
	"math/rand/v2"
	"slices"
	"testing"
)

// The same results as slices' sorts, ties included.
func TestMatchesSlices(t *testing.T) {
	type item struct{ key, pos int }
	r := rand.New(rand.NewPCG(1, 2))
	for n := range 60 {
		ints := make([]int, n)
		items := make([]item, n)
		for i := range n {
			ints[i] = r.IntN(8)
			items[i] = item{key: r.IntN(8), pos: i}
		}
		got, want := slices.Clone(ints), slices.Clone(ints)
		Ordered(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Fatalf("Ordered(%v) = %v, want %v", ints, got, want)
		}
		byKey := func(a, b item) int { return cmp.Compare(a.key, b.key) }
		gotItems, wantItems := slices.Clone(items), slices.Clone(items)
		Func(gotItems, byKey)
		slices.SortStableFunc(wantItems, byKey)
		if !slices.Equal(gotItems, wantItems) {
			t.Fatalf("Func(%v) = %v, want %v", items, gotItems, wantItems)
		}
	}
}
