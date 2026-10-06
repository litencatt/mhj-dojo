package match

import (
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// starter is the dojo's first set of yaku.
var starter = []string{"tanyao", "pinfu", "haku", "hatsu", "chun", "ton", "nan", "shaa", "pei"}

// allYaku are every yaku key.
var allYaku = []string{
	"riichi", "double_riichi", "ippatsu", "tsumo", "haitei", "houtei", "rinshan", "chankan", "tanyao", "pinfu",
	"iipeikou", "ryanpeikou", "sanshoku", "sanshoku_doukou", "ittsu", "chanta", "junchan", "honroutou", "honitsu",
	"chinitsu", "toitoi", "sanankou", "sankantsu", "shousangen", "haku", "hatsu", "chun", "ton", "nan", "shaa", "pei",
	"chiitoitsu", "tenhou", "chiihou", "kokushi", "suuankou", "daisangen", "tsuuiisou", "shousuushii", "daisuushii",
	"ryuuiisou", "chinroutou", "chuuren", "suukantsu",
}

func without(keys []string, drop ...string) []string {
	return slices.DeleteFunc(slices.Clone(keys), func(k string) bool { return slices.Contains(drop, k) })
}

func dojoGame(t *testing.T, st *Store, seed int64, d DojoOptions) *Match {
	t.Helper()
	m, err := st.Create(&seed, Options{CPU: cpu.Weak, Dojo: &d})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestDojoOptionsAreChecked(t *testing.T) {
	st := NewStore(16)
	for _, d := range []DojoOptions{{Yaku: []string{"riichi", "nope"}}, {RedrawsPerRound: -1}, {WallPeek: -1}, {SummonsPerRound: -1}} {
		if _, err := st.Create(nil, Options{Dojo: &d}); !errors.Is(err, game.ErrInvalid) {
			t.Errorf("%+v: %v", d, err)
		}
	}
}

// Outside the dojo nothing new shows in the state or the save.
func TestDojoFieldsOnlyInTheDojo(t *testing.T) {
	st := NewStore(16)
	seed := int64(9)
	m, _ := st.Create(&seed, Options{})
	s := playOut(t, m)
	b, _ := json.Marshal(s)
	sv, _ := json.Marshal(m.Save())
	var raw struct {
		Rounds []map[string]any `json:"rounds"`
		Result map[string]any   `json:"result"`
	}
	_ = json.Unmarshal(b, &raw)
	if strings.Contains(string(b), `"dojo"`) || strings.Contains(string(sv), `"dojo"`) ||
		raw.Rounds[0]["han"] != nil || raw.Rounds[0]["redraws"] != nil || raw.Rounds[0]["summons"] != nil || raw.Result["excluded"] != nil {
		t.Errorf("dojo fields in a standard game: %s", b)
	}
	d := dojoGame(t, st, seed, DojoOptions{Yaku: starter})
	b, _ = json.Marshal(d.State())
	if strings.Contains(string(b), `"my_next_draws"`) || strings.Contains(string(b), `"waits"`) || strings.Contains(string(b), `"summon"`) {
		t.Errorf("cheats bought in a dojo game without them: %s", b)
	}
	if !d.State().Dojo || d.Save().Dojo == nil {
		t.Error("a dojo game does not say so")
	}
	// A save is a copy: changing it leaves the game's options alone.
	d.Save().Dojo.Yaku[0] = "riichi"
	if d.opts.Dojo.Yaku[0] != starter[0] {
		t.Error("the save shares the game's dojo yaku")
	}
}

// Peek fills the other hands during a round and changes nothing else.
func TestDojoPeek(t *testing.T) {
	st := NewStore(16)
	for seed := range int64(4) {
		plain := dojoGame(t, st, seed, DojoOptions{Yaku: starter})
		peek := dojoGame(t, st, seed, DojoOptions{Yaku: starter, Peek: true})
		a, b := plain.State(), peek.State()
		for s := 1; s < 4; s++ {
			if len(a.Seats[s].Hand) != 0 || a.Seats[s].Drawn != nil {
				t.Fatalf("seed %d: seat %d shown without peek", seed, s)
			}
			if len(b.Seats[s].Hand) == 0 {
				t.Fatalf("seed %d: seat %d not shown with peek", seed, s)
			}
			if n := len(b.Seats[s].Hand); b.Seats[s].Drawn == nil && n != b.Seats[s].HandCount {
				t.Fatalf("seed %d: seat %d shows %d of %d tiles", seed, s, n, b.Seats[s].HandCount)
			}
		}
		if !reflect.DeepEqual(a.Remaining, b.Remaining) || !reflect.DeepEqual(a.Danger, b.Danger) ||
			!reflect.DeepEqual(a.Advice, b.Advice) {
			t.Fatalf("seed %d: peek changed what counts as seen", seed)
		}
		// Once the round ends every hand shows anyway.
		a, b = playOut(t, plain), playOut(t, peek)
		a.GameID, b.GameID = "", ""
		if !reflect.DeepEqual(a.Seats, b.Seats) {
			t.Fatalf("seed %d: the ended round differs", seed)
		}
	}
}

// The analysis, the combos and the advice of a dojo game keep to its yaku;
// the combos still fill their MaxCombos, and the shared combo list (and so a
// standard game's combos) stays as it was.
func TestDojoAnalysisKeepsToTheLearnedYaku(t *testing.T) {
	st := NewStore(64)
	learned := without(allYaku, "honitsu")
	checked := 0
	for seed := range int64(4) {
		normal := dojoGame(t, st, seed, DojoOptions{Yaku: allYaku})
		before, _ := st.Create(&seed, Options{CPU: cpu.Weak})
		dojo := dojoGame(t, st, seed, DojoOptions{Yaku: learned})
		after, _ := st.Create(&seed, Options{CPU: cpu.Weak})
		if !reflect.DeepEqual(before.State().Combos, after.State().Combos) {
			t.Fatalf("seed %d: a dojo game changed a standard game's combos", seed)
		}
		riichi := [2]bool{}
		for steps := 0; ; steps++ {
			n, d := normal.State(), dojo.State()
			for _, r := range d.Analysis {
				if r.Key == "honitsu" && r.Han != 0 {
					t.Fatalf("seed %d: honitsu row at %d han", seed, r.Han)
				}
			}
			byDiscard := map[string][2][]apiview.ComboRow{"": {n.Combos, d.Combos}}
			for k, cs := range n.CombosByDiscard {
				byDiscard[k] = [2][]apiview.ComboRow{cs, d.CombosByDiscard[k]}
			}
			for k, cs := range byDiscard {
				for _, c := range cs[1] {
					if slices.Contains(c.Keys, "honitsu") {
						t.Fatalf("seed %d %s: combo %v", seed, k, c.Keys)
					}
				}
				if len(cs[0]) == yakushanten.MaxCombos && slices.ContainsFunc(cs[0], func(c apiview.ComboRow) bool { return slices.Contains(c.Keys, "honitsu") }) {
					checked++
					if len(cs[1]) != yakushanten.MaxCombos {
						t.Fatalf("seed %d %s: %d combos without honitsu", seed, k, len(cs[1]))
					}
				}
			}
			if a := d.Advice; a != nil {
				for _, y := range a.NearYaku {
					if y.Key == "honitsu" {
						t.Fatalf("seed %d: near yaku honitsu", seed)
					}
				}
				for _, c := range a.Candidates {
					if slices.Contains(c.Yaku, "混一色") {
						t.Fatalf("seed %d: candidate yaku %v", seed, c.Yaku)
					}
				}
			}
			if n.Result != nil || d.Result != nil || steps > 100 {
				break
			}
			if _, err := normal.Act(move(n, &riichi[0])); err != nil {
				t.Fatal(err)
			}
			if _, err := dojo.Act(move(d, &riichi[1])); err != nil {
				t.Fatal(err)
			}
		}
	}
	if checked == 0 {
		t.Fatal("no state had honitsu among the top combos")
	}
}

// redrawMove redraws once a round when it may, else plays move.
func redrawMove(st State, riichi *bool) game.Action {
	if st.Legal.Redraw {
		return game.Action{Type: game.Redraw}
	}
	return move(st, riichi)
}

// A dojo game with redraws: the summaries count the redraws and the han of
// the human's wins without dora, and the save restores the same game.
func TestDojoRoundSummaryAndRestore(t *testing.T) {
	st := NewStore(64)
	won, redrew := false, false
	for seed := int64(0); seed < 20 && (!won || !redrew); seed++ {
		m := dojoGame(t, st, seed, DojoOptions{Yaku: allYaku, RedrawsPerRound: 1})
		s, riichi, redraws := m.State(), false, 0
		for steps := 0; s.Result == nil; steps++ {
			if steps > 100 {
				t.Fatal("round does not end")
			}
			a := redrawMove(s, &riichi)
			if a.Type == game.Redraw {
				redraws++
				if n := len(m.game.Round.Events()); n == 0 {
					t.Fatal("no events")
				}
			}
			var err error
			if s, err = m.Act(a); err != nil {
				t.Fatal(err)
			}
			if a.Type == game.Redraw {
				if s.Legal.Redraw {
					t.Fatal("a second redraw offered")
				}
				restored(t, st, m) // the same position and Check
			}
		}
		sum := s.Rounds[len(s.Rounds)-1]
		if sum.Redraws != redraws {
			t.Fatalf("seed %d: summary redraws %d, made %d", seed, sum.Redraws, redraws)
		}
		redrew = redrew || redraws > 0
		if r := s.Result; r.Winner == Human {
			won = true
			han := 0
			for _, y := range r.Yaku {
				han += y.Han
			}
			if sum.Han != han || han == 0 {
				t.Fatalf("seed %d: summary han %d, yaku han %d (total %d, dora %d)", seed, sum.Han, han, r.Han, r.Dora)
			}
		} else if sum.Han != 0 {
			t.Fatalf("seed %d: han %d without a win", seed, sum.Han)
		}
		restored(t, st, m)
	}
	if !won || !redrew {
		t.Fatalf("won %v, redrew %v", won, redrew)
	}
}

// A dojo win reports the yaku it left out.
func TestDojoResultExcluded(t *testing.T) {
	st := NewStore(64)
	dropped := []string{"tsumo", "tanyao", "pinfu"}
	human := cpu.New()
	for seed := int64(0); seed < 40; seed++ {
		m := dojoGame(t, st, seed, DojoOptions{Yaku: without(allYaku, dropped...)})
		s := m.State()
		for steps := 0; s.Result == nil; steps++ {
			if steps > 100 {
				t.Fatal("round does not end")
			}
			r := m.game.Round
			a := human.Decide(r.ViewFor(Human), r.LegalFor(Human))
			var err error
			if s, err = m.Act(a); err != nil {
				riichi := true
				if s, err = m.Act(move(m.State(), &riichi)); err != nil {
					t.Fatal(err)
				}
			}
		}
		if r := s.Result; r.Winner == Human && len(r.Excluded) > 0 {
			for _, k := range r.Excluded {
				if !slices.Contains(dropped, k) || slices.ContainsFunc(r.Yaku, func(y yaku.Yaku) bool { return y.Key == k }) {
					t.Fatalf("seed %d: yaku %v excluded %v", seed, r.Yaku, r.Excluded)
				}
			}
			return
		}
	}
	t.Fatal("no human win left a yaku out")
}

// The ura peek shows the ura-dora indicators during a round, the ones the
// round's end reveals, and changes nothing else.
func TestDojoUraPeek(t *testing.T) {
	st := NewStore(16)
	for seed := range int64(4) {
		plain := dojoGame(t, st, seed, DojoOptions{Yaku: starter})
		peek := dojoGame(t, st, seed, DojoOptions{Yaku: starter, UraPeek: true})
		a, b := plain.State(), peek.State()
		if len(a.UraDoraIndicators) != 0 || len(b.UraDoraIndicators) != 1 || len(b.UraDora) != 1 {
			t.Fatalf("seed %d: ura %v without peek, %v %v with it", seed, a.UraDoraIndicators, b.UraDoraIndicators, b.UraDora)
		}
		if !reflect.DeepEqual(a.Remaining, b.Remaining) || !reflect.DeepEqual(a.Analysis, b.Analysis) {
			t.Fatalf("seed %d: the ura peek changed what counts as seen", seed)
		}
		end := playOut(t, plain)
		if len(end.UraDoraIndicators) == 0 || end.UraDoraIndicators[0] != b.UraDoraIndicators[0] {
			t.Fatalf("seed %d: peeked %v, revealed %v", seed, b.UraDoraIndicators, end.UraDoraIndicators)
		}
	}
}

// The riichi waits peek shows the waits of each other seat in riichi, and
// only theirs.
func TestDojoRiichiWaits(t *testing.T) {
	st := NewStore(64)
	seen := 0
	for seed := int64(0); seed < 20 && seen == 0; seed++ {
		m := dojoGame(t, st, seed, DojoOptions{Yaku: starter, RiichiWaits: true})
		plain := dojoGame(t, st, seed, DojoOptions{Yaku: starter})
		s, riichi := m.State(), false
		for steps := 0; s.Result == nil; steps++ {
			if steps > 100 {
				t.Fatal("round does not end")
			}
			for i, seat := range s.Seats {
				var want []string
				if i != Human && seat.Riichi {
					for _, k := range m.game.Round.WaitsOf(i) {
						want = append(want, k.String())
					}
					seen++
					if len(want) == 0 {
						t.Fatalf("seed %d: seat %d in riichi with no waits", seed, i)
					}
				}
				if !slices.Equal(seat.Waits, want) {
					t.Fatalf("seed %d: seat %d waits %v, want %v", seed, i, seat.Waits, want)
				}
			}
			a := move(s, &riichi)
			var err error
			if s, err = m.Act(a); err != nil {
				t.Fatal(err)
			}
			p, err := plain.Act(a)
			if err != nil {
				t.Fatal(err)
			}
			for _, seat := range p.Seats {
				if seat.Waits != nil {
					t.Fatalf("seed %d: waits %v without the peek", seed, seat.Waits)
				}
			}
		}
		for _, seat := range s.Seats {
			if seat.Waits != nil {
				t.Fatalf("seed %d: waits %v after the round", seed, seat.Waits)
			}
		}
	}
	if seen == 0 {
		t.Fatal("no CPU seat declared riichi")
	}
}

// melds counts the called melds on the table.
func melds(s State) int {
	n := 0
	for _, seat := range s.Seats {
		n += len(seat.Melds)
	}
	return n
}

// The wall peek foretells your next draws: with no call or kan in between,
// your next draw is the first of them.
func TestDojoWallPeek(t *testing.T) {
	st := NewStore(64)
	checked := 0
	for seed := range int64(6) {
		m := dojoGame(t, st, seed, DojoOptions{Yaku: starter, WallPeek: 3})
		s := m.State()
		var foretold []string
		calls := 0
		for steps := 0; s.Result == nil; steps++ {
			if steps > 100 {
				t.Fatal("round does not end")
			}
			if len(s.MyNextDraws) > 3 || (s.WallRemaining >= 12 && len(s.MyNextDraws) != 3) {
				t.Fatalf("seed %d: next draws %v with %d left", seed, s.MyNextDraws, s.WallRemaining)
			}
			if s.Phase == game.PhaseDiscard && s.Actor == Human && s.Seats[Human].Drawn != nil {
				if foretold != nil && melds(s) == calls {
					if *s.Seats[Human].Drawn != foretold[0] {
						t.Fatalf("seed %d: drew %s, foretold %v", seed, *s.Seats[Human].Drawn, foretold)
					}
					checked++
				}
				foretold, calls = s.MyNextDraws, melds(s)
			}
			var err error
			if s, err = m.Act(move(s, new(bool))); err != nil {
				t.Fatal(err)
			}
		}
		if s.MyNextDraws != nil {
			t.Fatalf("seed %d: next draws %v after the round", seed, s.MyNextDraws)
		}
	}
	if checked < 10 {
		t.Fatalf("only %d draws checked", checked)
	}
}

// A dojo game with summons: the summoned kind is drawn, the summary counts
// the summons, CPUs are never offered one and the save restores the game.
func TestDojoSummon(t *testing.T) {
	st := NewStore(64)
	summoned := 0
	for seed := range int64(4) {
		m := dojoGame(t, st, seed, DojoOptions{Yaku: starter, SummonsPerRound: 1})
		s, riichi, n := m.State(), false, 0
		for steps := 0; s.Result == nil; steps++ {
			if steps > 100 {
				t.Fatal("round does not end")
			}
			a := move(s, &riichi)
			if len(s.Legal.Summon) > 0 {
				kind := s.Legal.Summon[len(s.Legal.Summon)/2]
				a = game.Action{Type: game.Summon, Tile: kind}
				var err error
				if s, err = m.Act(a); err != nil {
					t.Fatal(err)
				}
				n++
				if d := s.Seats[Human].Drawn; d == nil || strings.Replace(*d, "0", "5", 1) != kind {
					t.Fatalf("seed %d: summoned %s, drew %v", seed, kind, d)
				}
				if s.Legal.Summon != nil {
					t.Fatal("a second summon offered")
				}
				if e := s.Events[len(s.Events)-1]; e.Type != game.Summon || e.Tile != "" {
					t.Fatalf("seed %d: event %+v", seed, e)
				}
				restored(t, st, m)
				continue
			}
			var err error
			if s, err = m.Act(a); err != nil {
				t.Fatal(err)
			}
		}
		if sum := s.Rounds[len(s.Rounds)-1]; sum.Summons != n {
			t.Fatalf("seed %d: summary summons %d, made %d", seed, sum.Summons, n)
		}
		summoned += n
		restored(t, st, m)
	}
	if summoned == 0 {
		t.Fatal("no summon made")
	}
}
