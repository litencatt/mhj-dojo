package game

import (
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
	"github.com/litencatt/mhj2/internal/yaku"
)

// setHand replaces seat's 13 concealed tiles (and drawn tile, if given).
func setHand(r *Round, seat int, hand, drawn string) {
	p := &r.players[seat]
	p.hand = tile.MustParseHand(hand)
	tile.Sort(p.hand)
	p.drawn = nil
	if drawn != "" {
		d, _ := tile.Parse(drawn)
		p.drawn = &d
	}
}

// Junk hands that are far from tenpai.
var junk = [4]string{
	"147m258p369s1357z",
	"147p258s369m2467z",
	"147s258m369p1235z",
	"159m159p26s12345z",
}

// newRound deals from seed 1 with seat 0 as dealer and gives every seat a
// junk hand; seat 0 has drawn 9s.
func newRound(t *testing.T) *Round {
	t.Helper()
	r := NewWithWall(wall.New(1), 0)
	for s := range 4 {
		setHand(r, s, junk[s], "")
	}
	setHand(r, 0, junk[0], "9s")
	return r
}

func mustApply(t *testing.T, r *Round, a Action) {
	t.Helper()
	if err := r.Apply(a); err != nil {
		t.Fatalf("Apply(%+v): %v", a, err)
	}
}

func totalPoints(r *Round) int {
	n := r.deposit
	for _, p := range r.players {
		n += p.points
	}
	return n
}

// playAll plays every seat with d until the round ends.
func playAll(t *testing.T, r *Round, d Decider) {
	t.Helper()
	for steps := 0; r.Actor() >= 0; steps++ {
		if steps > 1000 {
			t.Fatal("round does not end")
		}
		seat := r.Actor()
		a := d.Decide(r.ViewFor(seat), r.LegalFor(seat))
		a.Seat = seat
		mustApply(t, r, a)
		checkInvariants(t, r)
	}
}

func checkInvariants(t *testing.T, r *Round) {
	t.Helper()
	if n := totalPoints(r); n != 4*StartPoints {
		t.Fatalf("points + deposit = %d, want %d", n, 4*StartPoints)
	}
	tiles := 0
	for _, p := range r.players {
		tiles += len(p.hand) + len(p.river)
		if p.drawn != nil {
			tiles++
		}
	}
	if tiles != 4*wall.HandSize+r.draws {
		t.Fatalf("tiles in hands and rivers = %d, want %d", tiles, 4*wall.HandSize+r.draws)
	}
}

func TestSelfPlay(t *testing.T) {
	n := 1000
	if testing.Short() {
		n = 100
	}
	kinds := map[string]int{}
	for seed := int64(0); seed < int64(n); seed++ {
		r := New(seed)
		playAll(t, r, Tsumogiri{})
		kinds[r.Result().Kind]++
		// Replaying the log from the seed reproduces the round exactly.
		again := New(seed)
		for _, a := range r.Log() {
			mustApply(t, again, a)
		}
		if !reflect.DeepEqual(again.ViewFor(0), r.ViewFor(0)) {
			t.Fatalf("seed %d: replay differs", seed)
		}
	}
	if !testing.Short() && (kinds["draw"] == 0 || kinds["tsumo"]+kinds["ron"] == 0) {
		t.Errorf("self-play outcomes look wrong: %v", kinds)
	}
}

func TestDealerAndWinds(t *testing.T) {
	r := New(6) // 6 mod 4 = 2
	if r.Dealer() != 2 || r.Actor() != 2 || r.SeatWind(2) != tile.East || r.SeatWind(1) != tile.North {
		t.Fatalf("dealer %d actor %d winds %v %v", r.Dealer(), r.Actor(), r.SeatWind(2), r.SeatWind(1))
	}
	if New(-3).Dealer() != 1 {
		t.Fatal("negative seed dealer")
	}
}

func TestWrongSeatAndBadTile(t *testing.T) {
	r := newRound(t)
	if err := r.Apply(Action{Seat: 1, Type: Discard, Tile: "1m"}); !errors.Is(err, ErrConflict) {
		t.Errorf("wrong seat: %v", err)
	}
	if err := r.Apply(Action{Seat: 0, Type: Discard, Tile: "9p"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("tile not in hand: %v", err)
	}
	if err := r.Apply(Action{Seat: 0, Type: Ron}); !errors.Is(err, ErrConflict) {
		t.Errorf("ron in discard phase: %v", err)
	}
	if err := r.Apply(Action{Seat: 0, Type: Tsumo}); !errors.Is(err, ErrConflict) {
		t.Errorf("tsumo without a win: %v", err)
	}
	if len(r.Log()) != 0 {
		t.Error("failed actions were logged")
	}
}

// tenpai0 gives seat 0 a 1p/4p two-sided wait with ittsu (and drawn 9s).
func tenpai0(t *testing.T) *Round {
	r := newRound(t)
	setHand(r, 0, "123m456m789m23p55s", "9s")
	return r
}

func TestDoubleRiichiIppatsuRon(t *testing.T) {
	r := tenpai0(t)
	l := r.LegalFor(0)
	if !slices.Contains(l.Riichi, "9s") || slices.Contains(l.Riichi, "1m") {
		t.Fatalf("riichi discards = %v", l.Riichi)
	}
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	if !r.players[0].riichi || r.players[0].points != StartPoints-RiichiStick || r.deposit != RiichiStick {
		t.Fatal("riichi not accepted after the discard passed")
	}
	// seat 1 draws and discards 1p: seat 0 may ron
	setHand(r, 1, junk[1], "1p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	if r.Phase() != PhaseCall || r.Actor() != 0 || !r.LegalFor(0).Ron {
		t.Fatalf("phase %s actor %d", r.Phase(), r.Actor())
	}
	mustApply(t, r, Action{Seat: 0, Type: Ron})
	res := r.Result()
	keys := map[string]bool{}
	for _, y := range res.Win.Yaku {
		keys[y.Key] = true
	}
	if res.Kind != "ron" || res.Winner != 0 || res.From != 1 || !keys["double_riichi"] || !keys["ippatsu"] || keys["riichi"] {
		t.Fatalf("result %+v yaku %v", res, keys)
	}
	if res.Deltas[1] != -res.Points.Ron || res.Deltas[0] != res.Points.Ron+RiichiStick || totalPoints(r) != 4*StartPoints {
		t.Fatalf("deltas %v points %+v", res.Deltas, res.Points)
	}
}

func TestRiichiRestrictions(t *testing.T) {
	r := tenpai0(t)
	r.players[0].points = 900
	if len(r.LegalFor(0).Riichi) != 0 {
		t.Error("riichi allowed under 1000 points")
	}
	r = tenpai0(t)
	r.draws = wall.LiveDraws4 - 3
	if len(r.LegalFor(0).Riichi) != 0 {
		t.Error("riichi allowed with 3 draws left")
	}
	r = tenpai0(t)
	if err := r.Apply(Action{Seat: 0, Type: Riichi, Tile: "1m"}); !errors.Is(err, ErrConflict) {
		t.Errorf("riichi breaking tenpai: %v", err)
	}
	// after riichi only the drawn tile goes, even when the hand has a copy
	r = tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	for s := 1; s < 4; s++ {
		mustApply(t, r, Action{Seat: s, Type: Discard, Tile: r.LegalFor(s).Discards[0]})
	}
	setHand(r, 0, "123m456m789m23p55s", "5s")
	if err := r.Apply(Action{Seat: 0, Type: Discard, Tile: "1m"}); !errors.Is(err, ErrConflict) {
		t.Errorf("discarding from the hand in riichi: %v", err)
	}
	if l := r.LegalFor(0); !slices.Equal(l.Discards, []string{"5s"}) || len(l.Riichi) != 0 {
		t.Errorf("legal in riichi = %+v", l)
	}
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5s"})
	if !slices.Equal(tile.Strings(r.players[0].hand), tile.Strings(tile.MustParseHand("123m456m789m23p55s"))) {
		t.Errorf("hand changed: %v", r.players[0].hand)
	}
}

func TestFuriten(t *testing.T) {
	// own discard: seat 0 waits on 1p/4p and has discarded 4p
	r := tenpai0(t)
	setHand(r, 0, "123m456m789m23p55s", "4p")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "4p"})
	setHand(r, 1, junk[1], "1p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	if r.Phase() == PhaseCall {
		t.Fatal("ron offered while furiten on an own discard")
	}

	// riichi furiten: passing a winning tile after riichi lasts the round
	r = tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	setHand(r, 1, junk[1], "1p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	mustApply(t, r, Action{Seat: 0, Type: Skip})
	setHand(r, 2, junk[2], "4p")
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "4p"})
	if r.Phase() == PhaseCall {
		t.Fatal("ron offered after passing in riichi")
	}
	mustApply(t, r, Action{Seat: 3, Type: Discard, Tile: r.LegalFor(3).Discards[0]})
	setHand(r, 0, "123m456m789m23p55s", "1p")
	if !r.LegalFor(0).Tsumo {
		t.Fatal("furiten must still allow tsumo")
	}

	// same go-around furiten ends at the seat's next draw
	r = tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "9s"})
	setHand(r, 1, junk[1], "1p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	mustApply(t, r, Action{Seat: 0, Type: Skip})
	setHand(r, 2, junk[2], "4p")
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "4p"})
	if r.Phase() == PhaseCall {
		t.Fatal("ron offered in the same go-around after passing")
	}
	mustApply(t, r, Action{Seat: 3, Type: Discard, Tile: r.LegalFor(3).Discards[0]})
	if r.players[0].tempFuriten {
		t.Fatal("same go-around furiten survived the next draw")
	}
}

func TestNoYakuNoRon(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, junk[0], "1s")
	// seat 2 (not the next to draw, which would clear the furiten)
	setHand(r, 2, "123m567m345p789s1s", "") // tanki on 1s: no yaku on a ron
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "1s"})
	if r.Phase() == PhaseCall {
		t.Fatal("ron offered without yaku")
	}
	if !r.players[2].tempFuriten {
		t.Fatal("passing a winning tile (even without yaku) must be furiten")
	}
}

func TestHeadBump(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, junk[0], "5z")
	// seats 2 and 3 both wait on 5z (tanki, with ittsu); seat 1 cannot ron
	setHand(r, 2, "123m456m789m234p5z", "")
	setHand(r, 3, "123p456p789p234s5z", "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	if !slices.Equal(r.callers, []int{2, 3}) {
		t.Fatalf("callers = %v, want [2 3]", r.callers)
	}
	if err := r.Apply(Action{Seat: 3, Type: Ron}); !errors.Is(err, ErrConflict) {
		t.Fatalf("seat 3 ron before seat 2 decided: %v", err)
	}
	mustApply(t, r, Action{Seat: 2, Type: Ron})
	if res := r.Result(); res.Winner != 2 || res.From != 0 {
		t.Fatalf("result %+v", res)
	}
}

func TestExhaustiveDraw(t *testing.T) {
	cases := []struct {
		tenpai []int
		deltas [4]int
	}{
		{nil, [4]int{}},
		{[]int{1}, [4]int{-1000, 3000, -1000, -1000}},
		{[]int{1, 2}, [4]int{-1500, 1500, 1500, -1500}},
		{[]int{1, 2, 3}, [4]int{-3000, 1000, 1000, 1000}},
	}
	for _, tc := range cases {
		r := newRound(t)
		for _, s := range tc.tenpai {
			setHand(r, s, "123m456m789m23p55s", "")
		}
		r.draws = wall.LiveDraws4
		mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "9s"})
		res := r.Result()
		if res == nil || res.Kind != "draw" || res.Deltas != tc.deltas {
			t.Fatalf("tenpai %v: result %+v", tc.tenpai, res)
		}
	}
}

func TestHaiteiHoutei(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, "123m567m345p789s9s", "9s")
	r.draws = wall.LiveDraws4
	if !r.LegalFor(0).Tsumo {
		t.Fatal("haitei tsumo not offered")
	}
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	if !hasYaku(r.Result(), "haitei") {
		t.Fatalf("result %+v", r.Result().Win)
	}

	r = newRound(t)
	setHand(r, 1, "123m567m345p789s9s", "")
	r.draws = wall.LiveDraws4
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "9s"})
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	if !hasYaku(r.Result(), "houtei") {
		t.Fatalf("result %+v", r.Result().Win)
	}
}

func hasYaku(res *Result, key string) bool {
	return res != nil && res.Win != nil && slices.ContainsFunc(res.Win.Yaku, func(y yaku.Yaku) bool { return y.Key == key })
}

func TestViewHidesOtherHands(t *testing.T) {
	r := New(3)
	v := r.ViewFor(0)
	for s := 1; s < 4; s++ {
		if v.Seats[s].Hand != nil || v.Seats[s].Drawn != nil || v.UraIndicators != nil {
			t.Fatalf("seat %d hand visible before the end", s)
		}
	}
	playAll(t, r, Tsumogiri{})
	v = r.ViewFor(0)
	for s := range 4 {
		if v.Seats[s].Hand == nil {
			t.Fatalf("seat %d hand hidden after the end", s)
		}
	}
	if v.UraIndicators == nil {
		t.Fatal("ura dora hidden after the end")
	}
}
