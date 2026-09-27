package session

import (
	"crypto/sha256"
	"fmt"
	"testing"
)

// goldenSession plays a scripted exploration of a seed's tree (the advice's
// best discard, tsumogiri and other tiles, rewinds and branches, jumps
// across the tree) and returns the sha256 of every state's JSON in turn.
func goldenSession(t *testing.T, seed int64) string {
	t.Helper()
	h := sha256.New()
	put := func(st State, err error) State {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		h.Write([]byte(stateJSON(t, st)))
		return st
	}
	s := mustCreate(t, NewStore(), seed, 10+int(seed%5))
	v := put(s.State(), nil)
	for step := 0; v.Drawn != nil; step++ {
		if v.CanTsumo && step%2 == 0 {
			v = put(s.Tsumo(nil))
			break
		}
		tiles := append(append([]string{}, v.Hand...), *v.Drawn)
		choice := v.Advice.Candidates[0].Tile
		switch step % 4 {
		case 1:
			choice = *v.Drawn
		case 3:
			choice = tiles[(step*5)%len(tiles)]
		}
		v = put(s.Discard(choice, nil))
	}
	for _, back := range []int{2, 5} {
		v = put(s.Goto(back))
		for k := 0; k < 3 && v.Drawn != nil; k++ {
			tiles := append(append([]string{}, v.Hand...), *v.Drawn)
			v = put(s.Discard(tiles[(k*7+int(seed))%len(tiles)], nil))
		}
	}
	for id := len(s.nodes) - 1; id >= 0; id -= 3 {
		put(s.Goto(id))
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

// TestGoldenStates pins the state JSON of a few scripted sessions to what
// the engine answered at commit 383fe58, before the analyses were shared
// between nodes, requests and the history (see TestCachesMatchFresh).
func TestGoldenStates(t *testing.T) {
	want := map[int64]string{
		1: "c4b45275e1a20b55da5fa1d21dcb56976da13c2e6f2e36b9e3ddd69e6b535258",
		2: "f2a870bd4ef5c4a29607e1923881262747ab70ea81420dc525e5395ee002d8d1",
		3: "a26b1b7ffe1454a31b26757e3503e5e25cb14e4967c345d6435f7d17a6531d7f",
		4: "8e8293277f565266722bc9826a44a6fe271c9e07882742f51b954827a1794dc9",
	}
	for seed := int64(1); seed <= 4; seed++ {
		if got := goldenSession(t, seed); got != want[seed] {
			t.Errorf("seed %d: states hash to %s, want %s", seed, got, want[seed])
		}
	}
}
