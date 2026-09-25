package game

import (
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
)

// endRound ends h's current round with res and the given points.
func endRound(h *Hanchan, res Result, points [4]int) {
	r := h.round
	for s := range r.players {
		r.players[s].points = points[s]
	}
	res.Deposit = r.deposit
	r.result, r.phase = &res, PhaseEnded
}

var even = [4]int{25000, 25000, 25000, 25000}

func TestHanchanProgression(t *testing.T) {
	h := NewHanchan(4, Tonpuu) // first dealer: seat 0
	if h.Dealer() != 0 || h.RoundWind() != tile.East || h.Number() != 1 || h.Honba() != 0 {
		t.Fatalf("start: dealer %d wind %v number %d honba %d", h.Dealer(), h.RoundWind(), h.Number(), h.Honba())
	}
	step := func(res Result, dealer, number, honba int) {
		t.Helper()
		endRound(h, res, even)
		if err := h.Next(); err != nil {
			t.Fatal(err)
		}
		if h.Dealer() != dealer || h.Number() != number || h.Honba() != honba || h.Round().Dealer() != dealer {
			t.Fatalf("after %s: dealer %d number %d honba %d", res.Kind, h.Dealer(), h.Number(), h.Honba())
		}
	}
	step(Result{Kind: "tsumo", Winner: 0, From: -1}, 0, 1, 1)                               // dealer win: renchan
	step(Result{Kind: "draw", Winner: -1, From: -1, Tenpai: [4]bool{true}}, 0, 1, 2)        // dealer tenpai: renchan
	step(Result{Kind: "abort", Reason: AbortSuufon, Winner: -1, From: -1}, 0, 1, 3)         // abortive draw: repeat
	step(Result{Kind: "draw", Winner: -1, From: -1, Tenpai: [4]bool{false, true}}, 1, 2, 4) // dealer noten: moves, honba stays
	step(Result{Kind: "ron", Winner: 2, From: 1}, 2, 3, 0)                                  // non-dealer win: moves, honba 0
	step(Result{Kind: "ron", Winner: 0, From: 2}, 3, 4, 0)
	// East 4, the dealer loses: the East-only game ends
	endRound(h, Result{Kind: "ron", Winner: 0, From: 3}, even)
	if !h.Over() || h.Next() == nil {
		t.Fatal("tonpuu did not end after East 4")
	}
	if len(h.Logs()) != 7 {
		t.Fatalf("%d round logs", len(h.Logs()))
	}
}

func TestHanchanGoesSouthAndEnds(t *testing.T) {
	h := NewHanchan(4, HanchanRule)
	for range 4 {
		endRound(h, Result{Kind: "ron", Winner: (h.Dealer() + 1) % 4, From: h.Dealer()}, even)
		if err := h.Next(); err != nil {
			t.Fatal(err)
		}
	}
	if h.RoundWind() != tile.South || h.Number() != 1 || h.Round().Winds(0).Round != tile.South {
		t.Fatalf("after East 4: %v %d", h.RoundWind(), h.Number())
	}
	for i := range 4 {
		endRound(h, Result{Kind: "ron", Winner: (h.Dealer() + 1) % 4, From: h.Dealer()}, even)
		if i < 3 && h.Over() {
			t.Fatalf("over at South %d", i+1)
		}
		if i < 3 {
			_ = h.Next()
		}
	}
	if !h.Over() {
		t.Fatal("not over after South 4")
	}
	// the last dealer keeps the deal: the game goes on (no agari-yame)
	h = NewHanchan(4, Tonpuu)
	for range 3 {
		endRound(h, Result{Kind: "ron", Winner: (h.Dealer() + 1) % 4, From: h.Dealer()}, even)
		_ = h.Next()
	}
	endRound(h, Result{Kind: "tsumo", Winner: h.Dealer(), From: -1}, even)
	if h.Over() {
		t.Fatal("game ended while the last dealer kept the deal")
	}
}

func TestTobiEndsTheGame(t *testing.T) {
	h := NewHanchan(4, HanchanRule)
	endRound(h, Result{Kind: "ron", Winner: 1, From: 0}, [4]int{-100, 50100, 25000, 25000})
	if !h.Over() {
		t.Fatal("game goes on below zero")
	}
	endRound(h, Result{Kind: "ron", Winner: 1, From: 0}, [4]int{0, 50000, 25000, 25000})
	if h.Over() {
		t.Fatal("exactly zero ended the game")
	}
}

func TestPointsAndSticksCarryOver(t *testing.T) {
	h := NewHanchan(4, Tonpuu)
	h.round.deposit = 2000
	endRound(h, Result{Kind: "draw", Winner: -1, From: -1, Tenpai: [4]bool{true}}, [4]int{26000, 24000, 24000, 24000})
	if err := h.Next(); err != nil {
		t.Fatal(err)
	}
	r := h.Round()
	if r.deposit != 2000 || r.honba != 1 || r.players[0].points != 26000 || r.start != [4]int{26000, 24000, 24000, 24000} {
		t.Fatalf("next round: deposit %d honba %d points %d", r.deposit, r.honba, r.players[0].points)
	}
	if r.Seed() == NewHanchan(4, Tonpuu).Round().Seed() {
		t.Fatal("the second round reuses the first round's wall")
	}
}

func TestStandings(t *testing.T) {
	h := NewHanchan(4, Tonpuu)
	endRound(h, Result{Kind: "ron", Winner: 0, From: 3}, [4]int{40000, 30000, 20000, 10000})
	h.number = 3 // East 4, dealer seat 3 lost: over
	st := h.Standings()
	want := [4]float64{50, 10, -20, -40} // +10+20+20 oka, 0+10, -10-10, -20-20
	for s, w := range want {
		if st[s].Rank != s+1 || st[s].Score != w {
			t.Fatalf("seat %d: %+v, want rank %d score %v", s, st[s], s+1, w)
		}
	}
	// a tie goes to the seat nearer the first dealer (seat 2 here)
	h = NewHanchan(2, Tonpuu)
	endRound(h, Result{Kind: "ron", Winner: 1, From: 0}, [4]int{20000, 30000, 30000, 20000})
	if st := h.Standings(); st[2].Rank != 1 || st[1].Rank != 2 || st[3].Rank != 3 || st[0].Rank != 4 {
		t.Fatalf("ties: %+v", st)
	}
}

func TestAbortiveDraws(t *testing.T) {
	// 九種九牌: nine different terminals and honors on the first turn
	r := newRound(t)
	setHand(r, 0, "19m19p19s1234z567m", "5z")
	if !r.LegalFor(0).Kyuushu {
		t.Fatal("kyuushu not offered")
	}
	mustApply(t, r, Action{Seat: 0, Type: Kyuushu})
	if res := r.Result(); res.Kind != "abort" || res.Reason != AbortKyuushu || res.Deltas != [4]int{} {
		t.Fatalf("kyuushu: %+v", res)
	}
	r = newRound(t)
	setHand(r, 0, "19m19p19s12z56788m", "5m") // eight kinds
	if r.LegalFor(0).Kyuushu {
		t.Fatal("kyuushu with eight kinds")
	}
	if err := r.Apply(Action{Seat: 0, Type: Kyuushu}); err == nil {
		t.Fatal("kyuushu accepted with eight kinds")
	}

	// 四風連打: the first four discards are the same wind
	r = newRound(t)
	for s := range 4 {
		setHand(r, s, junk[s], "")
	}
	for s := range 4 {
		setHand(r, s, junk[s], "4z")
		r.turn = s
		mustApply(t, r, Action{Seat: s, Type: Discard, Tile: "4z"})
	}
	if res := r.Result(); res == nil || res.Reason != AbortSuufon {
		t.Fatalf("suufon: %+v", res)
	}

	// 四家立直: the fourth accepted riichi aborts; the sticks stay
	r = newRound(t)
	for s := range 4 {
		setHand(r, s, "123m456m789m23p55s", "")
	}
	for s := range 4 {
		setHand(r, s, "123m456m789m23p55s", "9s")
		r.turn = s
		mustApply(t, r, Action{Seat: s, Type: Riichi, Tile: "9s"})
	}
	if res := r.Result(); res == nil || res.Reason != AbortSuucha || res.Deposit != 4*RiichiStick {
		t.Fatalf("suucha: %+v", res)
	}
}

// Whole games with the trivial CPU: every game ends, points plus sticks stay
// at 100000, and replaying the round logs gives the same standings.
func TestHanchanSelfPlay(t *testing.T) {
	for seed := int64(0); seed < 40; seed++ {
		rules := Tonpuu
		if seed%2 == 1 {
			rules = HanchanRule
		}
		h := playHanchan(t, seed, rules)
		again := NewHanchan(seed, rules)
		logs := h.Logs()
		for i, log := range logs {
			for _, a := range log {
				mustApply(t, again.Round(), a)
			}
			if i < len(logs)-1 {
				if err := again.Next(); err != nil {
					t.Fatalf("seed %d: replay next: %v", seed, err)
				}
			}
		}
		if again.Standings() != h.Standings() || !again.Over() {
			t.Fatalf("seed %d: replay differs", seed)
		}
	}
}

func playHanchan(t *testing.T, seed int64, rules Rules) *Hanchan {
	t.Helper()
	h := NewHanchan(seed, rules)
	for rounds := 1; ; rounds++ {
		if rounds > 60 {
			t.Fatalf("seed %d: game does not end", seed)
		}
		r := h.Round()
		playAll(t, r, Tsumogiri{})
		sum := r.deposit
		for _, p := range r.players {
			sum += p.points
		}
		if sum != 4*rules.StartPoints {
			t.Fatalf("seed %d round %d: points + sticks = %d", seed, rounds, sum)
		}
		if h.Over() {
			return h
		}
		if err := h.Next(); err != nil {
			t.Fatal(err)
		}
	}
}
