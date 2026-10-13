package problem

import (
	"encoding/json"
	"errors"
	"maps"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

func generate(t *testing.T, kind Kind, level int, seed int64) *Problem {
	t.Helper()
	p, err := Generate(kind, level, seed)
	if err != nil {
		t.Fatalf("Generate(%s, %d, %d): %v", kind, level, seed, err)
	}
	return p
}

func grade(t *testing.T, p *Problem, tiles ...string) *Result {
	t.Helper()
	var ans []tile.Tile
	for _, s := range tiles {
		x, err := tile.Parse(s)
		if err != nil {
			t.Fatal(err)
		}
		ans = append(ans, x)
	}
	r, err := p.Grade(ans)
	if err != nil {
		t.Fatalf("%s: Grade(%v): %v", p.ID, tiles, err)
	}
	return r
}

// TestDeterministic: an id always gives the same problem and the same
// grading, so grading can build the problem again from the id.
func TestDeterministic(t *testing.T) {
	for level := 1; level <= len(nanikiruLevels); level++ {
		for _, seed := range []int64{0, 7, 42, 1 << 40} {
			a, b := generate(t, Nanikiru, level, seed), generate(t, Nanikiru, level, seed)
			ja, _ := json.Marshal(a)
			jb, _ := json.Marshal(b)
			if string(ja) != string(jb) {
				t.Fatalf("%s: two problems differ:\n%s\n%s", a.ID, ja, jb)
			}
			d := a.Position.Drawn
			if !reflect.DeepEqual(grade(t, a, *d), grade(t, b, *d)) {
				t.Fatalf("%s: two gradings differ", a.ID)
			}
		}
	}
}

func TestParse(t *testing.T) {
	p := generate(t, Nanikiru, 2, 12345)
	if p.ID != "nanikiru:2:12345" {
		t.Fatalf("id %q", p.ID)
	}
	kind, level, seed, err := Parse(p.ID)
	if err != nil || kind != p.Kind || level != p.Level || seed != p.Seed {
		t.Fatalf("Parse(%q) = %s, %d, %d, %v", p.ID, kind, level, seed, err)
	}
	if _, _, seed, _ := Parse("nanikiru:1:-5"); seed != -5 {
		t.Fatalf("negative seed: %d", seed)
	}
	for _, id := range []string{"", "nanikiru", "nanikiru:1", "nanikiru:1:2:3", "oshihiki:1:2", "nanikiru:0:2", "nanikiru:4:2", "nanikiru:x:2", "nanikiru:1:x"} {
		if _, _, _, err := Parse(id); !errors.Is(err, ErrInvalid) {
			t.Errorf("Parse(%q): %v, want ErrInvalid", id, err)
		}
	}
	for _, c := range []struct {
		kind  Kind
		level int
	}{{"machi", 1}, {Nanikiru, 0}, {Nanikiru, 4}} {
		if _, err := Generate(c.kind, c.level, 1); !errors.Is(err, ErrInvalid) {
			t.Errorf("Generate(%s, %d): %v, want ErrInvalid", c.kind, c.level, err)
		}
	}
}

// TestNoAnswerInJSON: the problem's JSON leaves the answer out.
func TestNoAnswerInJSON(t *testing.T) {
	b, err := json.Marshal(generate(t, Nanikiru, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	keys := slices.Sorted(maps.Keys(raw))
	if want := []string{"choose", "id", "kind", "level", "position", "seed", "source"}; !slices.Equal(keys, want) {
		t.Fatalf("keys %v, want %v", keys, want)
	}
}

func TestGrade(t *testing.T) {
	p := generate(t, Nanikiru, 1, 42)
	r := grade(t, p, correct(p)[0])
	if !r.Correct || r.Answer[0].Rank != 1 || !strings.Contains(r.Text, "最善") || !strings.Contains(r.Text, "守備と点数は考えない") {
		t.Fatalf("best: %+v", r)
	}
	worst := r.Ranking[len(r.Ranking)-1]
	w := grade(t, p, worst.Tile)
	if w.Correct || w.Answer[0].Rank != worst.Rank || worst.Rank == 1 {
		t.Fatalf("worst %s: %+v", worst.Tile, w)
	}
	if !strings.Contains(w.Text, "打 ") || !strings.Contains(w.Text, "位）") || strings.HasPrefix(w.Text, "前巡") {
		t.Fatalf("worst text: %q", w.Text)
	}
	if !reflect.DeepEqual(w.Best, r.Best) || !reflect.DeepEqual(w.Ranking, r.Ranking) {
		t.Fatal("the ranking depends on the answer")
	}

	notHeld := ""
	held := map[string]bool{*p.Position.Drawn: true}
	for _, s := range p.Position.Hand {
		held[s] = true
	}
	for k := range tile.Kind(tile.NumKinds) {
		if !held[k.String()] {
			notHeld = k.String()
			break
		}
	}
	for _, ans := range [][]string{{}, {notHeld}, {*p.Position.Drawn, p.Position.Hand[0]}} {
		var ts []tile.Tile
		for _, s := range ans {
			ts = append(ts, tile.MustParseHand(s)...)
		}
		if _, err := p.Grade(ts); !errors.Is(err, ErrInvalid) {
			t.Errorf("Grade(%v): %v, want ErrInvalid", ans, err)
		}
	}
}

// correct returns the correct tiles, from the problem's answer.
func correct(p *Problem) []string {
	var out []string
	for _, r := range p.answer.advice.Ranked() {
		if r.Rank == 1 {
			out = append(out, r.Tile.String())
		}
	}
	return out
}

// TestSweep: every seed of a fixed range gives a problem at every level
// within maxTries, and every problem fits its level (docs/problems.md).
func TestSweep(t *testing.T) {
	const seeds = 100
	start := time.Now()
	for level := 1; level <= len(nanikiruLevels); level++ {
		lv := nanikiruLevels[level-1]
		for seed := int64(1); seed <= seeds; seed++ {
			p := generate(t, Nanikiru, level, seed)
			checkPosition(t, p, lv)
			r := grade(t, p, *p.Position.Drawn)
			checkRanking(t, p, lv, r.Ranking)
		}
	}
	// Generation takes a few ms a problem here; the wasm build is slower,
	// so a request must stay far below a practice move (docs/problems.md).
	if d := time.Since(start) / (3 * seeds); d > 100*time.Millisecond {
		t.Errorf("%v a problem, want under 100ms", d)
	}
}

func checkPosition(t *testing.T, p *Problem, lv nanikiruLevel) {
	t.Helper()
	pos := p.Position
	if pos.Junme < lv.minJunme || pos.Junme > lv.maxJunme {
		t.Errorf("%s: junme %d", p.ID, pos.Junme)
	}
	if len(pos.Hand) != wall.HandSize || pos.Drawn == nil || len(pos.Discards) != pos.Junme-1 || len(pos.DoraIndicators) != 1 {
		t.Errorf("%s: position %+v", p.ID, pos)
	}
	unseen := 0
	for _, n := range pos.Remaining {
		unseen += n
	}
	if seen := wall.HandSize + 1 + len(pos.Discards) + 1; unseen != tile.NumKinds*4-seen {
		t.Errorf("%s: %d unseen, %d seen", p.ID, unseen, seen)
	}
	if p.Source != p.Seed {
		found := false
		for i := 1; i <= maxTries && !found; i++ {
			found = wall.RoundSeed(p.Seed, i) == p.Source
		}
		if !found {
			t.Errorf("%s: source %d is not a candidate", p.ID, p.Source)
		}
	}
}

// checkRanking checks the filter on the graded ranking.
func checkRanking(t *testing.T, p *Problem, lv nanikiruLevel, ranking []Eval) {
	t.Helper()
	a := ranking[0]
	if a.Shanten < lv.minShanten || a.Shanten > lv.maxShanten {
		t.Errorf("%s: best shanten %d", p.ID, a.Shanten)
	}
	n := 0
	for n < len(ranking) && ranking[n].Rank == 1 {
		n++
	}
	if n < 1 || n > maxCorrect || n == len(ranking) {
		t.Fatalf("%s: %d correct of %d", p.ID, n, len(ranking))
	}
	b := ranking[n]
	gap := a.Ukeire - b.Ukeire
	switch {
	case b.Shanten > a.Shanten && !lv.sameShanten:
	case b.Shanten == a.Shanten && gap >= minUkeireGap && float64(gap) >= minUkeireRatio*float64(b.Ukeire):
	case b.Shanten == a.Shanten && a.Shanten == 1 && gap == 0 && *a.Wait-*b.Wait >= minWaitGap-1e-9:
	default:
		t.Errorf("%s: unclear: %+v vs %+v", p.ID, a, b)
	}
}
