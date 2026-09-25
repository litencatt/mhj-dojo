package game

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
)

// called is a meld of three (or four, kan) tiles of kind s called from seat
// from (-1: an ankan).
func called(s string, from int, kan bool) Called {
	k := tile.MustParseHand(s)[0].Kind
	n := 3
	if kan {
		n = 4
	}
	var ts []tile.Tile
	for range n {
		ts = append(ts, tile.MustParseHand(s)[0])
	}
	return Called{Meld: yaku.Meld{Type: yaku.Trip, Kind: k, Open: from >= 0, Kan: kan}, Tiles: ts, From: from}
}

// passTurn has seat draw s (in place of its wall draw) and discard it.
func passTurn(t *testing.T, r *Round, seat int, s string) {
	t.Helper()
	d, _ := tile.Parse(s)
	r.players[seat].drawn = &d
	mustApply(t, r, Action{Seat: seat, Type: Discard, Tile: s})
}

// checkSettlement checks the hand payments, the pao, that the deltas add up
// to the points and that the points are conserved.
func checkSettlement(t *testing.T, r *Round, hand [4]int, pao []Pao) {
	t.Helper()
	res := r.Result()
	if res == nil {
		t.Fatalf("round not ended: phase %s actor %d", r.Phase(), r.Actor())
	}
	if res.HandDeltas != hand {
		t.Errorf("hand deltas %v, want %v", res.HandDeltas, hand)
	}
	if !slices.Equal(res.Pao, pao) {
		t.Errorf("pao %v, want %v", res.Pao, pao)
	}
	if totalPoints(r) != 4*StartPoints {
		t.Errorf("points not conserved: %d", totalPoints(r))
	}
	checkDeltas(t, r, res)
}

// daisangen0 has seat 1 (holding pons of 5z and 6z) pon seat 0's 7z, the
// third dragon, and discard 9s: seat 0 is responsible, and seat 1 waits on
// tanki of the last tile of rest (4p unless given).
func daisangen0(t *testing.T, rest string) *Round {
	t.Helper()
	r := newRound(t)
	r.players[1].melds = []Called{called("5z", 2, false), called("6z", 3, false)}
	setHand(r, 1, "7z7z9s"+rest, "")
	setHand(r, 0, junk[0], "7z")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "7z"})
	mustApply(t, r, Action{Seat: 1, Type: Pon})
	if want := []Pao{{Seat: 0, Yaku: "daisangen"}}; !slices.Equal(r.players[1].pao, want) {
		t.Fatalf("pao after the third dragon %v", r.players[1].pao)
	}
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "9s"})
	return r
}

func TestPaoDaisangenTsumo(t *testing.T) {
	r := daisangen0(t, "123m4p")
	r.honba = 2
	passTurn(t, r, 2, "1s")
	passTurn(t, r, 3, "9m")
	passTurn(t, r, 0, "9m")
	setHand(r, 1, "123m4p", "4p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	// the responsible seat pays the whole 32000 and all the honba
	checkSettlement(t, r, [4]int{-32000, 32000, 0, 0}, []Pao{{Seat: 0, Yaku: "daisangen"}})
	if res := r.Result(); res.HonbaDeltas != [4]int{-600, 600, 0, 0} {
		t.Errorf("honba deltas %v", res.HonbaDeltas)
	}
}

func TestPaoDaisangenRonByAnotherSeat(t *testing.T) {
	r := daisangen0(t, "123m4p")
	r.honba = 1
	passTurn(t, r, 2, "4p")
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	// the discarder and the responsible seat split 32000; honba from the discarder
	checkSettlement(t, r, [4]int{-16000, 32000, -16000, 0}, []Pao{{Seat: 0, Yaku: "daisangen"}})
	if res := r.Result(); res.HonbaDeltas != [4]int{0, 300, -300, 0} {
		t.Errorf("honba deltas %v", res.HonbaDeltas)
	}
}

func TestPaoDaisangenRonByResponsibleSeat(t *testing.T) {
	r := daisangen0(t, "123m4p")
	passTurn(t, r, 2, "1s")
	passTurn(t, r, 3, "9m")
	passTurn(t, r, 0, "4p")
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	checkSettlement(t, r, [4]int{-32000, 32000, 0, 0}, []Pao{{Seat: 0, Yaku: "daisangen"}})
}

// 大三元 under pao plus 字一色 paid as usual.
func TestPaoStackedYakuman(t *testing.T) {
	r := daisangen0(t, "1z1z1z2z")
	r.honba = 1
	passTurn(t, r, 2, "1s")
	passTurn(t, r, 3, "9m")
	passTurn(t, r, 0, "9m")
	setHand(r, 1, "1z1z1z2z", "2z")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	if res := r.Result(); res.Points.Multiplier != 2 {
		t.Fatalf("points %+v yaku %v", res.Points, res.Win.Yaku)
	}
	// 32000 from seat 0 for 大三元; 字一色 as a tsumo: 16000 from the dealer, 8000 each
	checkSettlement(t, r, [4]int{-48000, 64000, -8000, -8000}, []Pao{{Seat: 0, Yaku: "daisangen"}})
	if res := r.Result(); res.HonbaDeltas != [4]int{-100, 300, -100, -100} {
		t.Errorf("honba deltas %v, want the usual split", res.HonbaDeltas)
	}

	r = daisangen0(t, "1z1z1z2z")
	passTurn(t, r, 2, "2z")
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	// 字一色 32000 and half of 大三元 from the discarder, the other half from seat 0
	checkSettlement(t, r, [4]int{-16000, 64000, -48000, 0}, []Pao{{Seat: 0, Yaku: "daisangen"}})
}

// 大四喜 is a double yakuman, all of it under pao.
func TestPaoDaisuushii(t *testing.T) {
	r := newRound(t)
	r.players[1].melds = []Called{called("1z", 2, false), called("2z", 3, false), called("3z", 2, false)}
	setHand(r, 1, "4z4z4p9s", "")
	setHand(r, 0, junk[0], "4z")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "4z"})
	mustApply(t, r, Action{Seat: 1, Type: Pon})
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "9s"})
	passTurn(t, r, 2, "4p")
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	if res := r.Result(); res.Points.Multiplier != 2 || res.Points.Ron != 64000 {
		t.Fatalf("points %+v", res.Points)
	}
	checkSettlement(t, r, [4]int{-32000, 64000, -32000, 0}, []Pao{{Seat: 0, Yaku: "daisuushii"}})
}

// suukantsu3 gives seat 1 three open kans (1m 2m 3m) and 4p plus hand in
// its concealed tiles.
func suukantsu3(t *testing.T, hand string) *Round {
	t.Helper()
	r := newRound(t)
	r.players[1].melds = []Called{called("1m", 2, true), called("2m", 3, true), called("3m", 2, true)}
	setHand(r, 1, "4p"+hand, "")
	return r
}

// The fourth kan called from a discard: the discarder is responsible.
func TestPaoSuukantsuDaiminkan(t *testing.T) {
	r := suukantsu3(t, "5p5p5p")
	setHand(r, 0, junk[0], "5p")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5p"})
	mustApply(t, r, Action{Seat: 1, Type: Kan})
	setHand(r, 1, "4p", "4p") // the replacement tile
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	checkSettlement(t, r, [4]int{-32000, 32000, 0, 0}, []Pao{{Seat: 0, Yaku: "suukantsu"}})
}

// The fourth kan added to a pon: no pao, even though the pon was called.
func TestPaoSuukantsuKakan(t *testing.T) {
	r := suukantsu3(t, "5p5p9s")
	setHand(r, 0, junk[0], "5p")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5p"})
	mustApply(t, r, Action{Seat: 1, Type: Pon})
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "9s"})
	passTurn(t, r, 2, "1s")
	passTurn(t, r, 3, "9m")
	passTurn(t, r, 0, "9m")
	setHand(r, 1, "4p", "5p")
	mustApply(t, r, Action{Seat: 1, Type: Kan, Tile: "5p"})
	setHand(r, 1, "4p", "4p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	checkSettlement(t, r, [4]int{-16000, 32000, -8000, -8000}, nil)
}

// A concealed kan never makes a seat responsible: the fourth kan, or the
// third dragon.
func TestPaoAnkan(t *testing.T) {
	r := suukantsu3(t, "5p5p5p")
	passTurn(t, r, 0, "9m")
	setHand(r, 1, "4p5p5p5p", "5p")
	mustApply(t, r, Action{Seat: 1, Type: Kan, Tile: "5p"})
	setHand(r, 1, "4p", "4p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	checkSettlement(t, r, [4]int{-16000, 32000, -8000, -8000}, nil)

	r = newRound(t)
	r.players[1].melds = []Called{called("5z", 2, false), called("6z", 3, false)}
	passTurn(t, r, 0, "9m")
	setHand(r, 1, "7z7z7z123m4p", "7z")
	mustApply(t, r, Action{Seat: 1, Type: Kan, Tile: "7z"})
	setHand(r, 1, "123m4p", "4p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	checkSettlement(t, r, [4]int{-16000, 32000, -8000, -8000}, nil)
}

// 大三元 and 四槓子 with different responsible seats: each pays its own
// yakuman.
func TestPaoTwoSeats(t *testing.T) {
	setup := func() *Round {
		r := newRound(t)
		r.players[1].melds = []Called{called("5z", 3, true), called("6z", 3, true)}
		setHand(r, 1, "7z7z7z1s1s1s4p", "")
		setHand(r, 0, junk[0], "7z")
		mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "7z"})
		mustApply(t, r, Action{Seat: 1, Type: Kan}) // the third dragon: seat 0
		passTurn(t, r, 1, "9m")
		passTurn(t, r, 2, "1s")
		mustApply(t, r, Action{Seat: 1, Type: Kan}) // the fourth kan: seat 2
		return r
	}
	want := []Pao{{Seat: 0, Yaku: "daisangen"}, {Seat: 2, Yaku: "suukantsu"}}

	r := setup()
	r.honba = 1
	setHand(r, 1, "4p", "4p")
	mustApply(t, r, Action{Seat: 1, Type: Tsumo})
	checkSettlement(t, r, [4]int{-32000, 64000, -32000, 0}, want)
	if res := r.Result(); res.HonbaDeltas != [4]int{-100, 300, -100, -100} {
		t.Errorf("honba deltas %v, want the usual split", res.HonbaDeltas)
	}

	r = setup()
	passTurn(t, r, 1, "9s")
	passTurn(t, r, 2, "9p")
	passTurn(t, r, 3, "4p")
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	checkSettlement(t, r, [4]int{-16000, 64000, -16000, -32000}, want)
}

// Chii and a pon that does not complete a yakuman make nobody responsible.
func TestNoPaoOnOtherCalls(t *testing.T) {
	r := newRound(t)
	setHand(r, 1, "5z5z6z6z147p258s3m", "")
	setHand(r, 0, junk[0], "5z")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 1, Type: Pon})
	if len(r.players[1].pao) != 0 {
		t.Fatalf("pao %v after the first dragon", r.players[1].pao)
	}
}
