//go:build race

package server

// raceEnabled reports whether the race detector is on; it slows the game
// engine 5-10x, which makes timing assertions meaningless.
const raceEnabled = true
