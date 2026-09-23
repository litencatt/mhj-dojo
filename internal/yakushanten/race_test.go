//go:build race

package yakushanten

// raceEnabled reports whether the race detector is on; it slows this
// CPU-bound code 5-10x, which makes timing assertions meaningless.
const raceEnabled = true
