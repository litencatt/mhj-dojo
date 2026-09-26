package advice

import (
	"math"
	"strings"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

func find(t *testing.T, a *Advice, s string) cand {
	t.Helper()
	k := tile.MustParseHand(s)[0].Kind
	for _, c := range a.all {
		if c.t.Kind == k {
			return c
		}
	}
	t.Fatalf("no candidate %s", s)
	return cand{}
}

func TestRankTenpaiFirst(t *testing.T) {
	a := Compute(input(yakushanten.NewAnalyzer(), "123m456p789s23s11z9m", "", 3, 18))
	if len(a.Candidates) != 3 {
		t.Fatalf("%d candidates, want 3", len(a.Candidates))
	}
	c := a.Candidates[0]
	if c.Tile != "9m" || c.Shanten != 0 || c.UkeireKinds != 2 || c.Ukeire != 8 || c.Wait == nil || *c.Wait != 8 {
		t.Fatalf("best = %+v, want 9m tenpai on 1s/4s (8 tiles)", c)
	}
	// The rest are 1-shanten, most ukeire first.
	if a.Candidates[1].Tile != "2s" || a.Candidates[1].Shanten != 1 || a.Candidates[1].Ukeire < a.Candidates[2].Ukeire {
		t.Fatalf("runners-up = %+v %+v", a.Candidates[1], a.Candidates[2])
	}
	if a.TenpaiChance != 1 || a.WinChance <= 0 || a.WinChance >= 1 {
		t.Fatalf("chances %v %v", a.TenpaiChance, a.WinChance)
	}
	if a.Junme != 4 || a.Phase != "early" || a.DrawsLeft != 14 {
		t.Fatalf("junme %d phase %s draws %d", a.Junme, a.Phase, a.DrawsLeft)
	}
	if want := "打 9m 後: 面子3・両面1・雀頭あり"; a.Shape != want {
		t.Fatalf("shape %q, want %q", a.Shape, want)
	}
	if len(a.Notes) == 0 || !strings.Contains(a.Notes[0], "9m を切るほうが聴牌に1歩近い") {
		t.Fatalf("notes %q", a.Notes)
	}
}

// Discarding 3s keeps the ryanmen 45s, discarding 4s the kanchan 35s: both
// leave 1-shanten with the same 11 ukeire (3s/4s, 6s, 8p), but after 8p the
// first waits on 3s-6s (7 unseen) and the second on one kanchan (4 or 3).
func TestWaitPrefersRyanmen(t *testing.T) {
	a := Compute(input(yakushanten.NewAnalyzer(), "123m456p11z3457s79p", "", 3, 18))
	ry, ka := find(t, a, "3s"), find(t, a, "4s")
	if ry.shanten != 1 || ka.shanten != 1 || ry.ukeire != 11 || ka.ukeire != 11 {
		t.Fatalf("3s %+v, 4s %+v", ry, ka)
	}
	// 3s: (3*4 + 4*4 + 4*7) / 11; 4s: every draw leaves a 4-tile wait.
	if math.Abs(ry.wait-56.0/11) > 1e-9 || math.Abs(ka.wait-4) > 1e-9 {
		t.Fatalf("waits %v %v, want %v 4", ry.wait, ka.wait, 56.0/11)
	}
	if compare(ry, ka) >= 0 {
		t.Fatal("3s should rank above 4s")
	}
	// The tenpai discard 7s still comes first.
	if a.Candidates[0].Tile != "7s" || a.Candidates[0].Shanten != 0 {
		t.Fatalf("best %+v", a.Candidates[0])
	}

	// Without the tenpai discard, 4s is reviewed on its wait.
	var rest []cand
	for _, c := range a.all {
		if c.shanten == 1 && c.ukeire == 11 {
			rest = append(rest, c)
		}
	}
	r := (&Advice{all: rest}).Review(tile.MustParseHand("4s")[0])
	if r.IsBest || !strings.Contains(r.Text, "聴牌時の待ちが平均1.1枚少ない") {
		t.Fatalf("review %+v", r)
	}
}

func TestReview(t *testing.T) {
	a := Compute(input(yakushanten.NewAnalyzer(), "123m456p789s23s11z9m", "", 3, 18))
	if r := a.Review(tile.MustParseHand("9m")[0]); !r.IsBest || r.Rank != 1 || r.Text != "前巡の打 9m: 最善" {
		t.Fatalf("9m review %+v", r)
	}
	r := a.Review(tile.MustParseHand("1z")[0])
	if r.IsBest || r.Best != "9m" || r.Shanten != 1 || r.BestShanten != 0 || !strings.Contains(r.Text, "向聴が1つ遠い") {
		t.Fatalf("1z review %+v", r)
	}
	// 1m and 9s are equally good 1-shanten discards: 9s ties with 1m's rank.
	r1, r9 := a.Review(tile.MustParseHand("1m")[0]), a.Review(tile.MustParseHand("9s")[0])
	if r1.Rank != r9.Rank || r1.Rank != 4 || !strings.Contains(r1.Text, "向聴が1つ遠い（4位）") {
		t.Fatalf("1m %+v 9s %+v", r1, r9)
	}
	// A discard tied with the best on shanten, ukeire and wait is 最善 too.
	b := Compute(input(yakushanten.NewAnalyzer(), "234m678p13s46s55z9m1p", "", 3, 18))
	if r := b.Review(tile.MustParseHand("1p")[0]); !r.IsBest || r.Best != "9m" || !strings.Contains(r.Text, "最善（打 9m と同等）") {
		t.Fatalf("1p review %+v", r)
	}
}

func TestRedFiveKept(t *testing.T) {
	// Two 5p, one red: discarding 5p keeps the red one.
	a := Compute(input(yakushanten.NewAnalyzer(), "123m406p789s11z55p9m", "", 0, 18))
	for _, c := range a.all {
		if c.t.Kind == tile.MustParseHand("5p")[0].Kind && c.t.Red {
			t.Fatalf("recommends the red five: %+v", c.t)
		}
	}
}

func TestWaitTiesAtShownPrecision(t *testing.T) {
	a := cand{shanten: 1, ukeire: 20, wait: 4.04, hasWait: true}
	b := cand{shanten: 1, ukeire: 20, wait: 4.01, hasWait: true}
	if primary(a, b) != 0 || !strings.Contains(versus(a, b), "待ちは同じ") {
		t.Fatalf("4.04 vs 4.01 should tie: %d %q", primary(a, b), versus(a, b))
	}
}

func TestReviewRedFive(t *testing.T) {
	// 4p0p waits on 3p-6p: the best discard is the plain 5p; discarding the red
	// one gives up a dora for nothing, so it is not 最善.
	a := Compute(input(yakushanten.NewAnalyzer(), "123m456s789s11z4p05p", "", 0, 18))
	if a.Candidates[0].Tile != "5p" {
		t.Fatalf("best %+v", a.Candidates[0])
	}
	if r := a.Review(tile.MustParseHand("5p")[0]); !r.IsBest || r.Text != "前巡の打 5p: 最善" {
		t.Fatalf("plain 5p review %+v", r)
	}
	r := a.Review(tile.MustParseHand("0p")[0])
	if r.IsBest || r.Rank != 1 || r.Text != "前巡の打 赤5p: 最善と同じ牌種だが赤ドラを失う（打 5p が最善）" {
		t.Fatalf("red 5p review %+v", r)
	}
}

func TestDoraDiscardedLast(t *testing.T) {
	// 1z and 7z are equally useless floats; 7z is dora.
	in := input(yakushanten.NewAnalyzer(), "123m456p789s23s1z7z9p", "", 0, 18)
	in.Dora = []tile.Kind{tile.Chun}
	a := Compute(in)
	if z1, z7 := find(t, a, "1z"), find(t, a, "7z"); compare(z1, z7) >= 0 {
		t.Fatalf("1z %+v should rank above dora 7z %+v", z1, z7)
	}
}

func TestPhase(t *testing.T) {
	for _, tc := range []struct {
		turn int
		want string
	}{{0, "early"}, {5, "early"}, {6, "middle"}, {11, "middle"}, {12, "late"}, {17, "late"}} {
		a := Compute(input(yakushanten.NewAnalyzer(), "123m456p789s23s11z9m", "", tc.turn, 18))
		if a.Phase != tc.want || a.Junme != tc.turn+1 || a.DrawsLeft != 18-tc.turn-1 {
			t.Errorf("turn %d: phase %s junme %d draws %d, want %s", tc.turn, a.Phase, a.Junme, a.DrawsLeft, tc.want)
		}
	}
	// A short game: the last 5 draws are late from the first junme.
	if a := Compute(input(yakushanten.NewAnalyzer(), "123m456p789s23s11z9m", "", 0, 6)); a.Phase != "late" || a.DrawsLeft != 5 {
		t.Errorf("short game: phase %s draws %d", a.Phase, a.DrawsLeft)
	}
	// The last discard: no draws follow.
	if a := Compute(input(yakushanten.NewAnalyzer(), "123m456p789s23s11z9m", "", 17, 18)); a.Guideline != "最後の打牌。聴牌を保って流局を迎える。" {
		t.Errorf("last discard guideline %q", a.Guideline)
	}
	// Late and far from tenpai: the guideline says so.
	a := Compute(input(yakushanten.NewAnalyzer(), "159m159p159s1234z5z", "", 16, 18))
	if a.Phase != "late" || !strings.Contains(a.Guideline, "聴牌の見込みは低い") {
		t.Fatalf("guideline %q", a.Guideline)
	}
}

func TestChances(t *testing.T) {
	// No useful tiles, or no draws left: no progress.
	if tp, w := chances(1, 0, 0, 100, 10); tp != 0 || w != 0 {
		t.Errorf("0 ukeire: %v %v", tp, w)
	}
	if tp, w := chances(2, 30, 6, 100, 0); tp != 0 || w != 0 {
		t.Errorf("0 draws: %v %v", tp, w)
	}
	if tp, w := chances(0, 0, 0, 100, 10); tp != 1 || w != 0 {
		t.Errorf("dead wait: %v %v", tp, w)
	}
	// Tenpai with w waits among n unseen: 1 - (1 - w/n)^d.
	if _, w := chances(0, 8, 8, 100, 5); math.Abs(w-(1-math.Pow(0.92, 5))) > 1e-12 {
		t.Errorf("tenpai win %v", w)
	}
	// Monotonic in draws and never above 1; winning never beats tenpai.
	prevT, prevW := 0.0, 0.0
	for d := 0; d <= 30; d++ {
		tp, w := chances(2, 40, 5, 110, d)
		if tp < prevT || w < prevW || tp > 1 || w > tp {
			t.Fatalf("draws %d: tenpai %v win %v (prev %v %v)", d, tp, w, prevT, prevW)
		}
		prevT, prevW = tp, w
	}
}

func TestDeterministic(t *testing.T) {
	a := Compute(input(yakushanten.NewAnalyzer(), "234m678p13s46s55z9m1p", "5z", 8, 18))
	b := Compute(input(yakushanten.NewAnalyzer(), "234m678p13s46s55z9m1p", "5z", 8, 18))
	if strings.Join(a.Notes, "|") != strings.Join(b.Notes, "|") || a.Candidates[0].Tile != b.Candidates[0].Tile || a.Shape != b.Shape {
		t.Fatal("same position, different advice")
	}
}

func TestNearYaku(t *testing.T) {
	// Tanyao tenpai if the 9m goes; it stays the recommendation's yaku.
	a := Compute(input(yakushanten.NewAnalyzer(), "234m678p345s66s78s9m", "", 3, 18))
	if a.Candidates[0].Tile != "9m" {
		t.Fatalf("best %+v", a.Candidates[0])
	}
	var tanyao *NearYaku
	for i := range a.NearYaku {
		if a.NearYaku[i].Key == "tanyao" {
			tanyao = &a.NearYaku[i]
		}
	}
	if tanyao == nil || tanyao.Shanten != 0 || !tanyao.Kept || tanyao.Han != 1 {
		t.Fatalf("near yaku %+v", a.NearYaku)
	}
}

// BenchmarkCompute times the advice alone (the per-discard analysis is
// built outside the loop) on hands from 3-shanten to tenpai, where the
// expected-wait search does the most work.
func BenchmarkCompute(b *testing.B) {
	a := yakushanten.NewAnalyzer()
	var ins []Input
	for _, h := range []string{"123m456p789s23s11z9m", "123m456p11z3457s79p", "11m345m678p22s456s7z", "234m678p13s46s55z9m1p", "139m468p2479s1257z"} {
		ins = append(ins, input(a, h, "", 5, 18))
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Compute(ins[i%len(ins)])
	}
}
