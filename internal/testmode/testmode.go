// Package testmode sizes the randomized and whole-game test loops for the
// three ways the suite runs:
//
//   - go test -short ./...       the race job: the smallest loops
//   - go test ./...              pull requests: a reduced, fixed-seed subset
//   - MHJDOJO_FULL=1 go test ./...  the nightly workflow: the exhaustive loops
//
// -short wins over MHJDOJO_FULL, so -short means the same with or without it.
package testmode

import (
	"os"
	"testing"
)

// Full reports whether the exhaustive loops run: MHJDOJO_FULL=1 without -short.
func Full() bool {
	return os.Getenv("MHJDOJO_FULL") == "1" && !testing.Short()
}

// N picks a loop size: short under -short, full under MHJDOJO_FULL=1 and pr
// otherwise.
func N[T ~int | ~int64](full, pr, short T) T {
	switch {
	case testing.Short():
		return short
	case Full():
		return full
	}
	return pr
}
