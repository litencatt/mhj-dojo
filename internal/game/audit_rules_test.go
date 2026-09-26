package game

import (
	"errors"
	"slices"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

// Rules audit: scenario tests for the round flow against standard riichi
// rules and docs/api.md. A failing test is a bug or a doc deviation; the
// passing ones pin down behaviour, including house-rule choices (noted).
// Fixtures use the seed-1 wall of newRound: rinshan tiles 9p 6z 5p 4z, dora
// indicators 4p 9m 7s 3z 1m.

// yakuKeys lists the yaku keys of a finished round.
func yakuKeys(res *Result) []string {
	var out []string
	if res != nil && res.Win != nil {
		for _, y := range res.Win.Yaku {
			out = append(out, y.Key)
		}
	}
	return out
}

// passSafe has seat discard its first legal tile and has every claim on it
// declined.
func passSafe(t *testing.T, r *Round, seat int) {
	t.Helper()
	mustApply(t, r, Action{Seat: seat, Type: Discard, Tile: r.LegalFor(seat).Discards[0]})
	for r.Phase() == PhaseCall {
		mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
	}
}

// Ippatsu: a tsumo on the riichi seat's next draw scores it; its own
// tsumogiri ends it for later rons.
func TestAuditIppatsuTsumoThenEndsOnOwnDiscard(t *testing.T) {
	r := tenpai0(t) // 123m456m789m23p55s, waits 1p/4p
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	for s := 1; s < 4; s++ {
		passSafe(t, r, s)
	}
	if r.Actor() != 0 || r.Phase() != PhaseDiscard || !r.players[0].ippatsu {
		t.Fatalf("actor %d phase %s ippatsu %v", r.Actor(), r.Phase(), r.players[0].ippatsu)
	}
	setHand(r, 0, "123m456m789m23p55s", "1p")
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	if res := r.Result(); !hasYaku(res, "ippatsu") || !hasYaku(res, "double_riichi") || !hasYaku(res, "tsumo") {
		t.Fatalf("ippatsu tsumo yaku %v", yakuKeys(res))
	}

	r = tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	for s := 1; s < 4; s++ {
		passSafe(t, r, s)
	}
	setHand(r, 0, "123m456m789m23p55s", "9p")
	passSafe(t, r, 0) // tsumogiri 9p
	if r.players[0].ippatsu {
		t.Fatal("ippatsu survived the riichi seat's own discard")
	}
	setHand(r, 1, junk[1], "1p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	mustApply(t, r, Action{Seat: 0, Type: Ron})
	if res := r.Result(); hasYaku(res, "ippatsu") || !hasYaku(res, "double_riichi") {
		t.Fatalf("ron after the tsumogiri: %v", yakuKeys(res))
	}
}

// A concealed kan by another seat breaks the go-around: ippatsu is gone.
func TestAuditAnkanByAnotherSeatEndsIppatsu(t *testing.T) {
	r := tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	setHand(r, 1, "6666z147p258s36m2z", "4z")
	if !slices.Contains(r.LegalFor(1).Kan, "6z") {
		t.Fatalf("legal kans %v", r.LegalFor(1).Kan)
	}
	mustApply(t, r, Action{Seat: 1, Type: Kan, Tile: "6z"})
	if r.players[0].ippatsu {
		t.Fatal("ippatsu survived another seat's concealed kan")
	}
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	if r.Phase() != PhaseCall || !r.LegalFor(0).Ron {
		t.Fatalf("no ron: phase %s legal %+v", r.Phase(), r.LegalFor(0))
	}
	mustApply(t, r, Action{Seat: 0, Type: Ron})
	if res := r.Result(); hasYaku(res, "ippatsu") || !hasYaku(res, "double_riichi") {
		t.Fatalf("yaku %v", yakuKeys(res))
	}
}

// A riichi discard that is called stands: the stick is paid, the riichi (here
// a double riichi) holds, and the call ends its ippatsu.
func TestAuditCalledRiichiDiscardStands(t *testing.T) {
	r := tenpai0(t)
	setHand(r, 2, "9s9s147m258p36s123z", "")
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	if r.Phase() != PhaseCall || !r.LegalFor(2).Pon {
		t.Fatalf("phase %s legal %+v", r.Phase(), r.LegalFor(2))
	}
	mustApply(t, r, Action{Seat: 2, Type: Pon})
	p := &r.players[0]
	if !p.riichi || !p.doubleRiichi || p.ippatsu || p.points != StartPoints-RiichiStick || r.deposit != RiichiStick {
		t.Fatalf("riichi %v double %v ippatsu %v points %d deposit %d", p.riichi, p.doubleRiichi, p.ippatsu, p.points, r.deposit)
	}
	if rt := p.river[0]; !rt.Riichi || !rt.Called {
		t.Fatalf("river %+v", rt)
	}
	checkInvariants(t, r)
}

// A ron on the riichi discard: the riichi is not established, no stick is
// paid and the tile is not marked as the declaration.
func TestAuditRonOnRiichiDiscardTakesNoStick(t *testing.T) {
	r := tenpai0(t)
	setHand(r, 1, "123m456p789s78s33z", "") // 9s: pinfu + iipeikou
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	if r.Phase() != PhaseCall || !r.LegalFor(1).Ron {
		t.Fatalf("phase %s legal %+v", r.Phase(), r.LegalFor(1))
	}
	mustApply(t, r, Action{Seat: 1, Type: Ron})
	res := r.Result()
	if r.players[0].riichi || r.deposit != 0 || res.StickDeltas != [4]int{} || res.Deltas[0] != -res.Points.Ron {
		t.Fatalf("riichi %v deposit %d sticks %v deltas %v", r.players[0].riichi, r.deposit, res.StickDeltas, res.Deltas)
	}
	if rt := r.players[0].river; len(rt) != 1 || rt[0].Riichi {
		t.Fatalf("river %+v", rt)
	}
	checkDeltas(t, r, res)
}

// Robbing an added kan keeps ippatsu (the kan never completes), is not
// houtei, and the robbed kan reveals no dora.
func TestAuditChankanKeepsIppatsu(t *testing.T) {
	r := tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	setPon(r, 1, 3, "4p", "4p147m258s36m2z", "5z")
	if !slices.Contains(r.LegalFor(1).Kan, "4p") {
		t.Fatalf("legal kans %v", r.LegalFor(1).Kan)
	}
	mustApply(t, r, Action{Seat: 1, Type: Kan, Tile: "4p"})
	if r.Phase() != PhaseCall || !r.LegalFor(0).Ron {
		t.Fatalf("chankan not offered: %s %+v", r.Phase(), r.LegalFor(0))
	}
	mustApply(t, r, Action{Seat: 0, Type: Ron})
	res := r.Result()
	if res.From != 1 || !hasYaku(res, "chankan") || !hasYaku(res, "ippatsu") || !hasYaku(res, "double_riichi") || hasYaku(res, "houtei") {
		t.Fatalf("from %d yaku %v", res.From, yakuKeys(res))
	}
	if r.kans != 0 || len(r.doraIndicators()) != 1 {
		t.Fatalf("a robbed kan counted: kans %d", r.kans)
	}
}

// A kan on the last live tile: the replacement draw is rinshan (not haitei),
// the kan dora shows at once, the discard after it is the last one (houtei
// on a ron) and it cannot be called.
func TestAuditKanOnTheLastLiveTile(t *testing.T) {
	r := newRound(t)
	r.draws = wall.LiveDraws4 - 1
	setHand(r, 0, "111m234m567m789p9p", "1m") // the first rinshan tile is 9p
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "1m"})
	if r.DrawsLeft() != 0 || len(r.doraIndicators()) != 2 || !r.LegalFor(0).Tsumo {
		t.Fatalf("draws left %d dora %d legal %+v", r.DrawsLeft(), len(r.doraIndicators()), r.LegalFor(0))
	}
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	if res := r.Result(); !hasYaku(res, "rinshan") || hasYaku(res, "haitei") || !hasYaku(res, "tsumo") {
		t.Fatalf("yaku %v", yakuKeys(res))
	}

	r = newRound(t)
	r.draws = wall.LiveDraws4 - 1
	setHand(r, 0, "111m234m567m789p9p", "1m")
	setHand(r, 2, "2m2m147p258s36s123z", "") // could pon 2m
	setHand(r, 3, "34m456p789s777z22s", "")  // waits 2m/5m with 中
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "1m"})
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "2m"})
	if r.Phase() != PhaseCall || !slices.Equal(claimSeats(r), []int{3}) || r.LegalFor(3).Pon {
		t.Fatalf("claims on the last discard: %v (phase %s)", claimSeats(r), r.Phase())
	}
	mustApply(t, r, Action{Seat: 3, Type: Ron})
	if res := r.Result(); !hasYaku(res, "houtei") || !hasYaku(res, "chun") {
		t.Fatalf("yaku %v", yakuKeys(res))
	}
}

// After an open kan the kan dora is turned over when the declarer discards
// (後めくり, as Tenhou and M-League): the rinshan tile does not count it, a
// ron on that discard (槓振り) does, with its ura. The second indicator of
// this wall is 9m, so 1m becomes dora.
func TestAuditDaiminkanDoraCountsForTheDiscardRon(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, "147m258p369s1236z", "5z")
	setHand(r, 2, "5z5z5z147m258p369s2z", "")
	setHand(r, 3, "1m456m789p444z234s", "") // tanki 1m with 北 (seat wind): two 1m after the win
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Kan})
	if ind := r.doraIndicators(); len(ind) != 1 {
		t.Fatalf("indicators %v before the discard", ind)
	}
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "1m"})
	if r.Phase() != PhaseCall || !r.LegalFor(3).Ron || len(r.ViewFor(3).DoraIndicators) != 2 {
		t.Fatalf("phase %s claims %v indicators %v", r.Phase(), claimSeats(r), r.doraIndicators())
	}
	mustApply(t, r, Action{Seat: 3, Type: Ron})
	res := r.Result()
	ind := r.doraIndicators()
	if res.Win.Dora != 2 || !hasYaku(res, "pei") || len(ind) != 2 || ind[1].String() != "9m" || len(r.uraIndicators()) != 2 {
		t.Fatalf("dora %d with indicators %v ura %v: %v", res.Win.Dora, ind, r.uraIndicators(), yakuKeys(res))
	}

	// the same discard passes: the indicator stays, and the next ron counts it
	r = newRound(t)
	setHand(r, 0, "147m258p369s1236z", "5z")
	setHand(r, 2, "5z5z5z147m258p369s2z", "")
	setHand(r, 3, "1m456m789p444z234s", "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5z"})
	mustApply(t, r, Action{Seat: 2, Type: Kan})
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "2z"})
	ind = r.doraIndicators()
	if len(ind) != 2 || ind[1].String() != "9m" || r.Actor() != 3 {
		t.Fatalf("indicators %v actor %d", ind, r.Actor())
	}
	setHand(r, 3, "1m456m789p444z234s", "1z")
	mustApply(t, r, Action{Seat: 3, Type: Discard, Tile: "1z"})
	for r.Phase() == PhaseCall {
		mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
	}
	setHand(r, 0, "147m258p369s1236z", "1m")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "1m"})
	mustApply(t, r, Action{Seat: 3, Type: Ron})
	if res := r.Result(); res.Win.Dora != 2 || len(r.uraIndicators()) != 2 {
		t.Fatalf("dora %d ura %v: %v", res.Win.Dora, r.uraIndicators(), yakuKeys(res))
	}
}

// 四開槓: a fourth kan by a second seat aborts the round once the discard
// after it passes; four kans by one seat do not (四槓子 tenpai).
func TestAuditSuukaikan(t *testing.T) {
	r := newRound(t)
	r.players[1].melds = []Called{called("2s", -1, true), called("3s", -1, true), called("4s", -1, true)}
	setHand(r, 1, "5s8s1z9p", "")
	setHand(r, 2, "159m159p678s1234z", "")
	setHand(r, 3, "159m159p678s1235z", "")
	r.kans, r.kanDora, r.kanSeats = 3, 3, []int{1, 1, 1}
	setHand(r, 0, "7777z147m258p136z", "2z")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	if r.kans != 4 || len(r.doraIndicators()) != 5 || r.Result() != nil {
		t.Fatalf("after the fourth kan: kans %d result %+v", r.kans, r.Result())
	}
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "2z"})
	if res := r.Result(); res == nil || res.Kind != "abort" || res.Reason != AbortKans {
		t.Fatalf("result %+v", res)
	}

	r = newRound(t)
	r.players[0].melds = []Called{called("2s", -1, true), called("3s", -1, true), called("4s", -1, true)}
	setHand(r, 0, "7777z", "2z")
	setHand(r, 1, "159m159p678s1234z", "")
	setHand(r, 2, "159m159p678s1235z", "")
	setHand(r, 3, "159m159p678s1236z", "")
	r.kans, r.kanSeats = 3, []int{0, 0, 0}
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "2z"})
	if r.Result() != nil || r.Actor() != 1 {
		t.Fatalf("four kans by one seat: result %+v actor %d", r.Result(), r.Actor())
	}
	if r.canKan() {
		t.Fatal("a fifth kan allowed")
	}
}

// The uninterrupted first go-around: a concealed kan by an earlier seat ends
// it (no kyuushu, no double riichi); an earlier riichi does not.
func TestAuditFirstGoAroundAfterAnkanAndRiichi(t *testing.T) {
	r := newRound(t)
	setHand(r, 1, junk[2], "")
	setHand(r, 0, "7777z147m258p369s", "1z")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "1z"})
	setHand(r, 1, "19m19p19s1234z567m", "5z")
	if r.LegalFor(1).Kyuushu {
		t.Fatal("kyuushu offered after a concealed kan")
	}
	setHand(r, 1, "123m456m789m23p55s", "9s")
	mustApply(t, r, Action{Seat: 1, Type: Riichi, Tile: "9s"})
	for r.Phase() == PhaseCall {
		mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
	}
	if p := r.players[1]; !p.riichi || p.doubleRiichi {
		t.Fatalf("riichi %v double %v after a concealed kan", p.riichi, p.doubleRiichi)
	}

	r = tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	setHand(r, 1, "19m19p19s1234z567m", "5z")
	if !r.LegalFor(1).Kyuushu {
		t.Fatal("kyuushu not offered after an earlier riichi")
	}
	setHand(r, 1, "123m456m789m23p55s", "9s")
	mustApply(t, r, Action{Seat: 1, Type: Riichi, Tile: "9s"})
	for r.Phase() == PhaseCall {
		mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
	}
	if p := r.players[1]; !p.riichi || !p.doubleRiichi {
		t.Fatalf("riichi %v double %v after an earlier riichi", p.riichi, p.doubleRiichi)
	}
}

// Same go-around furiten ends when the seat calls: after declining a ron it
// pons, discards, and may ron again before its next draw.
func TestAuditTempFuritenEndsWithACall(t *testing.T) {
	r := tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "9s"})
	setHand(r, 1, junk[1], "1p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1p"})
	mustApply(t, r, Action{Seat: 0, Type: Skip})
	if !r.players[0].tempFuriten {
		t.Fatal("declining a ron did not make the seat furiten")
	}
	setHand(r, 2, junk[2], "5s")
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "5s"})
	if r.Actor() != 0 || !r.LegalFor(0).Pon {
		t.Fatalf("actor %d legal %+v", r.Actor(), r.LegalFor(0))
	}
	mustApply(t, r, Action{Seat: 0, Type: Pon})
	if r.players[0].tempFuriten {
		t.Fatal("same go-around furiten survived the seat's own call")
	}
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "3p"}) // 123m456m789m 2p + 555s: tanki 2p, open ittsu
	setHand(r, 1, junk[1], "2p")
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "2p"})
	if r.Phase() != PhaseCall || r.Actor() != 0 || !r.LegalFor(0).Ron {
		t.Fatalf("phase %s actor %d legal %+v", r.Phase(), r.Actor(), r.LegalFor(0))
	}
}

// A riichi seat that declines to rob a kan is furiten for the round.
func TestAuditDeclinedChankanIsRiichiFuriten(t *testing.T) {
	r := tenpai0(t)
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9s"})
	setPon(r, 1, 3, "4p", "4p147m258s36m2z", "5z")
	mustApply(t, r, Action{Seat: 1, Type: Kan, Tile: "4p"})
	mustApply(t, r, Action{Seat: 0, Type: Skip})
	if !r.players[0].riichiFuriten || r.Actor() != 1 || !r.players[1].melds[0].Added {
		t.Fatalf("furiten %v actor %d melds %+v", r.players[0].riichiFuriten, r.Actor(), r.players[1].melds)
	}
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "2z"})
	setHand(r, 2, junk[2], "1p")
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "1p"})
	if r.Phase() == PhaseCall {
		t.Fatalf("claims %v after declining a chankan in riichi", claimSeats(r))
	}
}

// A concealed kan cannot be robbed, not even by a kokushi hand waiting on
// that tile: house rule (docs/api.md lets only an added kan be robbed; many
// rule sets allow 国士無双 to rob an ankan).
func TestAuditNoChankanOnAnkan(t *testing.T) {
	r := newRound(t)
	setHand(r, 1, junk[2], "")
	setHand(r, 2, "119m19p19s123456z", "") // kokushi waiting on 7z
	setHand(r, 0, "7777z147m258p369s", "2z")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "7z"})
	if r.Phase() != PhaseDiscard || r.Actor() != 0 {
		t.Fatalf("phase %s actor %d", r.Phase(), r.Actor())
	}
}

// After a concealed kan the hand is still closed: riichi is allowed.
func TestAuditRiichiAfterAnkan(t *testing.T) {
	r := newRound(t)
	setHand(r, 0, "8888p234m567m78s2s", "2s")
	mustApply(t, r, Action{Seat: 0, Type: Kan, Tile: "8p"})
	// the rinshan tile is 9p: discarding it leaves 234m 567m 78s 22s + the kan
	if l := r.LegalFor(0); !slices.Contains(l.Riichi, "9p") {
		t.Fatalf("riichi after an ankan: %+v", l)
	}
	mustApply(t, r, Action{Seat: 0, Type: Riichi, Tile: "9p"})
	for r.Phase() == PhaseCall {
		mustApply(t, r, Action{Seat: r.Actor(), Type: Skip})
	}
	if !r.players[0].riichi {
		t.Fatal("riichi not accepted after an ankan")
	}
}

// Right after a pon or chii (no drawn tile) no kan may be declared, even
// holding the fourth tile of the pon or four of a kind.
func TestAuditNoKanRightAfterACall(t *testing.T) {
	r := newRound(t)
	setPon(r, 0, 2, "8p", "234m567m34s66s8p", "")
	if l := r.LegalFor(0); len(l.Kan) != 0 {
		t.Fatalf("added kan offered without a draw: %v", l.Kan)
	}
	setPon(r, 0, 2, "8p", "234m567m6666s", "")
	if l := r.LegalFor(0); len(l.Kan) != 0 {
		t.Fatalf("concealed kan offered without a draw: %v", l.Kan)
	}
}

// A discard that another seat called still makes the discarder furiten.
func TestAuditFuritenOnCalledOwnDiscard(t *testing.T) {
	r := tenpai0(t)
	setHand(r, 0, "123m456m789m23p55s", "4p")
	setHand(r, 1, "4p4p147m258s369m12z", "")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "4p"})
	mustApply(t, r, Action{Seat: 1, Type: Pon})
	mustApply(t, r, Action{Seat: 1, Type: Discard, Tile: "1m"})
	setHand(r, 2, junk[2], "1p")
	mustApply(t, r, Action{Seat: 2, Type: Discard, Tile: "1p"})
	if r.Phase() == PhaseCall {
		t.Fatalf("claims %v: the called 4p should keep seat 0 furiten", claimSeats(r))
	}
}

// An open hand needs a yaku to tsumo; a closed one always has 門前清自摸和.
func TestAuditOpenHandNeedsAYakuToTsumo(t *testing.T) {
	r := newRound(t)
	setPon(r, 0, 2, "8p", "123m567m345p9s", "9s")
	if r.LegalFor(0).Tsumo {
		t.Fatal("tsumo offered to an open hand without yaku")
	}
	if err := r.Apply(Action{Seat: 0, Type: Tsumo}); !errors.Is(err, ErrConflict) {
		t.Fatalf("tsumo without yaku: %v", err)
	}
	r = newRound(t)
	setHand(r, 0, "123m567m345p789s9s", "9s")
	if !r.LegalFor(0).Tsumo {
		t.Fatal("closed tsumo not offered")
	}
	mustApply(t, r, Action{Seat: 0, Type: Tsumo})
	if res := r.Result(); !hasYaku(res, "tsumo") || !hasYaku(res, "pinfu") || res.Win.Fu != 20 {
		t.Fatalf("yaku %v fu %d", yakuKeys(res), res.Win.Fu)
	}
}

// Riichi needs at least four draws left: exactly four is allowed.
func TestAuditRiichiWithFourDrawsLeft(t *testing.T) {
	r := tenpai0(t)
	r.draws = wall.LiveDraws4 - minDrawsForRiichi
	if len(r.LegalFor(0).Riichi) == 0 {
		t.Fatal("riichi refused with four draws left")
	}
}

// Tobi is strictly below zero (docs/api.md: "below 0").
func TestAuditTobiIsStrictlyBelowZero(t *testing.T) {
	h := NewHanchan(4, Tonpuu)
	endRound(h, Result{Kind: "ron", Winner: 1, From: 2}, [4]int{0, 50000, 25000, 25000})
	if h.Over() {
		t.Fatal("a seat at exactly 0 ended the game")
	}
	h = NewHanchan(4, Tonpuu)
	endRound(h, Result{Kind: "ron", Winner: 1, From: 2}, [4]int{-100, 50100, 25000, 25000})
	if !h.Over() {
		t.Fatal("a seat below 0 did not end the game")
	}
}

// The last round goes on while the dealer keeps the deal (no agari-yame) and
// ends once the deal would pass.
func TestAuditLastRoundDealerKeepsPlaying(t *testing.T) {
	h := NewHanchan(4, HanchanRule) // first dealer: seat 0
	for range 7 {
		endRound(h, Result{Kind: "ron", Winner: (h.Dealer() + 1) % 4, From: h.Dealer()}, even)
		if err := h.Next(); err != nil {
			t.Fatal(err)
		}
	}
	if h.RoundWind() != tile.South || h.Number() != 4 || h.Dealer() != 3 {
		t.Fatalf("wind %v number %d dealer %d", h.RoundWind(), h.Number(), h.Dealer())
	}
	lead := [4]int{20000, 20000, 20000, 40000}
	endRound(h, Result{Kind: "tsumo", Winner: 3, From: -1}, lead)
	if h.Over() {
		t.Fatal("the leading dealer's win ended the last round (agari-yame)")
	}
	if err := h.Next(); err != nil {
		t.Fatal(err)
	}
	endRound(h, Result{Kind: "draw", Winner: -1, From: -1, Tenpai: [4]bool{false, false, false, true}}, lead)
	if h.Over() {
		t.Fatal("a tenpai dealer draw ended the last round")
	}
	if err := h.Next(); err != nil {
		t.Fatal(err)
	}
	if h.Number() != 4 || h.Honba() != 2 {
		t.Fatalf("number %d honba %d", h.Number(), h.Honba())
	}
	endRound(h, Result{Kind: "draw", Winner: -1, From: -1}, lead)
	if !h.Over() {
		t.Fatal("the game went on after the last dealer lost the deal")
	}
}

// 四風連打 with a riichi on the fourth wind: the round aborts and the stick
// stays on the table.
func TestAuditSuufonWithRiichiKeepsTheStick(t *testing.T) {
	r := newRound(t)
	for s := 0; s < 3; s++ {
		setHand(r, s, junk[2], "4z")
		r.turn = s
		mustApply(t, r, Action{Seat: s, Type: Discard, Tile: "4z"})
	}
	setHand(r, 3, "123m456m789m23p55s", "4z")
	r.turn = 3
	mustApply(t, r, Action{Seat: 3, Type: Riichi, Tile: "4z"})
	res := r.Result()
	if res == nil || res.Reason != AbortSuufon || res.Deposit != RiichiStick || res.StickDeltas[3] != -RiichiStick || r.players[3].points != StartPoints-RiichiStick {
		t.Fatalf("result %+v", res)
	}
	checkDeltas(t, r, res)
}

// Kuikae is by kind: after a pon of 5m the red five may not go either.
func TestAuditKuikaeCoversTheRedFive(t *testing.T) {
	r := newRound(t)
	setHand(r, 3, junk[1], "")
	setHand(r, 2, "5m5m0m147p258s1234z", "")
	setHand(r, 0, junk[0], "5m")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "5m"})
	mustApply(t, r, Action{Seat: 2, Type: Pon})
	if l := r.LegalFor(2); slices.Contains(l.Discards, "0m") || slices.Contains(l.Discards, "5m") {
		t.Fatalf("legal %v", l.Discards)
	}
	if err := r.Apply(Action{Seat: 2, Type: Discard, Tile: "0m"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("red five kuikae: %v", err)
	}
}

// Chii kuikae on the upper end: 6m called with 45m bans 6m and the suji 3m.
func TestAuditChiiKuikaeUpperEnd(t *testing.T) {
	r := newRound(t)
	setHand(r, 1, "345m147p258s1357z", "")
	setHand(r, 0, junk[0], "6m")
	mustApply(t, r, Action{Seat: 0, Type: Discard, Tile: "6m"})
	if c := r.LegalFor(1).Chii; len(c) != 1 || !slices.Equal(c[0], []string{"4m", "5m"}) {
		t.Fatalf("chii options %v", c)
	}
	mustApply(t, r, Action{Seat: 1, Type: Chii, Tiles: []string{"4m", "5m"}})
	l := r.LegalFor(1).Discards
	if slices.Contains(l, "3m") || slices.Contains(l, "6m") || !slices.Contains(l, "1p") {
		t.Fatalf("legal after the chii %v", l)
	}
}
