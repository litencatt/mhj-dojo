package cpu

import (
	"reflect"
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/testmode"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
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
	// Far from tenpai, seat 1 in riichi with 5s and 8m in its river.
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
		t.Errorf("tenpai hand folded: %+v", a)
	}
	// One step from tenpai (below foldShanten) it pushes too: it keeps 123m
	// although 2m is genbutsu.
	v3 := view("123m456m789m23p5s1z", "9s")
	v3.Seats[1].Riichi = true
	x, _ := tile.Parse("2m")
	v3.Seats[1].River = []game.RiverTile{{Tile: x}}
	if a := New().Decide(v3, legal(v3)); a.Tile == "2m" {
		t.Errorf("1-shanten hand folded: %+v", a)
	}
}

// The weak player still wins and declares riichi, but skips every call
// offer and never declares a kan.
func TestWeakPlayer(t *testing.T) {
	v := view("123m456m789m23p55s", "1p")
	if a := NewWeak().Decide(v, game.Legal{Tsumo: true, Discards: []string{"1p"}}); a.Type != game.Tsumo {
		t.Errorf("tsumo: got %+v", a)
	}
	if a := NewWeak().Decide(v, game.Legal{Ron: true, Skip: true}); a.Type != game.Ron {
		t.Errorf("ron: got %+v", a)
	}
	v = view("123m456m789m23p55s", "1z")
	l := legal(v)
	l.Riichi = []string{"1z"}
	if a := NewWeak().Decide(v, l); a.Type != game.Riichi || a.Tile != "1z" {
		t.Errorf("tenpai: got %+v, want riichi 1z", a)
	}
	// Pon of a dragon, which the normal player takes.
	v = view("123m456m78p5s77z", "1z")
	v.Seats[0].Drawn = nil
	d, _ := tile.Parse("7z")
	v.LastDiscard = &d
	if a := New().Decide(v, game.Legal{Skip: true, Pon: true}); a.Type != game.Pon {
		t.Fatalf("normal: got %+v, want pon", a)
	}
	if a := NewWeak().Decide(v, game.Legal{Skip: true, Pon: true}); a.Type != game.Skip {
		t.Errorf("weak: got %+v, want skip", a)
	}
	v = view("1111m456m789m23p5s", "1z")
	l = legal(v)
	l.Kan = []string{"1m"}
	if a := NewWeak().Decide(v, l); a.Type == game.Kan {
		t.Errorf("weak declared a kan: %+v", a)
	}
}

func TestKeepsRedFive(t *testing.T) {
	// Discarding 0p or 5p leaves the same counts, so only the red-five
	// tiebreak orders them: the red five is dora and is kept.
	tiles := tile.MustParseHand("123m456m789m11s0p5p1z")
	var vis tile.Counts
	for _, order := range [][]string{{"0p", "5p"}, {"5p", "0p"}} {
		opts := New().byEfficiency(tiles, 0, order, &vis)
		if opts[0].tile != "5p" {
			t.Errorf("discards %v: first choice %s, want 5p", order, opts[0].tile)
		}
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
	vis[k("3z")] = 4
	for s, want := range map[string]int{"4m": 0, "3z": 0, "1z": 1, "1m": 2, "7m": 2, "4p": 2, "5m": 9, "5p": 9, "2z": 6, "9s": 7, "7s": 9} {
		if got := danger(k(s), river, &vis); got != want {
			t.Errorf("danger(%s) = %d, want %d", s, got, want)
		}
	}
}

// All four seats are CPU players: every move is legal, the points stay
// balanced, rounds end with both wins and draws, and a decision is fast.
func TestSelfPlay(t *testing.T) {
	n := testmode.N(1000, 200, 100)
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
					kind, _ := playSeed(t, p, seed)
					mu.Lock()
					kinds[kind]++
					mu.Unlock()
				}
			})
		}
	})
	if kinds["tsumo"] == 0 || kinds["ron"] == 0 || kinds["draw"] == 0 {
		t.Errorf("outcomes %v: want tsumo, ron and draw", kinds)
	}
	// Time decisions on one goroutine, so waiting for a core is not counted.
	p := New()
	for seed := range testmode.N(int64(50), 20, 5) {
		_, times := playSeed(t, p, seed)
		took = append(took, times...)
	}
	slices.Sort(took)
	p95 := took[len(took)*95/100]
	t.Logf("outcomes %v, decision p95 %v", kinds, p95)
	if !testing.Short() && !raceEnabled && p95 > 20*time.Millisecond {
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

// Two games from the same seed with the same human moves play out exactly
// the same with the real CPU, and the log replays onto a fresh round.
func TestGameReplaysWithCPU(t *testing.T) {
	n := testmode.N(int64(30), 10, 5)
	for seed := range n {
		a, b := playGame(t, seed), playGame(t, seed)
		if !reflect.DeepEqual(a.Round.Log(), b.Round.Log()) {
			t.Fatalf("seed %d: logs differ", seed)
		}
		r := game.New(seed)
		for _, act := range a.Round.Log() {
			if err := r.Apply(act); err != nil {
				t.Fatalf("seed %d: replay %+v: %v", seed, act, err)
			}
		}
		if !reflect.DeepEqual(r.ViewFor(0), a.Round.ViewFor(0)) {
			t.Fatalf("seed %d: replay differs", seed)
		}
		if a.Fallbacks != 0 {
			t.Fatalf("seed %d: %d CPU fallbacks", seed, a.Fallbacks)
		}
	}
}

// playGame plays seat 0 by discarding the drawn tile (winning when it can)
// against three fresh CPU players.
func playGame(t *testing.T, seed int64) *game.Game {
	t.Helper()
	g := game.NewGame(seed, New())
	for steps := 0; g.Round.Actor() >= 0; steps++ {
		if steps > 200 {
			t.Fatalf("seed %d: game does not end", seed)
		}
		if err := g.Act(game.Tsumogiri{}.Decide(g.Round.ViewFor(0), g.Round.LegalFor(0))); err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
	}
	return g
}

// Right after a call there is no drawn tile, and the shanten counts the
// called meld: 234m 567m 34s 66s + pon 8p is tenpai once 1z goes.
func TestDecideAfterACall(t *testing.T) {
	var v game.View
	for s := range v.Seats {
		v.Seats[s].Seat = s
	}
	v.Seats[0].Hand = tile.MustParseHand("234m567m34s66s1z")
	k, _ := tile.Parse("8p")
	v.Seats[0].Melds = []game.Called{{Meld: yaku.Meld{Type: yaku.Trip, Kind: k.Kind, Open: true}, Tiles: []tile.Tile{k, k, k}, From: 2}}
	l := game.Legal{Discards: []string{"2m", "3m", "4m", "5m", "6m", "7m", "3s", "4s", "6s", "1z"}}
	a := New().Decide(v, l)
	if a.Type != game.Discard || a.Tile != "1z" {
		t.Fatalf("got %+v, want discard 1z", a)
	}
	if sh, _ := New().shanten(tile.MustCounts("234m567m34s66s"), 1); sh != 0 {
		t.Fatalf("open hand shanten %d, want tenpai", sh)
	}
}

// Whole games with four CPU players: every move is legal, points plus sticks
// stay at 100000 at the end of each round, every game ends, and the logs
// replay to the same standings.
func TestHanchanSelfPlay(t *testing.T) {
	n := testmode.N(64, 16, 8)
	const workers = 8
	for w := range workers {
		t.Run(strconv.Itoa(w), func(t *testing.T) {
			t.Parallel()
			p := New()
			for seed := int64(w); seed < int64(n); seed += workers {
				rules := game.Tonpuu
				if seed%4 == 3 {
					rules = game.HanchanRule
				}
				playHanchan(t, game.NewHanchan(seed, rules), [4]*Player{p, p, p, p})
			}
		})
	}
}

// playHanchan plays h to the end with a player per seat, checking that
// every move is legal, points plus sticks stay at 100000 after each round,
// the game ends and the scores add up to zero.
func playHanchan(t *testing.T, h *game.Hanchan, players [4]*Player) {
	t.Helper()
	seed := h.Seed()
	for rounds := 1; ; rounds++ {
		if rounds > 60 {
			t.Fatalf("seed %d: game does not end", seed)
		}
		r := h.Round()
		for steps := 0; r.Actor() >= 0; steps++ {
			if steps > 1000 {
				t.Fatalf("seed %d: round does not end", seed)
			}
			seat := r.Actor()
			a := players[seat].Decide(r.ViewFor(seat), r.LegalFor(seat))
			a.Seat = seat
			if err := r.Apply(a); err != nil {
				t.Fatalf("seed %d: illegal CPU move %+v: %v", seed, a, err)
			}
		}
		sum := r.Result().Deposit
		for _, s := range r.ViewFor(0).Seats {
			sum += s.Points
		}
		if sum != 100000 {
			t.Fatalf("seed %d round %d: points + sticks = %d", seed, rounds, sum)
		}
		if h.Over() {
			break
		}
		if err := h.Next(); err != nil {
			t.Fatal(err)
		}
	}
	total := 0.0
	for _, st := range h.Standings() {
		total += st.Score
	}
	if total < -0.5 || total > 0.5 {
		t.Fatalf("seed %d: scores add up to %v", seed, total)
	}
}

// Whole games with four weak players: the same checks as above, the weak
// player never calls, and a game played twice from the same seed gives the
// same logs, which replay onto a fresh game.
func TestWeakSelfPlay(t *testing.T) {
	n := testmode.N(int64(12), 4, 4)
	rounds := 0
	for seed := range n {
		var logs [2][][]game.Action
		for i := range logs {
			h := game.NewHanchanFrom(seed, game.Tonpuu, int(seed%4))
			w := NewWeak()
			playHanchan(t, h, [4]*Player{w, w, w, w})
			logs[i] = h.Logs()
		}
		if !reflect.DeepEqual(logs[0], logs[1]) {
			t.Fatalf("seed %d: logs differ", seed)
		}
		rounds += len(logs[0])
		again := game.NewHanchanFrom(seed, game.Tonpuu, int(seed%4))
		for i, log := range logs[0] {
			for _, a := range log {
				switch a.Type {
				case game.Pon, game.Chii, game.Kan:
					t.Fatalf("seed %d: the weak player made a call %+v", seed, a)
				}
				if err := again.Round().Apply(a); err != nil {
					t.Fatalf("seed %d: replay %+v: %v", seed, a, err)
				}
			}
			if i < len(logs[0])-1 {
				if err := again.Next(); err != nil {
					t.Fatalf("seed %d: replay next: %v", seed, err)
				}
			}
		}
		if !again.Over() {
			t.Fatalf("seed %d: the replay did not end", seed)
		}
	}
	t.Logf("%d rounds", rounds)
}

// The weak player loses to the normal one: at a table of two of each
// (seats swapped every other game), the normal players win more rounds and
// finish with more points.
func TestWeakPlaysWorse(t *testing.T) {
	if !testmode.Full() {
		t.Skip("plays many games; run with MHJ2_FULL=1 (the nightly workflow)")
	}
	var wins, points [2]int // index 0 normal, 1 weak
	for seed := range int64(40) {
		normal, weak := New(), NewWeak()
		players := [4]*Player{normal, weak, normal, weak}
		if seed%2 == 1 {
			players = [4]*Player{weak, normal, weak, normal}
		}
		h := game.NewHanchan(seed, game.Tonpuu)
		playHanchan(t, h, players)
		level := func(s int) int { return b2i(players[s] == weak) }
		for _, log := range h.Logs() {
			for _, a := range log {
				if a.Type == game.Tsumo || a.Type == game.Ron {
					wins[level(a.Seat)]++
				}
			}
		}
		for s, st := range h.Standings() {
			points[level(s)] += st.Points
		}
	}
	t.Logf("wins normal %d weak %d, points normal %d weak %d", wins[0], wins[1], points[0], points[1])
	if wins[0] < wins[1]*5/4 || points[0] <= points[1] {
		t.Errorf("the weak player is not weaker: wins %v, points %v", wins, points)
	}
}

func TestKyuushu(t *testing.T) {
	v := view("19m19p19s12z56788m", "3z") // nine kinds: declare
	l := legal(v)
	l.Kyuushu = true
	if a := New().Decide(v, l); a.Type != game.Kyuushu {
		t.Fatalf("nine kinds: got %+v", a)
	}
	v = view("19m19p19s1234567z", "1m") // thirteen kinds and a pair: go for kokushi
	l = legal(v)
	l.Kyuushu = true
	if a := New().Decide(v, l); a.Type == game.Kyuushu {
		t.Fatal("declared kyuushu on a kokushi tenpai-level hand")
	}
}

// callView is seat 0 facing a discard of s from seat 3 in the call phase.
func callView(hand, s string) game.View {
	var v game.View
	for i := range v.Seats {
		v.Seats[i].Seat = i
		v.Seats[i].Wind = tile.East + tile.Kind(i)
	}
	v.RoundWind = tile.East
	v.Seats[0].Hand = tile.MustParseHand(hand)
	d, _ := tile.Parse(s)
	v.LastDiscard = &d
	return v
}

func TestCallDecisions(t *testing.T) {
	cases := []struct {
		name, hand, discard string
		legal               game.Legal
		want                game.ActionType
	}{
		// a value pon (白) that does not set the hand back
		{"value pon", "5z5z123m456p78s19m", "5z", game.Legal{Pon: true, Skip: true}, game.Pon},
		// a pon with no yaku left (terminals everywhere): skip
		{"no yaku", "1m1m9m9p1s3z4z567p78s", "1m", game.Legal{Pon: true, Skip: true}, game.Skip},
		// tanyao chii that brings the hand closer: 34m + 5m, simples only
		{"tanyao chii", "34m678m456p2233s8s", "5m", game.Legal{Chii: [][]string{{"3m", "4m"}}, Skip: true}, game.Chii},
		// a chii that does not help: skip
		{"useless chii", "34m5m678m456p223s8s", "2m", game.Legal{Chii: [][]string{{"3m", "4m"}}, Skip: true}, game.Skip},
	}
	for _, tc := range cases {
		v := callView(tc.hand, tc.discard)
		if a := New().Decide(v, tc.legal); a.Type != tc.want {
			t.Errorf("%s: got %+v, want %s", tc.name, a, tc.want)
		}
	}
	// folding against a riichi: no call even on a value tile
	v := callView("5z5z147m258p369s1z", "5z")
	v.Seats[1].Riichi = true
	if a := New().Decide(v, game.Legal{Pon: true, Skip: true}); a.Type != game.Skip {
		t.Errorf("called while folding: %+v", a)
	}
}

// Whole rounds with four CPU players now include calls and wins on open
// hands, with every move legal.
func TestSelfPlayCalls(t *testing.T) {
	n := testmode.N(int64(150), 60, 30)
	p := New()
	calls, openWins := 0, 0
	for seed := range n {
		r := game.New(seed)
		for r.Actor() >= 0 {
			seat := r.Actor()
			a := p.Decide(r.ViewFor(seat), r.LegalFor(seat))
			a.Seat = seat
			if err := r.Apply(a); err != nil {
				t.Fatalf("seed %d: %+v: %v", seed, a, err)
			}
		}
		for _, e := range r.Events() {
			if e.Type == game.Pon || e.Type == game.Chii || e.Type == game.Kan {
				calls++
			}
		}
		if res := r.Result(); res.Winner >= 0 && len(r.ViewFor(res.Winner).Seats[res.Winner].Melds) > 0 {
			openWins++
		}
	}
	if calls == 0 || openWins == 0 {
		t.Fatalf("%d calls, %d open wins", calls, openWins)
	}
	t.Logf("%d calls, %d wins with melds in %d rounds", calls, openWins, n)
}
