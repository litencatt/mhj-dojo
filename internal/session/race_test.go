//go:build race

package session

// raceEnabled reports whether the race detector is on; it slows the
// analysis 5-10x, which makes timing assertions meaningless.
const raceEnabled = true
