package session

import (
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
)

// fixedWall returns a wall starting with the given hand (13 tiles) and draws.
func fixedWall(t testing.TB, hand, draws string) *wall.Wall {
	t.Helper()
	w, err := wall.WithFront(7, append(tile.MustParseHand(hand), tile.MustParseHand(draws)...))
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func mustCreate(t *testing.T, st *Store, seed int64, maxTurns int) *Session {
	t.Helper()
	s, err := st.Create(&seed, maxTurns)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCreateState(t *testing.T) {
	st := NewStore()
	s := mustCreate(t, st, 42, 0)
	v := s.State()
	if v.Seed != 42 || v.MaxTurns != DefaultMaxTurns || v.NodeID != 0 || v.Turn != 0 || v.Status != StatusPlaying {
		t.Fatalf("unexpected header %+v", v)
	}
	if len(v.Hand) != 13 || v.Drawn == nil || len(v.DoraIndicators) != 1 || v.RoundWind != "1z" || v.SeatWind != "1z" {
		t.Fatalf("bad deal: %+v", v)
	}
	if v.WallRemaining != wall.LiveDraws-1 {
		t.Fatalf("wall_remaining %d", v.WallRemaining)
	}
	if len(v.Analysis) != 30 || v.Analysis[0].Key != "normal" || v.Analysis[29].Key != "chuuren" ||
		v.Analysis[0].Yakuman || !v.Analysis[21].Yakuman || v.Analysis[21].Key != "kokushi" {
		t.Fatalf("analysis rows: %d", len(v.Analysis))
	}
	distinct := map[string]bool{*v.Drawn: true}
	for _, h := range v.Hand {
		distinct[h] = true
	}
	if len(v.ByDiscard) != len(distinct) {
		t.Fatalf("by_discard has %d keys, want %d", len(v.ByDiscard), len(distinct))
	}
	for k := range distinct {
		if len(v.ByDiscard[k]) != 30 {
			t.Fatalf("by_discard[%s] has %d rows", k, len(v.ByDiscard[k]))
		}
	}
	if len(v.History) != 1 || len(v.Tree) != 1 || v.Tree[0].ParentID != nil || v.Win != nil || v.Discards == nil {
		t.Fatalf("history/tree: %+v %+v", v.History, v.Tree)
	}
	if len(v.History[0].Shanten) != 30 {
		t.Fatalf("history shanten keys: %d", len(v.History[0].Shanten))
	}

	// Same seed, same game.
	w := mustCreate(t, st, 42, 0).State()
	if !slices.Equal(w.Hand, v.Hand) || *w.Drawn != *v.Drawn || w.SessionID == v.SessionID {
		t.Fatal("same seed should deal the same hand in a new session")
	}
}

func TestRemainingCountsVisibleTiles(t *testing.T) {
	st := NewStore()
	s, _ := st.CreateWithWall(fixedWall(t, "123456789m1234p", "5z"), 0)
	v := s.State()
	// visible: hand + drawn 5z + dora indicator
	for _, row := range v.Analysis {
		if row.Key != "normal" {
			continue
		}
		// tenpai on 1p/4p: 1p and 4p are each held once.
		want := map[string]int{"1p": 3, "4p": 3}
		for _, u := range row.Ukeire {
			w := want[u.Tile]
			if v.DoraIndicators[0] == u.Tile {
				w--
			}
			if u.Remaining != w {
				t.Fatalf("remaining %s = %d, want %d", u.Tile, u.Remaining, w)
			}
		}
		if len(row.Ukeire) != 2 || row.UkeireTotal != row.Ukeire[0].Remaining+row.Ukeire[1].Remaining {
			t.Fatalf("ukeire %+v total %d", row.Ukeire, row.UkeireTotal)
		}
	}
}

func TestDiscardGotoBranch(t *testing.T) {
	st := NewStore()
	s := mustCreate(t, st, 1, 0)
	root := s.State()
	drawn := *root.Drawn

	v, err := s.Discard(drawn)
	if err != nil {
		t.Fatal(err)
	}
	if v.NodeID != 1 || v.Turn != 1 || !slices.Equal(v.Hand, root.Hand) || !slices.Equal(v.Discards, []string{drawn}) {
		t.Fatalf("after tsumogiri: %+v", v)
	}
	if *v.History[1].Draw != drawn || *v.History[1].Discard != drawn || len(v.History) != 2 {
		t.Fatalf("history: %+v", v.History)
	}
	if v.WallRemaining != wall.LiveDraws-2 {
		t.Fatalf("wall_remaining %d", v.WallRemaining)
	}

	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	other := root.Hand[0]
	if other == drawn {
		other = root.Hand[12]
	}
	b, err := s.Discard(other)
	if err != nil {
		t.Fatal(err)
	}
	if b.NodeID != 2 || len(b.Tree) != 3 || *b.Tree[2].ParentID != 0 {
		t.Fatalf("branch: node %d tree %d", b.NodeID, len(b.Tree))
	}
	if !slices.Contains(b.Hand, drawn) {
		t.Fatal("drawn tile should be kept after discarding from hand")
	}

	// Re-discarding the same tile from the root moves to the existing child.
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	again, _ := s.Discard(drawn)
	if again.NodeID != 1 || len(again.Tree) != 3 {
		t.Fatalf("expected to revisit node 1, got %d (tree %d)", again.NodeID, len(again.Tree))
	}
	// Both branches remain selectable.
	if v2, err := s.Goto(2); err != nil || v2.NodeID != 2 {
		t.Fatal("branch 2 lost")
	}
}

func TestExhausted(t *testing.T) {
	st := NewStore()
	s := mustCreate(t, st, 3, 2)
	for i := 0; i < 2; i++ {
		v := s.State()
		if _, err := s.Discard(*v.Drawn); err != nil {
			t.Fatal(err)
		}
	}
	v := s.State()
	if v.Status != StatusExhausted || v.Drawn != nil || len(v.ByDiscard) != 0 || v.CanTsumo || v.Turn != 2 {
		t.Fatalf("expected exhausted: %+v", v)
	}
	if v.WallRemaining != wall.LiveDraws-2 {
		t.Fatalf("wall_remaining %d", v.WallRemaining)
	}
	if _, err := s.Discard(v.Hand[0]); !errors.Is(err, ErrConflict) {
		t.Fatalf("discard at exhausted node: %v", err)
	}
	if _, err := s.Tsumo(); !errors.Is(err, ErrConflict) {
		t.Fatalf("tsumo at exhausted node: %v", err)
	}
}

func TestTsumo(t *testing.T) {
	st := NewStore()
	s, err := st.CreateWithWall(fixedWall(t, "234m567p345s6788s", "5s1z"), 0)
	if err != nil {
		t.Fatal(err)
	}
	v := s.State()
	if !v.CanTsumo || *v.Drawn != "5s" {
		t.Fatalf("can_tsumo=%v drawn=%v", v.CanTsumo, *v.Drawn)
	}
	w, err := s.Tsumo()
	if err != nil {
		t.Fatal(err)
	}
	if w.Status != StatusTsumo || w.Win == nil || w.Drawn != nil || w.Turn != 0 || len(w.Win.Tiles) != 14 {
		t.Fatalf("tsumo state: %+v", w)
	}
	var keys []string
	for _, y := range w.Win.Yaku {
		keys = append(keys, y.Key)
	}
	if !slices.Equal(keys, []string{"tsumo", "tanyao", "pinfu"}) {
		t.Fatalf("yaku %v", keys)
	}
	last := w.History[len(w.History)-1]
	if *last.Shanten["normal"] != -1 || *last.Shanten["tanyao"] != -1 || *last.Shanten["pinfu"] != -1 || *last.Shanten["toitoi"] < 0 {
		t.Fatalf("win history shanten: normal=%d tanyao=%d pinfu=%d toitoi=%d", *last.Shanten["normal"], *last.Shanten["tanyao"], *last.Shanten["pinfu"], *last.Shanten["toitoi"])
	}
	if *w.Tree[1].NormalShanten != -1 || w.Tree[1].Discard != nil || *w.Tree[1].Draw != "5s" {
		t.Fatalf("tree tsumo node: %+v", w.Tree[1])
	}
	if _, err := s.Discard("5s"); !errors.Is(err, ErrConflict) {
		t.Fatalf("discard after tsumo: %v", err)
	}
	// Declaring again from the parent revisits the same node.
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	again, _ := s.Tsumo()
	if again.NodeID != w.NodeID || len(again.Tree) != 2 {
		t.Fatal("tsumo should reuse the existing node")
	}
	// After tsumogiri the hand is no longer complete.
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Discard("5s"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Tsumo(); !errors.Is(err, ErrConflict) {
		t.Fatalf("tsumo with incomplete hand: %v", err)
	}
}

func TestErrors(t *testing.T) {
	st := NewStore()
	if _, err := st.Get("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := st.CreateWithWall(wall.New(1), 200); !errors.Is(err, ErrInvalid) {
		t.Fatal("max_turns out of range should fail")
	}
	s := mustCreate(t, st, 5, 0)
	if _, err := s.Discard("8z"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid tile: %v", err)
	}
	if _, err := s.Goto(99); !errors.Is(err, ErrNotFound) {
		t.Fatalf("goto: %v", err)
	}
}

func TestRedFiveDiscardIsExact(t *testing.T) {
	st := NewStore()
	s, _ := st.CreateWithWall(fixedWall(t, "0m5m123p456p789s11z", "9m"), 0)
	v := s.State()
	if _, ok := v.ByDiscard["0m"]; !ok {
		t.Fatalf("by_discard keys %v", v.ByDiscard)
	}
	if _, ok := v.ByDiscard["5m"]; !ok {
		t.Fatal("plain 5m candidate missing")
	}
	a, err := s.Discard("0m")
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(a.Hand, "0m") || !slices.Contains(a.Hand, "5m") || a.Discards[0] != "0m" {
		t.Fatalf("hand after discarding red five: %v", a.Hand)
	}
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	b, _ := s.Discard("5m")
	if b.NodeID == a.NodeID || !slices.Contains(b.Hand, "0m") {
		t.Fatal("0m and 5m discards must be distinct children")
	}
}

func TestStoreEviction(t *testing.T) {
	st := NewStore()
	first := mustCreate(t, st, 1, 1)
	for i := 0; i < MaxSessions; i++ {
		mustCreate(t, st, int64(i), 1)
	}
	if _, err := st.Get(first.ID()); !errors.Is(err, ErrNotFound) {
		t.Fatal("oldest session should be evicted")
	}
}

func TestConcurrentUse(t *testing.T) {
	st := NewStore()
	s := mustCreate(t, st, 9, 0)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 5; i++ {
				v := s.State()
				if v.Drawn != nil {
					_, _ = s.Discard(*v.Drawn) // conflicts between goroutines are expected
				}
				_, _ = s.Goto(g % 2)
			}
		}(g)
	}
	wg.Wait()
	if n := len(s.State().Tree); n < 2 {
		t.Fatalf("tree has %d nodes", n)
	}
}

// Regression: a chiitoitsu win is still a complete hand, so the tree shows -1.
func TestTsumoChiitoitsuTreeShanten(t *testing.T) {
	st := NewStore()
	s, err := st.CreateWithWall(fixedWall(t, "1122m3344p5566s7z", "7z"), 0)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.Tsumo()
	if err != nil {
		t.Fatal(err)
	}
	if *w.Tree[1].NormalShanten != -1 {
		t.Fatalf("tree normal_shanten = %d, want -1", *w.Tree[1].NormalShanten)
	}
	last := w.History[len(w.History)-1].Shanten
	if *last["chiitoitsu"] != -1 || *last["normal"] < 0 {
		t.Fatalf("history chiitoitsu=%d normal=%d", *last["chiitoitsu"], *last["normal"])
	}
}

// Regression: the "tsumo" child key must not be reachable as a discard.
func TestDiscardCannotReachTsumoChild(t *testing.T) {
	st := NewStore()
	s, _ := st.CreateWithWall(fixedWall(t, "234m567p345s6788s", "5s"), 0)
	if _, err := s.Tsumo(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Discard("tsumo"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("discard \"tsumo\": %v", err)
	}
	if v := s.State(); v.NodeID != 0 {
		t.Fatalf("moved to node %d", v.NodeID)
	}
}

// Dora are always shown; ura dora stay hidden until the game ends.
func TestDoraAndUraDora(t *testing.T) {
	st := NewStore()
	s := mustCreate(t, st, 3, 1)
	w := wall.New(3)
	ind, ura := w.DoraIndicators()[0], w.UraDoraIndicators()[0]

	v := s.State()
	if len(v.Dora) != 1 || v.Dora[0] != tile.DoraFromIndicator(ind.Kind).String() {
		t.Fatalf("dora %v for indicator %v", v.Dora, ind)
	}
	if len(v.UraDoraIndicators) != 0 || len(v.UraDora) != 0 {
		t.Fatalf("ura dora revealed while playing: %v %v", v.UraDoraIndicators, v.UraDora)
	}
	if _, err := s.Discard(*v.Drawn); err != nil {
		t.Fatal(err)
	}
	v = s.State()
	if v.Status != StatusExhausted {
		t.Fatalf("status %s", v.Status)
	}
	if len(v.UraDoraIndicators) != 1 || v.UraDoraIndicators[0] != ura.String() ||
		len(v.UraDora) != 1 || v.UraDora[0] != tile.DoraFromIndicator(ura.Kind).String() {
		t.Fatalf("ura dora at the end: %v %v (want %v)", v.UraDoraIndicators, v.UraDora, ura)
	}
	// Going back to a playing node hides them again.
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	if v = s.State(); len(v.UraDoraIndicators) != 0 {
		t.Fatalf("ura dora after goto: %v", v.UraDoraIndicators)
	}
}

func TestTreeIsBounded(t *testing.T) {
	defer func(n int) { maxNodes = n }(maxNodes)
	maxNodes = 10
	st := NewStore()
	s, err := st.Create(nil, wall.LiveDraws)
	if err != nil {
		t.Fatal(err)
	}
	for len(s.nodes) < maxNodes {
		if _, err := s.Discard(*s.State().Drawn); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Discard(*s.State().Drawn); !errors.Is(err, ErrTreeFull) {
		t.Fatalf("discard past the node limit: %v", err)
	}
	// Tsumo creates a node too, so it is capped as well.
	full, err := st.CreateWithWall(fixedWall(t, "234m567p345s6788s", "5s1z"), 0)
	if err != nil {
		t.Fatal(err)
	}
	maxNodes = 1
	if _, err := full.Tsumo(); !errors.Is(err, ErrTreeFull) {
		t.Fatalf("tsumo past the node limit: %v", err)
	}
	maxNodes = 10
	// Revisiting an existing node is still allowed.
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Discard(*s.State().Drawn); err != nil {
		t.Fatalf("moving to an existing child: %v", err)
	}
}

// pruneAnalysisCache (docs/api.md "Memory") frees a node's full analysis
// once it's no longer the current node or on its history path; revisiting
// it must recompute the exact same state(), not just cheaper data.
func TestStateUnchangedAfterCachePruning(t *testing.T) {
	st := NewStore()
	s := mustCreate(t, st, 42, wall.LiveDraws)

	// Two distinct first moves from the root, so branch A and branch B
	// below are sibling subtrees that don't share any node past the root.
	v0 := s.State()
	tiles := append(append([]string{}, v0.Hand...), *v0.Drawn)
	a, b := tiles[0], tiles[len(tiles)-1]
	if a == b {
		t.Fatalf("need two distinct discards at the root, got only %q", a)
	}

	// Branch A: discard a, then a few more turns, remembering the node
	// right after the first discard as "mid".
	va, err := s.Discard(a)
	if err != nil {
		t.Fatal(err)
	}
	midID := va.NodeID
	for i := 0; i < 3; i++ {
		if _, err := s.Discard(*s.State().Drawn); err != nil {
			t.Fatal(err)
		}
	}

	// Branch B: back to the root, then the other discard and a few more
	// turns, so the whole tree (both branches) exists before either
	// snapshot below — otherwise the two state()s would legitimately
	// differ in the tree field just because branch B didn't exist yet.
	if _, err := s.Goto(0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Discard(b); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := s.Discard(*s.State().Drawn); err != nil {
			t.Fatal(err)
		}
	}
	tipB := s.current

	before, err := s.Goto(midID)
	if err != nil {
		t.Fatal(err)
	}
	wantJSON, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}

	// Move to branch B's tip and back. mid is not an ancestor of anything
	// in branch B, so leaving it prunes its cached analysis (and the
	// deeper branch-A nodes', by falling off the path); no nodes are
	// added, so the tree field can't differ for that reason.
	if _, err := s.Goto(tipB); err != nil {
		t.Fatal(err)
	}
	after, err := s.Goto(midID)
	if err != nil {
		t.Fatal(err)
	}
	gotJSON, err := json.Marshal(after)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("state changed after cache pruning:\nbefore: %s\nafter:  %s", wantJSON, gotJSON)
	}
}
