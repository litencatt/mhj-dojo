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
// described in the message of commit 776859a, which re-pinned them). They
// were re-pinned again when the advice began counting chiitoitsu and kokushi
// (issue #189): with advice and discard_review stripped, seeds 2–4 gave the
// same states as before; seed 1's script follows a different best discard.
func TestGoldenStates(t *testing.T) {
	want := map[int64]string{
		1: "0dd822f0ff6b78d0993199e3e4cdded562946ca95fca1e0d7a5b220ef0b42219",
		2: "5484c6b66893d81bd527d02b84dc197cef4c2c6138e1551936af0e70d5b02d9a",
		3: "03f8a98ac401766c774e8c943b3fea55f0bf65b3cfa279e819e13da569f5e990",
		4: "dc55833e0530174946ba7991d320a34f25cf4f5431c6e86ebf14e3659b9d827d",
	}
	for seed := int64(1); seed <= 4; seed++ {
		if got := goldenSession(t, seed); got != want[seed] {
			t.Errorf("seed %d: states hash to %s, want %s", seed, got, want[seed])
		}
	}
}
