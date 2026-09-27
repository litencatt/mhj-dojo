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
	v := put(s.State(View{}), nil)
	for step := 0; v.Drawn != nil; step++ {
		if v.CanTsumo && step%2 == 0 {
			v = put(s.Tsumo(nil, View{}))
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
		v = put(s.Discard(choice, nil, View{}))
	}
	for _, back := range []int{2, 5} {
		v = put(s.Goto(back, View{}))
		for k := 0; k < 3 && v.Drawn != nil; k++ {
			tiles := append(append([]string{}, v.Hand...), *v.Drawn)
			v = put(s.Discard(tiles[(k*7+int(seed))%len(tiles)], nil, View{}))
		}
	}
	for id := len(s.nodes) - 1; id >= 0; id -= 3 {
		put(s.Goto(id, View{}))
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

// TestGoldenStates pins the state JSON of a few scripted sessions to what
// the engine answered at commit 383fe58, before the analyses were shared
// between nodes, requests and the history (see TestCachesMatchFresh). The
// hashes were taken again when the JSON took its slimmer shape (ukeire as
// tile kinds counted by one remaining map, by_discard rows without the
// analysis's names and han, node_count): converted to that shape, the old
// states were the same as the new ones, state for state (a one-off check
// described in the message of commit 776859a, which re-pinned them).
func TestGoldenStates(t *testing.T) {
	want := map[int64]string{
		1: "bdf2bd60871aa04a10460196971bd97dc06e4da57e269bdbe92e90d0e254782a",
		2: "d5e264e2474c0a73e15a78962cc253397f264fdf5a957121f14d33cc86f7d5ca",
		3: "4b9195d2bc29e621b717b645bf047b3730b6933fdfb2d082160c998d74467589",
		4: "8e763c52de89ef8b1a0ef4d045fef09496e0e2bbfb65cab2cd15d0e572383b00",
	}
	for seed := int64(1); seed <= 4; seed++ {
		if got := goldenSession(t, seed); got != want[seed] {
			t.Errorf("seed %d: states hash to %s, want %s", seed, got, want[seed])
		}
	}
}
