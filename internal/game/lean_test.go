package game

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/litencatt/mhj2/internal/score"
	"github.com/litencatt/mhj2/internal/yaku"
)

// Golden vectors from the Lean model in formal/ (formal/run.sh vectors).

func loadVectors(t *testing.T, path string, v any) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatal(err)
	}
}

type leanSettlement struct {
	Kind                 string
	Dealer, Winner, From int
	Honba, Deposit       int
	Riichi, Tenpai       [4]bool
	Han, Fu              int
	Yakuman              []struct{ Mult, Pao int }
	Hand                 [4]int
	HonbaDeltas          [4]int `json:"honba_deltas"`
	Stick                [4]int
	DepositOut           int `json:"deposit_out"`
}

// settle runs the settlement of v through the payments of a Round: the
// riichi sticks of this round are on the table already, as in play.
func (v leanSettlement) settle() *Result {
	r := &Round{dealer: v.Dealer, honba: v.Honba, deposit: v.Deposit}
	for s, ri := range v.Riichi {
		if ri {
			r.players[s].riichi = true
			r.deposit += RiichiStick
		}
	}
	res := &Result{Kind: v.Kind, Winner: -1, From: -1, Tenpai: v.Tenpai}
	switch v.Kind {
	case "tsumo", "ron":
		w := yaku.Win{Fu: v.Fu, HanTotal: v.Han}
		if len(v.Yakuman) == 0 {
			w.Yaku = []yaku.Yaku{{Key: "riichi", Han: 1}} // the rest is dora
		}
		for i, y := range v.Yakuman {
			key := fmt.Sprintf("yakuman%d", i)
			w.Yaku = append(w.Yaku, yaku.Yaku{Key: key, Han: 13 * y.Mult})
			if y.Pao >= 0 {
				res.Pao = append(res.Pao, Pao{Seat: y.Pao, Yaku: key})
			}
		}
		tsumo := v.Kind == "tsumo"
		res.Winner, res.Win = v.Winner, &w
		res.Points = score.FromWin(w, v.Winner == v.Dealer, tsumo)
		if tsumo {
			payTsumo(res, v.Dealer)
		} else {
			res.From = v.From
			payRon(res, v.Dealer)
		}
	case "draw":
		payNoten(res)
	}
	r.finish(res)
	return res
}

func TestLeanSettlementVectors(t *testing.T) {
	var vs []leanSettlement
	loadVectors(t, "testdata/lean_settlement.json", &vs)
	if len(vs) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range vs {
		res := v.settle()
		if res.HandDeltas != v.Hand || res.HonbaDeltas != v.HonbaDeltas ||
			res.StickDeltas != v.Stick || res.Deposit != v.DepositOut {
			t.Errorf("%+v:\n got hand %v honba %v sticks %v deposit %d", v,
				res.HandDeltas, res.HonbaDeltas, res.StickDeltas, res.Deposit)
		}
	}
}

func TestLeanStandingsVectors(t *testing.T) {
	var vs []struct {
		Points      [4]int
		FirstDealer int `json:"first_dealer"`
		Deposit     int
		Over        bool
		Rank, Final [4]int
		ScoreTenths [4]int `json:"score_tenths"`
	}
	loadVectors(t, "testdata/lean_standings.json", &vs)
	if len(vs) == 0 {
		t.Fatal("no vectors")
	}
	for _, v := range vs {
		h := NewHanchanFrom(1, Tonpuu, v.FirstDealer)
		h.number = 3 // East 4: over unless the dealer keeps the deal
		h.round.deposit = v.Deposit
		res := Result{Kind: "draw", Winner: -1, From: -1}
		res.Tenpai[h.Dealer()] = !v.Over
		endRound(h, res, v.Points)
		if h.Over() != v.Over {
			t.Fatalf("%+v: Over() = %v", v, h.Over())
		}
		for s, st := range h.Standings() {
			if st.Seat != s || st.Rank != v.Rank[s] || st.Points != v.Final[s] ||
				st.Score != float64(v.ScoreTenths[s])/10 {
				t.Errorf("%+v:\n seat %d: got %+v", v, s, st)
			}
		}
	}
}
