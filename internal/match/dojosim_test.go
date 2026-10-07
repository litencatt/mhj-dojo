package match

import (
	"fmt"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
)

// The dojo's economy measured (docs/dojo-economy.md): the weak CPU plays
// your seat in dojo games (tonpuu, weak CPUs, a random first dealer) with
// the yaku of each stage of the shop, from seeds 1 to N. The table in the
// doc is the MHJDOJO_FULL=1 run.

// simStages are the yaku you own at each stage.
var simStages = []struct {
	name string
	yaku []string
}{
	{"S0 初期", []string{"tanyao", "pinfu", "tsumo"}},
	{"S1 +立直・役牌", []string{"tanyao", "pinfu", "tsumo", "riichi", "haku", "hatsu", "chun", "ton", "nan", "shaa", "pei"}},
	{"S2 +2翻役", []string{"tanyao", "pinfu", "tsumo", "riichi", "haku", "hatsu", "chun", "ton", "nan", "shaa", "pei",
		"double_riichi", "sanshoku", "ittsu", "chanta", "chiitoitsu", "toitoi", "sanankou", "sanshoku_doukou", "sankantsu",
		"shousangen", "honroutou"}},
	{"S3 全役", allYaku},
}

// simStats sums up a stage's games.
type simStats struct {
	games, rounds, wins, dealIns, han int
	ranks                             [4]int
}

// simGame plays a dojo game to its end with the weak CPU on your seat.
func simGame(t *testing.T, st *Store, seed int64, yaku []string, s *simStats) {
	t.Helper()
	m, err := st.Create(&seed, Options{CPU: cpu.Weak, Dojo: &DojoOptions{Yaku: yaku}})
	if err != nil {
		t.Fatal(err)
	}
	m.game.OnHumanDiscard = nil // the history's analysis is not needed
	p := cpu.NewWeak()
	for {
		r := m.game.Round
		if r.Phase() != game.PhaseEnded {
			if err := m.act(p.Decide(r.ViewFor(Human), r.LegalFor(Human))); err != nil {
				t.Fatalf("seed %d: %v", seed, err)
			}
			continue
		}
		sum := m.summary()
		s.rounds++
		s.han += sum.Han
		if sum.Winner == Human {
			s.wins++
		}
		if sum.Kind == "ron" && sum.From == Human {
			s.dealIns++
		}
		if m.game.H.Over() {
			break
		}
		if err := m.next(); err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
	}
	if m.game.Fallbacks != 0 {
		t.Errorf("seed %d: %d CPU fallbacks", seed, m.game.Fallbacks)
	}
	s.games++
	s.ranks[m.game.H.Standings()[Human].Rank-1]++
}

func TestDojoEconomySim(t *testing.T) {
	if testing.Short() {
		t.Skip("plays whole games; run without -short")
	}
	n := testmode.N(400, 2, 0)
	var b strings.Builder
	b.WriteString("| 段階 | 対局 | 局 | 和了率（/局） | 放銃率（/局） | 翻の平均（/局） | 翻の平均（/和了） | 1位 | 2位 | 3位 | 4位 |\n")
	b.WriteString("|---|---|---|---|---|---|---|---|---|---|---|\n")
	for _, stage := range simStages {
		var s simStats
		st := NewStore(4)
		for seed := int64(1); seed <= int64(n); seed++ {
			simGame(t, st, seed, stage.yaku, &s)
		}
		pct := func(x int) string { return fmt.Sprintf("%.1f%%", 100*float64(x)/float64(s.games)) }
		perWin := 0.0
		if s.wins > 0 {
			perWin = float64(s.han) / float64(s.wins)
		}
		fmt.Fprintf(&b, "| %s | %d | %d | %.1f%% | %.1f%% | %.2f | %.2f | %s | %s | %s | %s |\n",
			stage.name, s.games, s.rounds, 100*float64(s.wins)/float64(s.rounds), 100*float64(s.dealIns)/float64(s.rounds),
			float64(s.han)/float64(s.rounds), perWin, pct(s.ranks[0]), pct(s.ranks[1]), pct(s.ranks[2]), pct(s.ranks[3]))
	}
	t.Log("\n" + b.String())
}
