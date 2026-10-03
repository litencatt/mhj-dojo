// Package sortx sorts slices with one shared sort for every element type.
// slices.Sort and slices.SortFunc are generic, so each element type sorted
// adds its own copy of the sort to the WASM build; these wrap
// sort.SliceStable, so each type adds only the wrapper (#148).
package sortx

import (
	"cmp"
	"sort"
)

// Func sorts s by c, keeping the order of equal elements (as
// slices.SortStableFunc does).
func Func[T any](s []T, c func(a, b T) int) {
	sort.SliceStable(s, func(i, j int) bool { return c(s[i], s[j]) < 0 })
}

// Ordered sorts s in ascending order (as slices.Sort does, for values
// without NaNs).
func Ordered[T cmp.Ordered](s []T) {
	sort.SliceStable(s, func(i, j int) bool { return s[i] < s[j] })
}
