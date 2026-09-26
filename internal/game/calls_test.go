package game

import (
	"errors"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// claimSeats lists the seats with a claim, in order.
func claimSeats(r *Round) []int {
	var out []int
	for _, c := range r.claims {
		out = append(out, c.seat)
	}
	return out
}

func TestPon(t *testing.T) {
	r := newRound(t)
	setHand(r, 2, "5z5z5z147m258p369s1z", "") // pon two of three 5z; the third may not go
	setHand(r, 0, junk[0], "5z")
	r.players[3].ippatsu = true
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	if r.Phase() != PhaseCall || !slices.Equal(claimSeats(r), []int{2}) || !r.LegalFor(2).Pon {
		t.Fatalf("phase %s claims %v legal %+v", r.Phase(), claimSeats(r), r.LegalFor(2))
	}
	mustApply(t, r, Action{Seat: 2, Type: Pon})
	p := &r.players[2]
	if r.Actor() != 2 || p.drawn != nil || len(p.melds) != 1 || !p.melds[0].Meld.Open || p.melds[0].From != 0 {
		t.Fatalf("after pon: actor %d melds %+v", r.Actor(), p.melds)
	}
	if !r.players[0].river[0].Called || r.players[3].ippatsu {
		t.Fatal("the called tile is not marked, or ippatsu survived the call")
	}
	if l := r.LegalFor(2); slices.Contains(l.Discards, "5z") || len(l.Riichi) != 0 || len(l.Discards) == 0 {
		t.Fatalf("kuikae: legal %+v", l)
	}
	if err := r.Apply(Action{Seat: 2, Type: Discard, Tile: "5z"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("kuikae discard: %v", err)
	}
	ev := r.Events()[len(r.Events())-1]
	if ev.Type != Pon || ev.Seat != 2 || ev.Tile != "5z" {
		t.Fatalf("event %+v", ev)
	}
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "1m"})
	if r.Actor() != 3 { // the turn goes on from the caller: seat 1 is skipped
		t.Fatalf("actor %d after the caller's discard", r.Actor())
	}
	checkInvariants(t, r)
}

func TestChiiAndKuikae(t *testing.T) {
	r := newRound(t)
	setHand(r, 1, "34m6m147p258s1357z", "") // chii 5m with 34m or 46m
	setHand(r, 0, junk[0], "5m")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5m"})
	l := r.LegalFor(1)
	if len(l.Chii) != 2 || l.Pon {
		t.Fatalf("chii options %v", l.Chii)
	}
	if err := r.Apply(Action{Seat: 1, Type: Chii, Tiles: []string{"3m", "6m"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("chii with 3m6m: %v", err)
	}
	mustApply(t, r, Action{Seat: 1, Type: Chii, Tiles: []string{"3m", "4m"}})
	p := &r.players[1]
	if len(p.melds) != 1 || p.melds[0].Meld != (yaku.Meld{Type: yaku.Seq, Kind: tile.MakeKind(tile.Man, 3), Open: true}) {
		t.Fatalf("meld %+v", p.melds)
	}
	// 345m called on 5m: 5m and the suji 2m may not go now
	if slices.Contains(p.kuikae, tile.MakeKind(tile.Man, 5)) != true || !slices.Contains(p.kuikae, tile.MakeKind(tile.Man, 2)) {
		t.Fatalf("kuikae %v", p.kuikae)
	}
	checkInvariants(t, r)
}

func TestChiiOnlyFromTheLeft(t *testing.T) {
	r := newRound(t)
	setHand(r, 2, "34m147p258s13567z", "")
	setHand(r, 0, junk[0], "5m")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5m"})
	if r.Phase() == PhaseCall {
		t.Fatalf("seat 2 offered a chii from seat 0: %v", claimSeats(r))
	}
}

// A pon by a later seat beats a chii by the next seat; declining a call is
// not furiten.
func TestPonBeatsChii(t *testing.T) {
	r := newRound(t)
	setHand(r, 1, "34m147p258s13567z", "")
	setHand(r, 3, "5m5m147p258s12367z", "")
	setHand(r, 0, junk[0], "5m")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5m"})
	mustApply(t, r, Action{Seat: 1, Type: Chii, Tiles: []string{"3m", "4m"}})
	if r.Actor() != 3 {
		t.Fatalf("actor %d, want seat 3 to answer", r.Actor())
	}
	mustApply(t, r, Action{Seat: 3, Type: Pon})
	if len(r.players[1].melds) != 0 || len(r.players[3].melds) != 1 || r.Actor() != 3 {
		t.Fatal("chii won over pon")
	}
	if r.players[1].tempFuriten {
		t.Fatal("declining a call made the seat furiten")
	}
	for _, e := range r.Events() {
		if e.Type == Chii {
			t.Fatal("the losing chii shows as an event")
		}
	}
}

// A ron beats every call and ends the call phase at once.
func TestRonBeatsPon(t *testing.T) {
	r := newRound(t)
	setHand(r, 2, "123m456m789m234p5z", "")  // ron on 5z
	setHand(r, 3, "5z5z147m258p369s12z", "") // pon 5z
	setHand(r, 0, junk[0], "5z")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Ron})
	if res := r.Result(); res == nil || res.Winner != 2 {
		t.Fatalf("result %+v", res)
	}
}

func TestLastDiscardCannotBeCalled(t *testing.T) {
	r := newRound(t)
	setHand(r, 2, "5z5z147m258p369s13z", "")
	setHand(r, 0, junk[0], "5z")
	r.draws = wall.LiveDraws4
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	if r.Result() == nil || r.Result().Kind != "draw" {
		t.Fatalf("phase %s", r.Phase())
	}
}

func TestOpenKanAndRinshan(t *testing.T) {
	r := newRound(t)
	setHand(r, 2, "5z5z5z147m258p369s1z", "")
	setHand(r, 0, junk[0], "5z")
	left := r.DrawsLeft()
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	if l := r.LegalFor(2); !slices.Equal(l.Kan, []string{"5z"}) || !l.Pon {
		t.Fatalf("legal %+v", l)
	}
	mustApply(t, r, Action{Seat: 2, Type: Kan})
	p := &r.players[2]
	rin, _ := r.wall.Rinshan(0)
	if r.kans != 1 || p.drawn == nil || *p.drawn != rin || !p.rinshan || !p.melds[0].Meld.Kan || p.melds[0].Added || len(p.melds[0].Tiles) != 4 {
		t.Fatalf("after kan: kans %d drawn %v melds %+v", r.kans, p.drawn, p.melds)
	}
	// the kan dora waits for the discard after the kan to pass
	if r.DrawsLeft() != left-1 || len(r.ViewFor(0).DoraIndicators) != 1 {
		t.Fatalf("draws left %d dora %d", r.DrawsLeft(), len(r.ViewFor(0).DoraIndicators))
	}
	passSafe(t, r, 2)
	if len(r.ViewFor(0).DoraIndicators) != 2 {
		t.Fatalf("dora %d after the discard", len(r.ViewFor(0).DoraIndicators))
	}
	checkInvariants(t, r)
}

func TestConcealedKanAndRinshanKaihou(t *testing.T) {
	r := newRound(t)
	rin, _ := r.wall.Rinshan(0)
	// 1111m + 234m 567m 89p + a pair of the rinshan tile's kind after the kan
	hand := "111m234m567m789p" + rin.String()
	setHand(r, 0, hand, "1m")
	if l := r.LegalFor(0); !slices.Contains(l.Kan, "1m") {
		t.Fatalf("legal kans %v", l.Kan)
	}
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "1m"})
	p := &r.players[0]
	if len(p.melds) != 1 || p.melds[0].Meld.Open || p.melds[0].From != -1 || p.drawn == nil {
		t.Fatalf("ankan: %+v", p.melds)
	}
	checkInvariants(t, r)
	if w, ok := r.tsumoWin(0); ok {
		if !slices.ContainsFunc(w.Yaku, func(y yaku.Yaku) bool { return y.Key == "rinshan" }) {
			t.Fatalf("tsumo on the rinshan tile without rinshan kaihou: %+v", w.Yaku)
		}
	}
}

func TestAddedKanCanBeRobbed(t *testing.T) {
	r := newRound(t)
	setPon(r, 0, 2, "5p", "234m567m678s1z", "5p")
	setHand(r, 2, "123m456m789m46p11z", "") // waits on 5p
	if l := r.LegalFor(0); !slices.Contains(l.Kan, "5p") {
		t.Fatalf("legal kans %v", l.Kan)
	}
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "5p"})
	if r.Phase() != PhaseCall || !r.LegalFor(2).Ron || r.LegalFor(2).Pon {
		t.Fatalf("chankan not offered: %s %+v", r.Phase(), r.LegalFor(2))
	}
	// the added tile is visible while it waits to be robbed
	if v := r.ViewFor(1); !v.Robbing || v.Visible()[tile.MakeKind(tile.Pin, 5)] != 4 {
		t.Fatalf("robbing %v visible 5p %d", v.Robbing, v.Visible()[tile.MakeKind(tile.Pin, 5)])
	}
	mustApply(t, r, Action{Seat: 2, Type: Ron})
	res := r.Result()
	if res == nil || res.Winner != 2 || !hasYaku(res, "chankan") {
		t.Fatalf("result %+v", res)
	}

	// declined: the kan completes with a replacement draw
	r = newRound(t)
	setPon(r, 0, 2, "5p", "234m567m678s1z", "5p")
	setHand(r, 2, "123m456m789m46p11z", "")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "5p"})
	mustApply(t, r, Action{Seat: 2, Type: Skip})
	p := &r.players[0]
	if r.Actor() != 0 || !p.melds[0].Meld.Kan || !p.melds[0].Added || len(p.melds[0].Tiles) != 4 || !p.rinshan || !r.players[2].tempFuriten {
		t.Fatalf("after the kan: actor %d melds %+v", r.Actor(), p.melds)
	}
	if called := p.melds[0].Tiles[3]; called != (tile.Tile{Kind: tile.MakeKind(tile.Pin, 5)}) || p.melds[0].From != 2 {
		t.Fatalf("the called tile is not last: %+v", p.melds[0])
	}
	checkInvariants(t, r)
}

func TestRiichiKanKeepsWaits(t *testing.T) {
	r := tenpai0(t) // 123m 456m 789m 23p 55s, waits 1p/4p
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	for s := 1; s < 4; s++ {
		mustApply(t, r, Action{Seat: s, Type: Discard, Tile: r.LegalFor(s).Discards[0]})
		if r.Phase() == PhaseCall {
			mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
		}
	}
	// 5s pair + drawn 5s: a kan of 5s would break the wait
	setHand(r, 0, "123m456m789m23p55s", "5s")
	if l := r.LegalFor(0); len(l.Kan) != 0 {
		t.Fatalf("riichi kan that changes the wait: %v", l.Kan)
	}
	// 111m + drawn 1m: the waits stay 1p/4p
	setHand(r, 0, "111m456m789m23p55s", "1m")
	if l := r.LegalFor(0); !slices.Equal(l.Kan, []string{"1m"}) {
		t.Fatalf("riichi kan keeping the waits: %v", l.Kan)
	}
}

func TestCallsEndFirstGoAround(t *testing.T) {
	r := newRound(t)
	setHand(r, 2, "5z5z147m258p369s13z", "")
	setHand(r, 0, junk[0], "5z")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Pon})
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "1m"})
	// seat 3 has not discarded, but the pon ended the uninterrupted go-around
	setHand(r, 3, "19m19p19s1234z567m", "6z")
	if r.firstGoAround(3) || r.LegalFor(3).Kyuushu {
		t.Fatal("kyuushu offered after a call")
	}
}

// greedy calls whenever it can, to exercise calls in self-play.
type greedy struct{}

func (greedy) Decide(v View, l Legal) Action {
	switch {
	case l.Tsumo:
		return Action{Type: Tsumo}
	case l.Ron:
		return Action{Type: Ron}
	case len(l.Kan) > 0:
		return Action{Type: Kan, Tile: l.Kan[0]}
	case l.Pon:
		return Action{Type: Pon}
	case len(l.Chii) > 0:
		return Action{Type: Chii, Tiles: l.Chii[0]}
	case l.Skip:
		return Action{Type: Skip}
	}
	return Tsumogiri{}.Decide(v, l)
}

func TestSelfPlayWithCalls(t *testing.T) {
	n := testmode.N(500, 150, 50)
	var calls, kans, aborts int
	for seed := int64(0); seed < int64(n); seed++ {
		r := New(seed)
		playAll(t, r, greedy{})
		for _, e := range r.Events() {
			switch e.Type {
			case Pon, Chii:
				calls++
			case Kan:
				kans++
			}
		}
		if r.Result().Kind == "abort" {
			aborts++
		}
		again := New(seed)
		for _, a := range r.Log() {
			mustApply(t, again, a)
		}
		if again.Result().Kind != r.Result().Kind || again.Result().Deltas != r.Result().Deltas {
			t.Fatalf("seed %d: replay differs", seed)
		}
	}
	if calls == 0 || kans == 0 {
		t.Fatalf("self-play made %d calls and %d kans", calls, kans)
	}
	t.Logf("%d calls, %d kans, %d abortive draws", calls, kans, aborts)
}
