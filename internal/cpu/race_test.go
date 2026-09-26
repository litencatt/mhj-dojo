//go:build race

package cpu

// raceEnabled reports whether the race detector is on; it slows the CPU
// player 5-10x, which makes timing assertions meaningless.
const raceEnabled = true
