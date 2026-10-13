package problem

import (
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

// machiProblem is a machi problem on 13 given tiles, past the filter.
func machiProblem(hand string) *Problem {
	c := tile.MustCounts(hand)
	return &Problem{ID: "test", Kind: Machi, answer: answer{hand: c, waits: waits(c)}}
}

func kinds(t *testing.T, s string) []tile.Kind {
	t.Helper()
	var out []tile.Kind
	for _, x := range tile.MustParseHand(s) {
		out = append(out, x.Kind)
	}
	return out
}

func TestWaits(t *testing.T) {
	for _, c := range []struct {
		hand, waits string
		simple      bool
	}{
		{"123m456m789m11p23s", "14s", true},               // 両面
		{"123m456m789m11p13s", "2s", true},                // 嵌張
		{"123m456m789m11p12s", "3s", true},                // 辺張
		{"123m456m789m11p22s", "1p2s", true},              // 双碰
		{"123m456m789m123p1s", "1s", true},                // 単騎
		{"123m456m789m1234p", "14p", false},               // 延べ単
		{"123m456m11p23456s", "147s", false},              // 三面張
		{"1112345678999m", "123456789m", false},           // 九蓮宝燈
		{"11m22m33p44p55s66s7z", "7z", true},              // 七対子の単騎
		{"19m19p19s1234567z", "19m19p19s1234567z", false}, // 国士無双十三面
		{"1111m23m456p789s5z", "5z", true},                // 1m held four times
		{"123m456m789m111p2z", "2z", true},
	} {
		h := tile.MustCounts(c.hand)
		ws := waits(h)
		if !slices.Equal(ws, kinds(t, c.waits)) {
			t.Errorf("%s: waits %v, want %s", c.hand, ws, c.waits)
			continue
		}
		if got := simple(h, ws); got != c.simple {
			t.Errorf("%s: simple %v", c.hand, got)
		}
	}
	if ws := waits(tile.MustCounts("123m456m789m1111p")); ws != nil {
		t.Errorf("4-copy 単騎 is no wait: %v", ws)
	}
}

func TestGradeMachi(t *testing.T) {
	p := machiProblem("123m456m11p23456s") // waits 1s 4s 7s
	r := grade(t, p, "7s", "1s", "4s")
	if !r.Correct || !slices.Equal(r.Best, []string{"1s", "4s", "7s"}) || len(r.Missed) != 0 || len(r.Ranking) != 3 ||
		!strings.HasPrefix(r.Text, "正解。待ちは 1索・4索・7索 の3種。1索で 123m 456m 11p 123s 456s（両面）。") {
		t.Fatalf("exact: %+v", r)
	}
	if e := r.Answer[0]; e.Tile != "7s" || e.Rank != 1 || e.Shanten != -1 || e.Ukeire != 4 {
		t.Fatalf("eval %+v", e)
	}
	r = grade(t, p, "1s", "4s")
	if r.Correct || !slices.Equal(r.Missed, []string{"7s"}) || !strings.HasPrefix(r.Text, "見逃した待ち: 7索。待ちは") {
		t.Fatalf("missing: %+v", r)
	}
	r = grade(t, p, "1s", "4s", "7s", "0s")
	if r.Correct || len(r.Missed) != 0 || r.Answer[3].Tile != "0s" || r.Answer[3].Rank != 2 || !strings.HasPrefix(r.Text, "待ちではない牌: 5索。") {
		t.Fatalf("extra: %+v", r)
	}
	if r := grade(t, machiProblem("11m22m33p44p55s66s7z"), "7z"); !r.Correct || !strings.Contains(r.Text, "（七対子の単騎）") {
		t.Fatalf("chiitoitsu: %+v", r)
	}
	if r := grade(t, machiProblem("11m22m33p44p55s66s5z"), "5z"); !r.Correct || !strings.HasSuffix(r.Text, " 白白（七対子の単騎）。") {
		t.Fatalf("chiitoitsu text: %q", r.Text)
	}
	for _, ans := range [][]string{{}, {"1s", "1s"}, {"5s", "0s"}, {"1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "1p"}} {
		var ts []tile.Tile
		for _, s := range ans {
			ts = append(ts, tile.MustParseHand(s)...)
		}
		if _, err := p.Grade(ts); !errors.Is(err, ErrInvalid) {
			t.Errorf("Grade(%v): %v, want ErrInvalid", ans, err)
		}
	}
}

// TestMachiDeterministic: a machi id always gives the same problem and
// grading, and parses back.
func TestMachiDeterministic(t *testing.T) {
	for level := 1; level <= machiLevels; level++ {
		for _, seed := range []int64{0, 7, 42, 1 << 40} {
			a, b := generate(t, Machi, level, seed), generate(t, Machi, level, seed)
			ja, _ := json.Marshal(a)
			jb, _ := json.Marshal(b)
			if string(ja) != string(jb) {
				t.Fatalf("%s: two problems differ:\n%s\n%s", a.ID, ja, jb)
			}
			h := a.Position.Hand[0]
			if !reflect.DeepEqual(grade(t, a, h), grade(t, b, h)) {
				t.Fatalf("%s: two gradings differ", a.ID)
			}
			kind, lv, sd, err := Parse(a.ID)
			if err != nil || kind != Machi || lv != level || sd != seed {
				t.Fatalf("Parse(%q) = %s, %d, %d, %v", a.ID, kind, lv, sd, err)
			}
		}
	}
	if p := generate(t, Machi, 2, 12345); p.ID != "machi:2:12345" || p.Choose != "many" {
		t.Fatalf("%+v", p)
	}
	for _, id := range []string{"machi:0:1", "machi:4:1", "machi:01:1"} {
		if _, _, _, err := Parse(id); !errors.Is(err, ErrInvalid) {
			t.Errorf("Parse(%q): %v, want ErrInvalid", id, err)
		}
	}
}

// TestMachiSweep: every seed of a fixed range gives a machi problem at every
// level, and every problem fits its level (docs/problems.md).
func TestMachiSweep(t *testing.T) {
	const seeds = 100
	start := time.Now()
	for level := 1; level <= machiLevels; level++ {
		for seed := int64(1); seed <= seeds; seed++ {
			p := generate(t, Machi, level, seed)
			pos := p.Position
			c := tile.Counts{}
			for _, s := range pos.Hand {
				x, err := tile.Parse(s)
				if err != nil {
					t.Fatal(err)
				}
				c[x.Kind]++
			}
			ws := waits(c)
			if len(pos.Hand) != wall.HandSize || pos.Drawn != nil || c != p.answer.hand || !slices.Equal(ws, p.answer.waits) {
				t.Fatalf("%s: position %+v", p.ID, pos)
			}
			n := len(ws)
			switch {
			case n < 1 || n > maxWaits:
				t.Errorf("%s: %d waits", p.ID, n)
			case level == 1 && (oneSuit(c) || n > 2 || !simple(c, ws)):
				t.Errorf("%s: not a simple wait: %v", p.ID, ws)
			case level == 2 && (oneSuit(c) || (n < 3 && simple(c, ws))):
				t.Errorf("%s: not a level 2 wait: %v", p.ID, ws)
			case level == 3 && (!oneSuit(c) || n < 3):
				t.Errorf("%s: not a 清一色 multi-sided wait: %v", p.ID, ws)
			}
			var ans []tile.Tile
			for _, w := range ws {
				ans = append(ans, tile.Tile{Kind: w})
			}
			if r := grade(t, p, tile.Strings(ans)...); !r.Correct || len(r.Best) != n {
				t.Errorf("%s: the waits are not correct: %+v", p.ID, r)
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
	}
	// Generation takes about 5 ms a problem at most here on average; the
	// wasm build is slower (docs/problems.md).
	if d := time.Since(start) / (machiLevels * seeds); d > 100*time.Millisecond {
		t.Errorf("%v a problem, want under 100ms", d)
	}
}
