package game

import (
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/litencatt/mhj2/internal/testmode"
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
		tiles += len(p.hand) + len(p.meldTiles())
		for _, rt := range p.river {
			if !rt.Called { // a called tile is counted in the meld
				tiles++
			}
		}
		if p.drawn != nil {
			tiles++
		}
	}
	// the deal, the live draws and one replacement tile per kan
	if want := 4*wall.HandSize + r.draws + r.kans; tiles != want {
		t.Fatalf("tiles in hands, melds and rivers = %d, want %d", tiles, want)
	}
}

func TestSelfPlay(t *testing.T) {
	var seeds []int64
	for seed := range testmode.N(int64(1000), 200, 100) {
		seeds = append(seeds, seed)
	}
	if !testmode.Full() && !testing.Short() {
		seeds = append(seeds, 961) // the only win below seed 1000
	}
	kinds := map[string]int{}
	for _, seed := range seeds {
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
	// seat 0 paid its stick and got it back: the delta is the ron alone
	if res.Deltas[1] != -res.Points.Ron || res.Deltas[0] != res.Points.Ron || totalPoints(r) != 4*StartPoints {
		t.Fatalf("deltas %v points %+v", res.Deltas, res.Points)
	}
	checkDeltas(t, r, res)
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
	if r.Phase() == PhaseCall { // seat 0 may chii seat 3's discard: decline
		mustApply(t, r, Action{Seat: 0, Type: Skip})
	}
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
	var seats []int
	for _, c := range r.claims {
		seats = append(seats, c.seat)
	}
	if !slices.Equal(seats, []int{2, 3}) {
		t.Fatalf("claims from %v, want [2 3]", seats)
	}
	if err := r.Apply(Action{Seat: 3, Type: Ron}); !errors.Is(err, ErrConflict) {
		t.Fatalf("seat 3 ron before seat 2 decided: %v", err)
	}
	mustApply(t, r, Action{Seat: 2, Type: Ron})
	if res := r.Result(); res.Winner != 2 || res.From != 0 {
		t.Fatalf("result %+v", res)
	}
}

// checkDeltas verifies that Deltas equal each seat's change from StartPoints.
func checkDeltas(t *testing.T, r *Round, res *Result) {
	t.Helper()
	for s, p := range r.players {
		if got := p.points - StartPoints; got != res.Deltas[s] {
			t.Fatalf("seat %d: delta %d, points changed by %d", s, res.Deltas[s], got)
		}
	}
}

// A riichi stick paid by a seat that does not win shows in its delta.
func TestRiichiStickInDeltas(t *testing.T) {
	// seat 0 in riichi, then seat 2 rons seat 1
	r := tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	setHand(r, 2, "123m456m789m234p5z", "")
	setHand(r, 1, junk[1], "5z")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Ron})
	res := r.Result()
	if res.Deltas[0] != -RiichiStick || res.Deltas[2] != res.Points.Ron+RiichiStick {
		t.Fatalf("deltas %v", res.Deltas)
	}
	checkDeltas(t, r, res)

	// seat 0 in riichi, exhaustive draw with seat 0 the only tenpai: +3000 - 1000
	r = tenpai0(t)
	r.draws = wall.LiveDraws4 - minDrawsForRiichi
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	for r.Actor() >= 0 {
		seat := r.Actor()
		mustApply(t, r, Action{Seat: seat, Type: Discard, Tile: r.LegalFor(seat).Discards[0]})
	}
	res = r.Result()
	if res.Kind != "draw" || res.Deltas[0] != notenPenalty-RiichiStick || res.Deposit != RiichiStick {
		t.Fatalf("draw result %+v", res)
	}
	checkDeltas(t, r, res)
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

// newConfigRound deals seed 1 with junk hands from a round config: dealer 0,
// honba 2, two carried riichi sticks and uneven points.
func newConfigRound(t *testing.T) *Round {
	t.Helper()
	r := NewRound(RoundConfig{
		Wall: wall.New(1), Dealer: 0, RoundWind: tile.South, Honba: 2, Deposit: 2 * RiichiStick,
		Points: [4]int{30000, 20000, 24000, 24000},
	})
	for s := range 4 {
		setHand(r, s, junk[s], "")
	}
	setHand(r, 0, junk[0], "5z")
	return r
}

func TestHonbaAndCarriedSticks(t *testing.T) {
	// ron: the discarder pays 300 per honba; the winner takes the carried sticks
	r := newConfigRound(t)
	setHand(r, 2, "123m456m789m234p5z", "") // 5z tanki, ittsu
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Ron})
	res := r.Result()
	if res.Honba != 2 || res.HonbaDeltas != [4]int{-600, 0, 600, 0} || res.StickDeltas != [4]int{0, 0, 2000, 0} || res.Deposit != 0 {
		t.Fatalf("ron: %+v", res)
	}
	for s, p := range r.players {
		if p.points != r.start[s]+res.Deltas[s] || res.Deltas[s] != res.HandDeltas[s]+res.HonbaDeltas[s]+res.StickDeltas[s] {
			t.Fatalf("seat %d points %d deltas %v", s, p.points, res.Deltas)
		}
	}
	if r.Winds(2) != (yaku.Winds{Round: tile.South, Seat: tile.West}) {
		t.Fatalf("winds %v", r.Winds(2))
	}

	// tsumo: 100 per honba from each other seat
	r = newConfigRound(t)
	setHand(r, 0, "123m456m789m234p5z", "5z")
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	if res := r.Result(); res.HonbaDeltas != [4]int{600, -200, -200, -200} || res.StickDeltas[0] != 2000 {
		t.Fatalf("tsumo: %+v", res)
	}

	// draw: no honba payment; the carried sticks stay on the table
	r = newConfigRound(t)
	r.draws = wall.LiveDraws4
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	if res := r.Result(); res.Kind != "draw" || res.HonbaDeltas != [4]int{} || res.Deposit != 2000 {
		t.Fatalf("draw: %+v", res)
	}
	if n := r.deposit + r.players[0].points + r.players[1].points + r.players[2].points + r.players[3].points; n != 100000 {
		t.Fatalf("points + deposit = %d", n)
	}
}

// Each kan reveals a dora indicator and takes a draw off the live wall.
func TestKansMoveHaiteiAndDora(t *testing.T) {
	r := newRound(t)
	left := r.DrawsLeft()
	r.kans = 2
	if r.DrawsLeft() != left-2 || len(r.ViewFor(0).DoraIndicators) != 3 {
		t.Fatalf("draws left %d, dora %d", r.DrawsLeft(), len(r.ViewFor(0).DoraIndicators))
	}
}
