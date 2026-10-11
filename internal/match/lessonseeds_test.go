package match

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"sort"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/handshape"
	"github.com/litencatt/mhj-dojo/internal/session"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/webts"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// The curriculum's seeds (web/src/dojo/lessonSeeds.json, #320): for each
// lesson, a seed on which a simulated player passes it soon, so that the
// curriculum's links deal one. The judges here follow lessons.ts's.
//
//   - A practice lesson (stages 0 and 1) is played on practice mode's deal
//     by a player who discards for efficiency (lowest shanten, most ukeire):
//     the seed is the one where it succeeds at the earliest discard (for
//     受け入れの多い方を残す, where five discards in a row have a real choice).
//   - A game lesson (stages 2 to 5) is a dojo 東風戦 against weak CPUs, every
//     yaku counted, played by the normal CPU, the normal CPU without calls
//     (menzen) or the normal CPU taking every pon (pon): the seed is the one
//     where it succeeds in the earliest round (as many rounds as the lesson
//     needs successes).
//
// PR runs check that every seed in the file still passes its lesson as
// recorded; MHJDOJO_FULL=1 also searches again and requires the same file.
// To regenerate after a change to the deal, the CPU or the analysis:
//
//	UPDATE_LESSON_SEEDS=1 go test ./internal/match -run TestLessonSeeds

const (
	lessonSeedsFile = "src/dojo/lessonSeeds.json"
	// The seeds searched: 1..practiceSeedRange for practice, 1..gameSeedRange for games.
	practiceSeedRange = 1000
	gameSeedRange     = 400
	// practiceTurns is a lesson's practice length (lessons.ts lessonHref's turns=18).
	practiceTurns = 18
)

// lessonSeed is a lesson's seed: the discard (practice) or the round (a
// game, from 0) where the player passes it, and the game's player.
type lessonSeed struct {
	Seed   int    `json:"seed"`
	At     int    `json:"at"`
	Player string `json:"player,omitempty"`
}

type lessonSeedTable struct {
	PracticeRange int                   `json:"practice_range"`
	GameRange     int                   `json:"game_range"`
	Seeds         map[string]lessonSeed `json:"seeds"`
	// Missing are the lessons without a seed found: the curriculum deals them at random.
	Missing []string `json:"missing"`
}

// ---- Practice lessons ----

// practiceJudge judges a practice step as lessons.ts does: nil when not judged.
type practiceJudge func(before *session.State, discard string, after *session.State) *bool

func verdict(b bool) *bool { return &b }

func kindOf(s string) string {
	if s != "" && s[0] == '0' {
		return "5" + s[1:]
	}
	return s
}

func normalRow(rows []apiview.DiscardRow) *apiview.DiscardRow {
	for i := range rows {
		if rows[i].Key == "normal" {
			return &rows[i]
		}
	}
	return nil
}

func normalShanten(s *session.State) *int {
	for _, r := range s.Analysis {
		if r.Key == "normal" {
			return r.Shanten
		}
	}
	return nil
}

// bestDiscards is lessons.ts's: the kinds with the lowest normal shanten and the most ukeire.
func bestDiscards(s *session.State) []string {
	low, most := 99, -1
	for _, rs := range s.ByDiscard {
		if n := normalRow(rs); n != nil && n.Shanten != nil && *n.Shanten < low {
			low = *n.Shanten
		}
	}
	for _, rs := range s.ByDiscard {
		if n := normalRow(rs); n != nil && n.Shanten != nil && *n.Shanten == low {
			most = max(most, n.UkeireTotal)
		}
	}
	var out []string
	for t, rs := range s.ByDiscard {
		if n := normalRow(rs); n != nil && n.Shanten != nil && *n.Shanten == low && n.UkeireTotal == most {
			out = append(out, kindOf(t))
		}
	}
	sort.Strings(out)
	return out
}

// realChoice reports whether some discard keeping the lowest shanten has fewer ukeire than the best.
func realChoice(s *session.State) bool {
	best := bestDiscards(s)
	if len(best) == 0 {
		return false
	}
	low := *normalRow(s.ByDiscard[firstKey(s.ByDiscard, best[0])]).Shanten
	for t, rs := range s.ByDiscard {
		if n := normalRow(rs); n != nil && n.Shanten != nil && *n.Shanten == low && !slices.Contains(best, kindOf(t)) {
			return true
		}
	}
	return false
}

func firstKey(m map[string][]apiview.DiscardRow, k string) string {
	for t := range m {
		if kindOf(t) == k {
			return t
		}
	}
	return k
}

// tenpaiDiscards is lessons.ts's: each discard leaving tenpai, and whether its wait is furiten.
func tenpaiDiscards(s *session.State) (furiten, clean bool) {
	var river []string
	for _, d := range s.Discards {
		river = append(river, kindOf(d))
	}
	for t, rs := range s.ByDiscard {
		n := normalRow(rs)
		if n == nil || n.Shanten == nil || *n.Shanten != 0 {
			continue
		}
		discarded := append(slices.Clone(river), kindOf(t))
		if slices.ContainsFunc(n.Ukeire, func(w string) bool { return slices.Contains(discarded, kindOf(w)) }) {
			furiten = true
		} else {
			clean = true
		}
	}
	return furiten, clean
}

var practiceLessons = map[string]struct {
	times int
	judge practiceJudge
}{
	"shape-win": {1, func(_ *session.State, _ string, after *session.State) *bool {
		if after.Status == session.StatusPlaying {
			return nil
		}
		return verdict(after.Status == session.StatusTsumo && after.Win != nil)
	}},
	"ryanmen-tenpai": {1, func(before *session.State, discard string, after *session.State) *bool {
		if before == nil || discard == "" {
			return nil
		}
		if sh := normalShanten(after); sh == nil || *sh != 0 {
			return nil
		}
		return verdict(slices.ContainsFunc(after.HandGroups, func(g apiview.HandGroup) bool { return g.Type == handshape.Ryanmen }))
	}},
	// Judged on every discard; counted here only where there is a real choice to make.
	"max-ukeire": {5, func(before *session.State, discard string, _ *session.State) *bool {
		if before == nil || discard == "" || !realChoice(before) {
			return nil
		}
		return verdict(slices.Contains(bestDiscards(before), kindOf(discard)))
	}},
	"furiten": {1, func(before *session.State, discard string, _ *session.State) *bool {
		if before == nil || discard == "" {
			return nil
		}
		f, c := tenpaiDiscards(before)
		if !f || !c {
			return nil
		}
		// The player picks the clean tenpai (the lesson's answer) when it is offered.
		return verdict(true)
	}},
}

// playPractice plays a practice session on seed by efficiency and returns,
// for each practice lesson, the discard (1-based) where it got its needed
// successes, if it did.
func playPractice(t testing.TB, st *session.Store, seed int64) map[string]int {
	t.Helper()
	s, err := st.Create(&seed, practiceTurns)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Delete(s.ID())
	v := session.View{NoAdvice: true}
	cur := s.State(v)
	got := map[string]int{}
	count := map[string]int{}
	judge := func(before *session.State, discard string, after *session.State, turn int) {
		for id, l := range practiceLessons {
			if _, done := got[id]; done {
				continue
			}
			if ok := l.judge(before, discard, after); ok != nil && *ok {
				if count[id]++; count[id] >= l.times {
					got[id] = turn
				}
			}
		}
	}
	for turn := 1; cur.Status == session.StatusPlaying; turn++ {
		before := cur
		if cur.CanTsumo {
			if cur, err = s.Tsumo(nil, v); err != nil {
				t.Fatal(err)
			}
			judge(&before, "", &cur, turn)
			break
		}
		// The furiten lesson's answer: a clean tenpai where both are offered; else efficiency.
		d := efficientDiscard(&before)
		if cur, err = s.Discard(d, nil, v); err != nil {
			t.Fatal(err)
		}
		judge(&before, d, &cur, turn)
	}
	return got
}

// efficientDiscard is the discard with the lowest normal shanten and the most
// ukeire, avoiding a furiten tenpai, then the first in tile order.
func efficientDiscard(s *session.State) string {
	var keys []string
	for t := range s.ByDiscard {
		keys = append(keys, t)
	}
	sort.Strings(keys)
	best, bestSh, bestU, bestF := "", 99, -1, true
	var river []string
	for _, d := range s.Discards {
		river = append(river, kindOf(d))
	}
	for _, t := range keys {
		n := normalRow(s.ByDiscard[t])
		if n == nil || n.Shanten == nil {
			continue
		}
		discarded := append(slices.Clone(river), kindOf(t))
		f := *n.Shanten == 0 && slices.ContainsFunc(n.Ukeire, func(w string) bool { return slices.Contains(discarded, kindOf(w)) })
		if *n.Shanten < bestSh || *n.Shanten == bestSh && (bestF && !f || f == bestF && n.UkeireTotal > bestU) {
			best, bestSh, bestU, bestF = t, *n.Shanten, n.UkeireTotal, f
		}
	}
	return best
}

// ---- Game lessons ----

// roundRecord is a dojo round as a game lesson judges it.
type roundRecord struct {
	events []game.Action
	result *game.Result
}

func (r roundRecord) won() bool {
	return (r.result.Kind == "tsumo" || r.result.Kind == "ron") && r.result.Winner == Human
}

func (r roundRecord) wonWith(keys ...string) bool {
	return r.won() && slices.ContainsFunc(r.result.Win.Yaku, func(y yaku.Yaku) bool { return slices.Contains(keys, y.Key) })
}

func (r roundRecord) dealtIn() bool { return r.result.Kind == "ron" && r.result.From == Human }

func (r roundRecord) called(typ game.ActionType) bool {
	return slices.ContainsFunc(r.events, func(a game.Action) bool { return a.Seat == Human && a.Type == typ })
}

var honorYaku = map[string]string{"1z": "ton", "2z": "nan", "3z": "shaa", "4z": "pei", "5z": "haku", "6z": "hatsu", "7z": "chun"}

func (r roundRecord) wonWithCalledYakuhai() bool {
	if !r.won() {
		return false
	}
	return slices.ContainsFunc(r.events, func(a game.Action) bool {
		key, ok := honorYaku[kindOf(a.Tile)]
		return ok && a.Seat == Human && (a.Type == game.Pon || a.Type == game.Kan) && r.wonWith(key)
	})
}

// againstRiichi is lessons.ts's discardsAgainstRiichi: your discards after
// another seat's riichi, with each riichi seat's safe kinds then.
func (r roundRecord) againstRiichi() [][2]any {
	rivers := map[int]map[string]bool{}
	passed := map[int]map[string]bool{}
	youInRiichi := false
	var out [][2]any
	for _, e := range r.events {
		if (e.Type != game.Discard && e.Type != game.Riichi) || e.Tile == "" {
			continue
		}
		k := kindOf(e.Tile)
		if e.Seat == Human && !youInRiichi && len(passed) > 0 {
			var safe []map[string]bool
			for s, p := range passed {
				m := map[string]bool{}
				for x := range rivers[s] {
					m[x] = true
				}
				for x := range p {
					m[x] = true
				}
				safe = append(safe, m)
			}
			out = append(out, [2]any{k, safe})
		}
		for _, p := range passed {
			p[k] = true
		}
		if rivers[e.Seat] == nil {
			rivers[e.Seat] = map[string]bool{}
		}
		rivers[e.Seat][k] = true
		if e.Type == game.Riichi {
			if e.Seat == Human {
				youInRiichi = true
			} else {
				passed[e.Seat] = map[string]bool{}
			}
		}
	}
	return out
}

// isSuji is lessons.ts's: a 1-3 whose +3 is safe, a 7-9 whose -3 is, a 4-6 whose both are.
func isSuji(t string, safe map[string]bool) bool {
	if t[1] == 'z' {
		return false
	}
	n := int(t[0] - '0')
	has := func(m int) bool { return safe[fmt.Sprintf("%d%c", m, t[1])] }
	switch {
	case n <= 3:
		return has(n + 3)
	case n >= 7:
		return has(n - 3)
	}
	return has(n-3) && has(n+3)
}

func everySafe(ds [][2]any, ok func(t string, safe map[string]bool) bool) bool {
	for _, d := range ds {
		for _, safe := range d[1].([]map[string]bool) {
			if !ok(d[0].(string), safe) {
				return false
			}
		}
	}
	return true
}

func genbutsu(t string, safe map[string]bool) bool { return safe[t] }
func sujiOrGenbutsu(t string, safe map[string]bool) bool {
	return safe[t] || isSuji(t, safe)
}

var gameLessons = map[string]struct {
	times int
	judge func(r roundRecord) *bool
}{
	"riichi-win":     {1, func(r roundRecord) *bool { return verdict(r.wonWith("riichi", "double_riichi")) }},
	"tsumo-win":      {1, func(r roundRecord) *bool { return verdict(r.wonWith("tsumo")) }},
	"tanyao-win":     {1, func(r roundRecord) *bool { return verdict(r.wonWith("tanyao")) }},
	"yakuhai-pon":    {1, func(r roundRecord) *bool { return verdict(r.wonWithCalledYakuhai()) }},
	"kuitan":         {1, func(r roundRecord) *bool { return verdict(r.called(game.Chii) && r.wonWith("tanyao")) }},
	"kan-win":        {1, func(r roundRecord) *bool { return verdict(r.called(game.Kan) && r.won()) }},
	"pinfu-win":      {1, func(r roundRecord) *bool { return verdict(r.wonWith("pinfu")) }},
	"honitsu-win":    {1, func(r roundRecord) *bool { return verdict(r.wonWith("honitsu", "chinitsu")) }},
	"iipeikou-win":   {1, func(r roundRecord) *bool { return verdict(r.wonWith("iipeikou", "ryanpeikou")) }},
	"sanshoku-win":   {1, func(r roundRecord) *bool { return verdict(r.wonWith("sanshoku")) }},
	"chiitoitsu-win": {1, func(r roundRecord) *bool { return verdict(r.wonWith("chiitoitsu")) }},
	"toitoi-win":     {1, func(r roundRecord) *bool { return verdict(r.wonWith("toitoi")) }},
	"ittsu-win":      {1, func(r roundRecord) *bool { return verdict(r.wonWith("ittsu")) }},
	"genbutsu": {1, func(r roundRecord) *bool {
		ds := r.againstRiichi()
		if len(ds) == 0 {
			return nil
		}
		return verdict(everySafe(ds, genbutsu) && !r.dealtIn())
	}},
	"suji": {1, func(r roundRecord) *bool {
		ds := r.againstRiichi()
		if len(ds) == 0 {
			return nil
		}
		some := slices.ContainsFunc(ds, func(d [2]any) bool {
			return slices.ContainsFunc(d[1].([]map[string]bool), func(safe map[string]bool) bool { return !safe[d[0].(string)] })
		})
		return verdict(some && everySafe(ds, sujiOrGenbutsu) && !r.dealtIn())
	}},
	"fold": {3, func(r roundRecord) *bool {
		ds := r.againstRiichi()
		if len(ds) == 0 {
			return nil
		}
		return verdict(everySafe(ds, sujiOrGenbutsu) && !r.dealtIn() && !r.won())
	}},
}

// lessonPlayers are the simulated players of the game lessons, in the order a tie goes.
type lessonPlayer struct {
	name string
	new  func() game.Decider
}

var lessonPlayers = []lessonPlayer{
	{"normal", func() game.Decider { return cpu.New() }},
	{"menzen", func() game.Decider { return menzenPlayer{cpu.New()} }},
	{"pon", func() game.Decider { return ponPlayer{cpu.New()} }},
}

// ponPlayer is the normal CPU that takes every pon, as a player going for 対々和 does.
type ponPlayer struct{ *cpu.Player }

func (p ponPlayer) Decide(v game.View, l game.Legal) game.Action {
	if l.Pon && !l.Ron {
		return game.Action{Type: game.Pon}
	}
	return p.Player.Decide(v, l)
}

// playLessonGame plays a dojo 東風戦 against weak CPUs on seed with p on your
// seat, every yaku counted, and returns, for each game lesson, the round
// (from 0) where it got its needed successes, if it did.
func playLessonGame(t testing.TB, st *Store, seed int64, p game.Decider) map[string]int {
	t.Helper()
	m, err := st.Create(&seed, Options{CPU: cpu.Weak, Length: Tonpuu, Dojo: &DojoOptions{Yaku: allYaku}})
	if err != nil {
		t.Fatal(err)
	}
	m.game.OnHumanDiscard = nil
	got := map[string]int{}
	count := map[string]int{}
	for round := 0; ; round++ {
		r := m.game.Round
		for r.Phase() != game.PhaseEnded {
			if err := m.act(p.Decide(r.ViewFor(Human), r.LegalFor(Human))); err != nil {
				t.Fatalf("seed %d: %v", seed, err)
			}
		}
		rec := roundRecord{events: r.Events(), result: r.Result()}
		for id, l := range gameLessons {
			if _, done := got[id]; done {
				continue
			}
			if ok := l.judge(rec); ok != nil && *ok {
				if count[id]++; count[id] >= l.times {
					got[id] = round
				}
			}
		}
		if m.game.H.Over() {
			return got
		}
		if err := m.next(); err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
	}
}

// searchLessonSeeds finds the table: for each lesson the seed passing it
// soonest (the lowest seed, then the first player, on a tie).
func searchLessonSeeds(t *testing.T) lessonSeedTable {
	out := lessonSeedTable{PracticeRange: practiceSeedRange, GameRange: gameSeedRange, Seeds: map[string]lessonSeed{}, Missing: []string{}}
	better := func(id string, s lessonSeed) {
		if cur, ok := out.Seeds[id]; !ok || s.At < cur.At {
			out.Seeds[id] = s
		}
	}
	ss := session.NewStore(4)
	for seed := 1; seed <= practiceSeedRange; seed++ {
		for id, at := range playPractice(t, ss, int64(seed)) {
			better(id, lessonSeed{Seed: seed, At: at})
		}
	}
	st := NewStore(4)
	for seed := 1; seed <= gameSeedRange; seed++ {
		for _, pl := range lessonPlayers {
			for id, at := range playLessonGame(t, st, int64(seed), pl.new()) {
				better(id, lessonSeed{Seed: seed, At: at, Player: pl.name})
			}
		}
	}
	for id := range practiceLessons {
		if _, ok := out.Seeds[id]; !ok {
			out.Missing = append(out.Missing, id)
		}
	}
	for id := range gameLessons {
		if _, ok := out.Seeds[id]; !ok {
			out.Missing = append(out.Missing, id)
		}
	}
	sort.Strings(out.Missing)
	return out
}

func readLessonSeeds(t *testing.T) lessonSeedTable {
	t.Helper()
	var got lessonSeedTable
	if err := json.Unmarshal([]byte(webts.Read(t, lessonSeedsFile)), &got); err != nil {
		t.Fatalf("%s: %v", lessonSeedsFile, err)
	}
	return got
}

func TestLessonSeeds(t *testing.T) {
	if testing.Short() {
		t.Skip("plays sessions and games; run without -short")
	}
	if testmode.Full() || os.Getenv("UPDATE_LESSON_SEEDS") != "" {
		want := searchLessonSeeds(t)
		if os.Getenv("UPDATE_LESSON_SEEDS") != "" {
			b, err := json.MarshalIndent(want, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile("../../web/"+lessonSeedsFile, append(b, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		gb, _ := json.Marshal(readLessonSeeds(t))
		wb, _ := json.Marshal(want)
		if string(gb) != string(wb) {
			t.Fatalf("%s is stale; run UPDATE_LESSON_SEEDS=1 go test ./internal/match -run TestLessonSeeds\n got: %s\nwant: %s", lessonSeedsFile, gb, wb)
		}
	}

	// Every lesson has a seed or is listed missing, and each seed still passes its lesson where recorded.
	got := readLessonSeeds(t)
	ss, st := session.NewStore(4), NewStore(4)
	for id := range practiceLessons {
		e, ok := got.Seeds[id]
		if !ok {
			if !slices.Contains(got.Missing, id) {
				t.Errorf("%s: %s has no seed and is not missing", lessonSeedsFile, id)
			}
			continue
		}
		if at, ok := playPractice(t, ss, int64(e.Seed))[id]; !ok || at != e.At {
			t.Errorf("%s: practice seed %d passes at discard %d (%v), want %d", id, e.Seed, at, ok, e.At)
		}
	}
	for id := range gameLessons {
		e, ok := got.Seeds[id]
		if !ok {
			if !slices.Contains(got.Missing, id) {
				t.Errorf("%s: %s has no seed and is not missing", lessonSeedsFile, id)
			}
			continue
		}
		i := slices.IndexFunc(lessonPlayers, func(p lessonPlayer) bool { return p.name == e.Player })
		if i < 0 {
			t.Errorf("%s: unknown player %q", id, e.Player)
			continue
		}
		if at, ok := playLessonGame(t, st, int64(e.Seed), lessonPlayers[i].new())[id]; !ok || at != e.At {
			t.Errorf("%s: game seed %d (%s) passes in round %d (%v), want %d", id, e.Seed, e.Player, at, ok, e.At)
		}
	}
}
