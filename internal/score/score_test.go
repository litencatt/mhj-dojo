package score

import (
	"testing"

	"github.com/litencatt/mhj2/internal/yaku"
)

// Standard ron tables (fu rows, han 1-4); 0 = not listed.
var nonDealerRon = map[int][4]int{
	25:  {0, 1600, 3200, 6400},
	30:  {1000, 2000, 3900, 7700},
	40:  {1300, 2600, 5200, 8000},
	50:  {1600, 3200, 6400, 8000},
	60:  {2000, 3900, 7700, 8000},
	70:  {2300, 4500, 8000, 8000},
	80:  {2600, 5200, 8000, 8000},
	90:  {2900, 5800, 8000, 8000},
	100: {3200, 6400, 8000, 8000},
	110: {3600, 7100, 8000, 8000},
}

var dealerRon = map[int][4]int{
	25:  {0, 2400, 4800, 9600},
	30:  {1500, 2900, 5800, 11600},
	40:  {2000, 3900, 7700, 12000},
	50:  {2400, 4800, 9600, 12000},
	60:  {2900, 5800, 11600, 12000},
	70:  {3400, 6800, 12000, 12000},
	80:  {3900, 7700, 12000, 12000},
	90:  {4400, 8700, 12000, 12000},
	100: {4800, 9600, 12000, 12000},
	110: {5300, 10600, 12000, 12000},
}

func TestRonTables(t *testing.T) {
	for _, tc := range []struct {
		dealer bool
		table  map[int][4]int
	}{{false, nonDealerRon}, {true, dealerRon}} {
		for fu, row := range tc.table {
			for i, want := range row {
				if want == 0 {
					continue
				}
				p := Compute(i+1, fu, 0, tc.dealer, false)
				if p.Ron != want || p.Total != want {
					t.Errorf("dealer=%v %dfu %dhan ron: got %d, want %d", tc.dealer, fu, i+1, p.Ron, want)
				}
			}
		}
	}
}

func TestTsumo(t *testing.T) {
	cases := []struct {
		han, fu               int
		dealer                bool
		fromDealer, fromOther int
	}{
		{1, 30, false, 500, 300},
		{2, 20, false, 700, 400},
		{3, 20, false, 1300, 700},
		{4, 20, false, 2600, 1300},
		{3, 25, false, 1600, 800},
		{3, 40, false, 2600, 1300},
		{4, 30, false, 3900, 2000},
		{5, 30, false, 4000, 2000},
		{1, 30, true, 0, 500},
		{2, 20, true, 0, 700},
		{3, 40, true, 0, 2600},
		{4, 40, true, 0, 4000},
	}
	for _, tc := range cases {
		p := Compute(tc.han, tc.fu, 0, tc.dealer, true)
		others := 3
		if !tc.dealer {
			others = 2
		}
		if p.FromDealer != tc.fromDealer || p.FromNonDealer != tc.fromOther ||
			p.Total != p.FromDealer+others*p.FromNonDealer || p.Ron != 0 {
			t.Errorf("%dhan %dfu dealer=%v: got %+v", tc.han, tc.fu, tc.dealer, p)
		}
	}
}

func TestLimits(t *testing.T) {
	cases := []struct {
		han, yakuman    int
		limit           Limit
		child, dealerPt int
	}{
		{5, 0, Mangan, 8000, 12000},
		{6, 0, Haneman, 12000, 18000},
		{7, 0, Haneman, 12000, 18000},
		{8, 0, Baiman, 16000, 24000},
		{10, 0, Baiman, 16000, 24000},
		{11, 0, Sanbaiman, 24000, 36000},
		{12, 0, Sanbaiman, 24000, 36000},
		{13, 0, Yakuman, 32000, 48000}, // counted yakuman
		{13, 1, Yakuman, 32000, 48000},
		{26, 2, Yakuman, 64000, 96000},
	}
	for _, tc := range cases {
		c := Compute(tc.han, 30, tc.yakuman, false, false)
		d := Compute(tc.han, 30, tc.yakuman, true, false)
		if c.Limit != tc.limit || c.Total != tc.child || d.Total != tc.dealerPt {
			t.Errorf("%dhan yakuman=%d: got %s %d / %d", tc.han, tc.yakuman, c.Limit, c.Total, d.Total)
		}
	}
	if p := Compute(4, 40, 0, false, false); p.Limit != Mangan {
		t.Errorf("4han 40fu should be mangan, got %q", p.Limit)
	}
	if p := Compute(4, 30, 0, false, false); p.Limit != None {
		t.Errorf("4han 30fu is 7700 without kiriage, got %q", p.Limit)
	}
	// yakuman tsumo by a non-dealer: 16000 / 8000
	if p := Compute(13, 0, 1, false, true); p.FromDealer != 16000 || p.FromNonDealer != 8000 || p.Total != 32000 {
		t.Errorf("yakuman tsumo: %+v", p)
	}
}

// Yakuman multiples: non-dealer 32000 x n, dealer 48000 x n, tsumo split
// as for any limit hand.
func TestYakumanMultiples(t *testing.T) {
	for n := 1; n <= 3; n++ {
		cases := []struct {
			name                              string
			dealer, tsumo                     bool
			ron, fromDealer, fromOther, total int
		}{
			{"non-dealer ron", false, false, 32000 * n, 0, 0, 32000 * n},
			{"dealer ron", true, false, 48000 * n, 0, 0, 48000 * n},
			{"non-dealer tsumo", false, true, 0, 16000 * n, 8000 * n, 32000 * n},
			{"dealer tsumo", true, true, 0, 0, 16000 * n, 48000 * n},
		}
		for _, tc := range cases {
			p := Compute(13*n, 0, n, tc.dealer, tc.tsumo)
			if p.Limit != Yakuman || p.Multiplier != n || p.Ron != tc.ron || p.FromDealer != tc.fromDealer ||
				p.FromNonDealer != tc.fromOther || p.Total != tc.total {
				t.Errorf("x%d %s: got %+v", n, tc.name, p)
			}
		}
	}
}

func TestFromWin(t *testing.T) {
	// a double yakuman form (26 han) counts as two yakuman, stacked with another
	triple := yaku.Win{Yaku: []yaku.Yaku{{Key: "suuankou", Han: 26}, {Key: "tsuuiisou", Han: 13}}, HanTotal: 39}
	if p := FromWin(triple, true, true); p.Multiplier != 3 || p.FromNonDealer != 48000 || p.Total != 144000 {
		t.Errorf("triple yakuman: %+v", p)
	}
	stacked := yaku.Win{Yaku: []yaku.Yaku{{Key: "suuankou", Han: 13}, {Key: "tsuuiisou", Han: 13}}, HanTotal: 26}
	if p := FromWin(stacked, false, false); p.Multiplier != 2 || p.Total != 64000 {
		t.Errorf("double yakuman: %+v", p)
	}
	counted := yaku.Win{Yaku: []yaku.Yaku{{Key: "chinitsu", Han: 6}, {Key: "ryanpeikou", Han: 3}}, HanTotal: 13, Fu: 40}
	if p := FromWin(counted, false, false); p.Limit != Yakuman || p.Multiplier != 1 || p.Total != 32000 {
		t.Errorf("counted yakuman: %+v", p)
	}
	pinfuTsumo := yaku.Win{Yaku: []yaku.Yaku{{Key: "tsumo", Han: 1}, {Key: "pinfu", Han: 1}}, HanTotal: 2, Fu: 20}
	if p := FromWin(pinfuTsumo, false, true); p.FromDealer != 700 || p.FromNonDealer != 400 {
		t.Errorf("pinfu tsumo: %+v", p)
	}
}

func TestNoYakuScoresNothing(t *testing.T) {
	noYaku := yaku.Win{Fu: 30} // complete, but no yaku: HanTotal 0
	if p := FromWin(noYaku, true, false); p != (Points{}) {
		t.Errorf("no-yaku win scored %+v", p)
	}
}

func TestHalf(t *testing.T) {
	for v, want := range map[int]int{32000: 16000, 48000: 24000, 3900: 2000, 100: 100, 0: 0} {
		if got := Half(v); got != want {
			t.Errorf("Half(%d) = %d, want %d", v, got, want)
		}
	}
}
