package cpu

import (
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/tile"
)

func view(hand, drawn string) game.View {
	var v game.View
	for s := range v.Seats {
		v.Seats[s].Seat = s
	}
	d, _ := tile.Parse(drawn)
	v.Seats[0].Hand = tile.MustParseHand(hand)
	v.Seats[0].Drawn = &d
	return v
}

func legal(v game.View) game.Legal {
	me := v.Seats[0]
	l := game.Legal{}
	for _, t := range append(slices.Clone(me.Hand), *me.Drawn) {
		if !slices.Contains(l.Discards, t.String()) {
			l.Discards = append(l.Discards, t.String())
		}
	}
	return l
}

func TestTakesWins(t *testing.T) {
	v := view("123m456m789m23p55s", "1p")
	if a := New().Decide(v, game.Legal{Tsumo: true, Discards: []string{"1p"}}); a.Type != game.Tsumo {
		t.Errorf("tsumo: got %+v", a)
	}
	if a := New().Decide(v, game.Legal{Ron: true, Skip: true}); a.Type != game.Ron {
		t.Errorf("ron: got %+v", a)
	}
}

func TestDiscardsForEfficiencyAndRiichi(t *testing.T) {
	v := view("123m456m789m23p55s", "1z")
	l := legal(v)
	l.Riichi = []string{"1z"}
	if a := New().Decide(v, l); a.Type != game.Riichi || a.Tile != "1z" {
		t.Errorf("tenpai discard: got %+v, want riichi 1z", a)
	}
	// Without riichi allowed it still discards the isolated honor.
	if a := New().Decide(v, legal(v)); a.Type != game.Discard || a.Tile != "1z" {
		t.Errorf("got %+v, want discard 1z", a)
	}
	// 1-shanten: keep the shapes, drop the isolated 9s over any meld tile.
	v = view("123m456m78m23p55s1z", "9s")
	a := New().Decide(v, legal(v))
	if a.Tile != "1z" && a.Tile != "9s" {
		t.Errorf("got %+v, want 1z or 9s", a)
	}
}

func TestFoldsAgainstRiichi(t *testing.T) {
	// Far from tenpai, seat 1 in riichi with 5s and 1z in its river.
	v := view("147m258p369s1357z", "5s")
	v.Seats[1].Riichi = true
	for _, s := range []string{"5s", "8m"} {
		x, _ := tile.Parse(s)
		v.Seats[1].River = append(v.Seats[1].River, game.RiverTile{Tile: x})
	}
	if a := New().Decide(v, legal(v)); a.Tile != "5s" {
		t.Errorf("got %+v, want genbutsu 5s", a)
	}
	// Tenpai, it keeps pushing (and would declare riichi) instead.
	v2 := view("123m456m789m23p55s", "1z")
	v2.Seats[1] = v.Seats[1]
	if a := New().Decide(v2, legal(v2)); a.Tile == "5s" {
		t.Errorf("1-shanten hand folded: %+v", a)
	}
}

func TestDanger(t *testing.T) {
	river := map[tile.Kind]bool{}
	for _, s := range []string{"4m", "1p", "7p"} {
		x, _ := tile.Parse(s)
		river[x.Kind] = true
	}
	var vis tile.Counts
	k := func(s string) tile.Kind { x, _ := tile.Parse(s); return x.Kind }
	vis[k("1z")] = 3
	for s, want := range map[string]int{"4m": 0, "1z": 1, "1m": 2, "7m": 2, "4p": 2, "5m": 9, "5p": 9, "2z": 6, "9s": 7, "7s": 9} {
		if got := danger(k(s), river, &vis); got != want {
			t.Errorf("danger(%s) = %d, want %d", s, got, want)
		}
	}
}

// All four seats are CPU players: every move is legal, the points stay
// balanced, rounds end with both wins and draws, and a decision is fast.
func TestSelfPlay(t *testing.T) {
	n := 1000
	if testing.Short() {
		n = 100
	}
	const workers = 8
	var mu sync.Mutex
	kinds := map[string]int{}
	var took []time.Duration
	t.Run("play", func(t *testing.T) {
		for w := range workers {
			t.Run(strconv.Itoa(w), func(t *testing.T) {
				t.Parallel()
				p := New()
				for seed := int64(w); seed < int64(n); seed += workers {
					kind, times := playSeed(t, p, seed)
					mu.Lock()
					kinds[kind]++
					took = append(took, times...)
					mu.Unlock()
				}
			})
		}
	})
	if kinds["tsumo"] == 0 || kinds["ron"] == 0 || kinds["draw"] == 0 {
		t.Errorf("outcomes %v: want tsumo, ron and draw", kinds)
	}
	slices.Sort(took)
	p95 := took[len(took)*95/100]
	t.Logf("outcomes %v, decision p95 %v", kinds, p95)
	if !testing.Short() && p95 > 20*time.Millisecond {
		t.Errorf("decision p95 %v, want < 20ms", p95)
	}
}

// playSeed plays one all-CPU round and returns how it ended and how long
// each decision took.
func playSeed(t *testing.T, p *Player, seed int64) (string, []time.Duration) {
	t.Helper()
	r := game.New(seed)
	var took []time.Duration
	for steps := 0; r.Actor() >= 0; steps++ {
		if steps > 1000 {
			t.Fatalf("seed %d: round does not end", seed)
		}
		seat := r.Actor()
		start := time.Now()
		a := p.Decide(r.ViewFor(seat), r.LegalFor(seat))
		took = append(took, time.Since(start))
		a.Seat = seat
		if err := r.Apply(a); err != nil {
			t.Fatalf("seed %d: illegal CPU move %+v: %v", seed, a, err)
		}
	}
	res := r.Result()
	sum := res.Deposit
	for _, s := range r.ViewFor(0).Seats {
		sum += s.Points
	}
	if sum != 4*game.StartPoints {
		t.Fatalf("seed %d: points sum %d", seed, sum)
	}
	return res.Kind, took
}
