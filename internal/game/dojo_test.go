package game

import (
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// dojoRound deals seed with seat 0 as dealer under seats.
func dojoRound(seed int64, seats SeatConfig) *Round {
	return NewRound(RoundConfig{
		Wall: wall.New(seed), Dealer: 0, RoundWind: tile.East,
		Points:     [4]int{StartPoints, StartPoints, StartPoints, StartPoints},
		SeatConfig: seats,
	})
}

// A complete hand whose only han are dora cannot win when no yaku is
// allowed: no ron, no tsumo.
func TestDojoDoraAloneCannotWin(t *testing.T) {
	r := dojoRound(1, SeatConfig{Restrict: [4]*yaku.KeySet{yaku.NewKeySet()}})
	d := tile.DoraFromIndicator(r.doraIndicators()[0].Kind)
	pair := tile.Kind(tile.Haku)
	if d == pair {
		pair = tile.Hatsu
	}
	hand := append(tile.MustParseHand("123m456p789s"), tile.Tile{Kind: d}, tile.Tile{Kind: d}, tile.Tile{Kind: d}, tile.Tile{Kind: pair})
	tile.Sort(hand)
	r.players[0].hand = hand
	win := tile.Tile{Kind: pair}
	r.players[0].drawn = &win

	if l := r.LegalFor(0); l.Tsumo {
		t.Fatal("tsumo is legal on dora alone")
	}
	w, ok := yaku.Evaluate(r.players[0].concealed(), r.ctx(0, pair, false))
	if !ok || w.Dora < 3 || !w.HasYaku() {
		t.Fatalf("unrestricted: %+v", w)
	}
	r.players[0].drawn = nil
	r.lastDiscard = win
	if r.canRon(0) {
		t.Fatal("ron on dora alone")
	}
}

// riichiFirst declares riichi whenever it may, else plays tsumogiri.
type riichiFirst struct{}

func (riichiFirst) Decide(v View, l Legal) Action {
	if len(l.Riichi) > 0 && !l.Tsumo {
		return Action{Type: Riichi, Tile: l.Riichi[len(l.Riichi)-1]}
	}
	return Tsumogiri{}.Decide(v, l)
}

// A seat without riichi among its yaku is never offered riichi, from the
// first round on; the other seats are.
func TestDojoRiichiNeedsTheYaku(t *testing.T) {
	seats := SeatConfig{Restrict: [4]*yaku.KeySet{yaku.NewKeySet("tanyao", "pinfu")}}
	others := false
	for seed := range int64(6) {
		h := NewHanchanWith(seed, Tonpuu, 0, seats)
		for rounds := 0; ; rounds++ {
			r := h.Round()
			for steps := 0; r.Actor() >= 0; steps++ {
				if steps > 1000 {
					t.Fatal("round does not end")
				}
				seat := r.Actor()
				l := r.LegalFor(seat)
				if seat == 0 && len(l.Riichi) > 0 {
					t.Fatalf("seed %d round %d: seat 0 offered riichi %v", seed, rounds, l.Riichi)
				}
				others = others || (seat != 0 && len(l.Riichi) > 0)
				a := riichiFirst{}.Decide(r.ViewFor(seat), l)
				a.Seat = seat
				mustApply(t, r, a)
			}
			if h.Over() {
				break
			}
			if err := h.Next(); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !others {
		t.Fatal("no CPU seat was offered riichi")
	}
}

// Without ダブル立直, a riichi on the first go-around scores as 立直.
func TestDojoDoubleRiichiScoresAsRiichi(t *testing.T) {
	r := dojoRound(1, SeatConfig{Restrict: [4]*yaku.KeySet{yaku.NewKeySet("riichi")}})
	for s := range 4 {
		setHand(r, s, junk[s], "")
	}
	setHand(r, 0, "123m456p789s111z2z", "9m")
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9m"})
	if !r.players[0].riichi || !r.players[0].doubleRiichi {
		t.Fatal("not a double riichi")
	}
	setHand(r, 1, junk[1], "2z")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "2z"})
	mustApply(t, r, Action{Seat: 0, Type: Ron})
	w := r.Result().Win
	if len(w.Yaku) != 1 || w.Yaku[0].Key != "riichi" || w.Yaku[0].Han != 1 || w.HanTotal != 1+w.Dora+w.UraDora {
		t.Fatalf("got %+v", w)
	}
	if !slices.ContainsFunc(w.Excluded, func(y yaku.Yaku) bool { return y.Key == "double_riichi" }) {
		t.Fatalf("excluded %+v", w.Excluded)
	}
}

// toSeat0Turn plays tsumogiri until seat 0 is to discard after its first
// go-around.
func toSeat0Turn(t *testing.T, r *Round) {
	t.Helper()
	for steps := 0; r.Actor() != 0 || r.phase != PhaseDiscard || r.firstGoAround(0); steps++ {
		if steps > 100 || r.Actor() < 0 {
			t.Fatal("seat 0 never gets a second turn")
		}
		seat := r.Actor()
		l := r.LegalFor(seat)
		if seat != 0 && l.Redraw {
			t.Fatalf("seat %d (CPU) offered redraw", seat)
		}
		a := Action{Seat: seat, Type: Skip}
		if r.phase == PhaseDiscard {
			a = Action{Seat: seat, Type: Discard, Tile: r.players[seat].drawn.String()}
		}
		mustApply(t, r, a)
	}
}

// inPlay counts the tiles held, discarded and called.
func inPlay(r *Round) map[tile.Tile]int {
	n := map[tile.Tile]int{}
	for _, p := range r.players {
		for _, t := range p.concealed() {
			n[t]++
		}
		for _, rt := range p.river {
			if !rt.Called {
				n[rt.Tile]++
			}
		}
		for _, m := range p.melds {
			for _, t := range m.Tiles {
				n[t]++
			}
		}
	}
	return n
}

// dealt counts the tiles dealt and drawn from r's current wall.
func dealt(r *Round) map[tile.Tile]int {
	n := map[tile.Tile]int{}
	for s := range 4 {
		for _, t := range r.wall.HandOf(s) {
			n[t]++
		}
	}
	for k := range r.draws {
		t, _ := r.wall.Draw4(k)
		n[t]++
	}
	return n
}

func TestDojoRedraw(t *testing.T) {
	r := dojoRound(3, SeatConfig{RedrawsPerRound: [4]int{1}})
	if r.LegalFor(0).Redraw || !errors.Is(r.Apply(Action{Seat: 0, Type: Redraw}), ErrConflict) {
		t.Fatal("redraw on the first go-around")
	}
	toSeat0Turn(t, r)
	if !r.LegalFor(0).Redraw {
		t.Fatal("redraw not offered")
	}
	p := &r.players[0]
	old, hand, left, draws := *p.drawn, len(p.hand), r.DrawsLeft(), r.draws
	next, _ := r.wall.Draw4(r.draws)
	last := wall.LiveDraws4 - r.kans - 1
	logged, events := len(r.log), len(r.events)
	mustApply(t, r, Action{Seat: 0, Type: Redraw, Tile: "ignored"})

	if *p.drawn != next || len(p.hand) != hand || r.DrawsLeft() != left || r.draws != draws {
		t.Fatalf("drawn %s (want %s), hand %d, draws left %d", p.drawn, next, len(p.hand), r.DrawsLeft())
	}
	if end, _ := r.wall.Draw4(last); end != old {
		t.Fatalf("the redrawn tile is not at the end of the live wall: %s", end)
	}
	if _, err := wall.FromTiles(r.Seed(), r.wall.Tiles()); err != nil {
		t.Fatal(err)
	}
	if got, want := inPlay(r), dealt(r); !mapsEqual(got, want) {
		t.Fatalf("tiles in play %v, dealt %v", got, want)
	}
	want := []Action{{Seat: 0, Type: Redraw}}
	if r.Redraws(0) != 1 || !reflect.DeepEqual(r.log[logged:], want) || !reflect.DeepEqual(r.events[events:], want) {
		t.Fatalf("log %v, events %v", r.log[logged:], r.events[events:])
	}
	if r.LegalFor(0).Redraw || !errors.Is(r.Apply(Action{Seat: 0, Type: Redraw}), ErrConflict) {
		t.Fatal("a second redraw in the round")
	}
	// The redrawn round replays from its log.
	again := dojoRound(3, SeatConfig{RedrawsPerRound: [4]int{1}})
	for _, a := range r.Log() {
		mustApply(t, again, a)
	}
	if again.wall.Tiles() != r.wall.Tiles() || *again.players[0].drawn != *p.drawn {
		t.Fatal("replay differs")
	}
}

func TestDojoRedrawConditions(t *testing.T) {
	for _, tc := range []struct {
		name string
		set  func(r *Round)
	}{
		{"riichi", func(r *Round) { r.players[0].riichi = true }},
		{"rinshan", func(r *Round) { r.players[0].rinshan = true }},
		{"no draw left", func(r *Round) { r.draws = wall.LiveDraws4 }},
		{"no redraws", func(r *Round) { r.seats.RedrawsPerRound[0] = 0 }},
	} {
		r := dojoRound(3, SeatConfig{RedrawsPerRound: [4]int{1}})
		toSeat0Turn(t, r)
		tc.set(r)
		if r.LegalFor(0).Redraw || !errors.Is(r.Apply(Action{Seat: 0, Type: Redraw}), ErrConflict) {
			t.Errorf("%s: redraw allowed", tc.name)
		}
	}
}

func mapsEqual(a, b map[tile.Tile]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// After a kan the live wall ends one draw earlier: the redrawn tile becomes
// that end (the haitei tile), and the tile past it stays where it was.
func TestDojoRedrawAfterKan(t *testing.T) {
	r := dojoRound(3, SeatConfig{RedrawsPerRound: [4]int{1}})
	toSeat0Turn(t, r)
	r.kans = 1 // as after a kan: the live wall is one draw shorter
	old, left := *r.players[0].drawn, r.DrawsLeft()
	past, _ := r.wall.Draw4(wall.LiveDraws4 - 1)
	mustApply(t, r, Action{Seat: 0, Type: Redraw})
	haitei, _ := r.wall.Draw4(wall.LiveDraws4 - r.kans - 1)
	if haitei != old {
		t.Fatalf("haitei %s, want the redrawn %s", haitei, old)
	}
	if p, _ := r.wall.Draw4(wall.LiveDraws4 - 1); p != past {
		t.Fatalf("the tile past the live wall moved: %s, was %s", p, past)
	}
	if r.DrawsLeft() != left {
		t.Fatalf("draws left %d, was %d", r.DrawsLeft(), left)
	}
	// Played out, the last live draw is the redrawn tile.
	for r.DrawsLeft() > 0 && r.Actor() >= 0 {
		seat := r.Actor()
		a := Action{Seat: seat, Type: Skip}
		if r.phase == PhaseDiscard {
			a = Action{Seat: seat, Type: Discard, Tile: r.players[seat].drawn.String()}
		}
		mustApply(t, r, a)
	}
	if r.DrawsLeft() != 0 || r.players[r.turn].drawn == nil || *r.players[r.turn].drawn != old {
		t.Fatalf("haitei drawn %v, want %s (draws left %d)", r.players[r.turn].drawn, old, r.DrawsLeft())
	}
}

// liveKind returns the first kind in the live wall after the next draw
// that differs from the drawn tile's, and its position.
func liveKind(t *testing.T, r *Round) (string, int) {
	t.Helper()
	for k := r.draws; k < wall.LiveDraws4-r.kans; k++ {
		if w, _ := r.wall.Draw4(k); w.Kind != r.players[r.turn].drawn.Kind {
			return w.Kind.String(), k
		}
	}
	t.Fatal("the live wall holds only the drawn kind")
	return "", 0
}

func TestDojoSummon(t *testing.T) {
	seats := SeatConfig{SummonsPerRound: [4]int{1}}
	r := dojoRound(3, seats)
	if r.LegalFor(0).Summon != nil || !errors.Is(r.Apply(Action{Seat: 0, Type: Summon, Tile: "1m"}), ErrConflict) {
		t.Fatal("summon on the first go-around")
	}
	toSeat0Turn(t, r)
	kind, at := liveKind(t, r)
	if l := r.LegalFor(0); !slices.Contains(l.Summon, kind) || l.Redraw {
		t.Fatalf("legal %+v, want a summon of %s and no redraw", l, kind)
	}
	// The summon takes the first tile of the kind from the next draw on.
	first := at
	for k := r.draws; k < at; k++ {
		if w, _ := r.wall.Draw4(k); w.Kind.String() == kind {
			first = k
			break
		}
	}
	p := &r.players[0]
	old, hand, left, draws := *p.drawn, len(p.hand), r.DrawsLeft(), r.draws
	want, _ := r.wall.Draw4(first)
	logged, events := len(r.log), len(r.events)
	mustApply(t, r, Action{Seat: 0, Type: Summon, Tile: kind})

	if *p.drawn != want || len(p.hand) != hand || r.DrawsLeft() != left || r.draws != draws {
		t.Fatalf("drawn %s (want %s), hand %d, draws left %d", p.drawn, want, len(p.hand), r.DrawsLeft())
	}
	if w, _ := r.wall.Draw4(first); w != old {
		t.Fatalf("the drawn tile did not take the summoned one's place: %s", w)
	}
	if _, err := wall.FromTiles(r.Seed(), r.wall.Tiles()); err != nil {
		t.Fatal(err)
	}
	if got, want := inPlay(r), dealt(r); !mapsEqual(got, want) {
		t.Fatalf("tiles in play %v, dealt %v", got, want)
	}
	if r.Summons(0) != 1 || !reflect.DeepEqual(r.log[logged:], []Action{{Seat: 0, Type: Summon, Tile: kind}}) ||
		!reflect.DeepEqual(r.events[events:], []Action{{Seat: 0, Type: Summon}}) {
		t.Fatalf("log %v, events %v", r.log[logged:], r.events[events:])
	}
	if r.LegalFor(0).Summon != nil || !errors.Is(r.Apply(Action{Seat: 0, Type: Summon, Tile: kind}), ErrConflict) {
		t.Fatal("a second summon in the round")
	}
	// The summoned round replays from its log.
	again := dojoRound(3, seats)
	for _, a := range r.Log() {
		mustApply(t, again, a)
	}
	if again.wall.Tiles() != r.wall.Tiles() || *again.players[0].drawn != *p.drawn {
		t.Fatal("replay differs")
	}
}

func TestDojoSummonConditions(t *testing.T) {
	for _, tc := range []struct {
		name string
		set  func(r *Round)
	}{
		{"riichi", func(r *Round) { r.players[0].riichi = true }},
		{"rinshan", func(r *Round) { r.players[0].rinshan = true }},
		{"no draw left", func(r *Round) { r.draws = wall.LiveDraws4 }},
		{"no summons", func(r *Round) { r.seats.SummonsPerRound[0] = 0 }},
	} {
		r := dojoRound(3, SeatConfig{SummonsPerRound: [4]int{1}})
		toSeat0Turn(t, r)
		kind, _ := liveKind(t, r)
		tc.set(r)
		if r.LegalFor(0).Summon != nil || !errors.Is(r.Apply(Action{Seat: 0, Type: Summon, Tile: kind}), ErrConflict) {
			t.Errorf("%s: summon allowed", tc.name)
		}
	}
	// A kind no longer in the live wall cannot be summoned.
	r := dojoRound(3, SeatConfig{SummonsPerRound: [4]int{1}})
	toSeat0Turn(t, r)
	gone := tile.Kind(0)
	for ; gone < tile.NumKinds && slices.Contains(r.LegalFor(0).Summon, gone.String()); gone++ {
	}
	if gone == tile.NumKinds {
		// Every kind is left: take one kind out of reach of the live wall.
		r.kans, r.draws = 0, wall.LiveDraws4-1
		w, _ := r.wall.Draw4(r.draws)
		for gone = 0; gone == w.Kind; gone++ {
		}
	}
	if slices.Contains(r.LegalFor(0).Summon, gone.String()) || !errors.Is(r.Apply(Action{Seat: 0, Type: Summon, Tile: gone.String()}), ErrConflict) {
		t.Errorf("summoned %s, not in the live wall", gone)
	}
	if !errors.Is(r.Apply(Action{Seat: 0, Type: Summon, Tile: "x"}), ErrConflict) {
		t.Error("summoned a malformed kind")
	}
}

// NextDraws foretells seat 0's draws when nobody calls or makes a kan.
func TestNextDraws(t *testing.T) {
	for seed := range int64(4) {
		r := dojoRound(seed, SeatConfig{})
		var want, got []tile.Tile
		from := -1 // the next draw when foretold
		for steps := 0; r.Actor() >= 0; steps++ {
			if steps == 9 {
				want, from = r.NextDraws(0, 100), r.draws
			}
			seat := r.Actor()
			a := Action{Seat: seat, Type: Skip}
			if r.phase == PhaseDiscard {
				if from >= 0 && seat == 0 && r.draws > from {
					got = append(got, *r.players[0].drawn)
				}
				a = Action{Seat: seat, Type: Discard, Tile: r.players[seat].drawn.String()}
			}
			mustApply(t, r, a)
		}
		if len(got) == 0 || !slices.Equal(got, want[:len(got)]) || (r.Result().Kind == "draw" && len(got) != len(want)) {
			t.Fatalf("seed %d: drew %v, foretold %v", seed, got, want)
		}
		if n := r.NextDraws(0, 3); len(n) != 0 {
			t.Fatalf("seed %d: next draws %v after the round", seed, n)
		}
	}
	r := dojoRound(1, SeatConfig{})
	if n := r.NextDraws(0, 3); len(n) != 3 {
		t.Fatalf("next draws %v, want 3", n)
	}
}
