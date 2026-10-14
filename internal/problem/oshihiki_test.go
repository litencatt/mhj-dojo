package problem

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// river builds a seat's river from tiles; the riichi'th (if >= 0) is the
// declaration, and orders run from first.
func river(tiles string, riichi, first int) []game.RiverTile {
	var out []game.RiverTile
	for i, t := range tile.MustParseHand(tiles) {
		out = append(out, game.RiverTile{Tile: t, Riichi: i == riichi, Order: first + i})
	}
	return out
}

// TestReason: each way a tile is read against one riichi, as the
// explanation names it.
func TestReason(t *testing.T) {
	v := game.View{Viewer: 0}
	for s := range v.Seats {
		v.Seats[s].Seat = s
	}
	// Seat 2 declared riichi on its 2nd discard (order 1); seat 1 passed
	// 9m after it.
	v.Seats[2].Riichi = true
	v.Seats[2].River = river("4m1z", 1, 0)
	v.Seats[1].River = river("9m", -1, 2)
	// Four 7p in sight: a wall for 8p and 9p's low side.
	v.Seats[3].River = river("7p7p7p7p", -1, 3)
	v.Seats[0].Hand = tile.MustParseHand("5z5z5z")
	for _, tc := range []struct {
		tile, want string
	}{
		{"4m", "現物"},
		{"1z", "現物"},
		{"9m", "リーチ後に通った牌"},
		{"1m", "筋"},         // 4m's suji
		{"7m", "筋"},         // 56 only (89 is a penchan): 4m's suji
		{"6m", "片筋"},        // 78 ruled out by 9m, 45 open
		{"8p", "ノーチャンス（壁）"}, // 67 only, walled by 7p
		{"9p", "ノーチャンス（壁）"}, // only 7-8, walled by 7p
		{"5z", "3枚見えている字牌（単騎だけ）"},
		{"2z", "見えていない字牌"},
		{"5s", "無筋の中張牌"},
		{"2s", "無筋の2・8牌"},
		{"1s", "無筋の端牌"},
	} {
		k, _ := tile.Parse(tc.tile)
		if got := reason(v, 2, k.Kind); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.tile, got, tc.want)
		}
	}
}

// TestOshihikiSweep: every level makes a problem from each seed, as the
// level asks, and the safest tile is correct and the most dangerous not.
func TestOshihikiSweep(t *testing.T) {
	const seeds = 100
	start := time.Now()
	for level := 1; level <= len(oshihikiLevels); level++ {
		lv := oshihikiLevels[level-1]
		for seed := int64(1); seed <= seeds; seed++ {
			p := generate(t, Oshihiki, level, seed)
			pos := p.Position
			if len(pos.Hand) != 13 || pos.Drawn == nil || len(pos.Seats) != 4 || p.Choose != "one" {
				t.Fatalf("%s: position %+v", p.ID, pos)
			}
			riichi := 0
			for _, s := range pos.Seats[1:] {
				if s.Riichi {
					riichi++
				}
			}
			if pos.Seats[0].Riichi || riichi < lv.riichi || riichi > lv.maxRiichi {
				t.Errorf("%s: %d riichi", p.ID, riichi)
			}
			r := grade(t, p, p.answer.tiles[0].String())
			best := *r.Ranking[0].Danger
			switch {
			case len(r.Best) < 1 || len(r.Best) > maxSafest || len(r.Best) == len(r.Ranking):
				t.Errorf("%s: %d safest of %d", p.ID, len(r.Best), len(r.Ranking))
			case lv.genbutsu == withGenbutsu && best != 0, lv.genbutsu == noGenbutsu && best == 0:
				t.Errorf("%s: safest danger %d", p.ID, best)
			}
			if ok := grade(t, p, r.Best[0]); !ok.Correct || !strings.HasPrefix(ok.Text, "正解。") {
				t.Errorf("%s: the safest %s is not correct: %s", p.ID, r.Best[0], ok.Text)
			}
			worst := r.Ranking[len(r.Ranking)-1]
			if bad := grade(t, p, handTile(p, worst.Tile)); bad.Correct || !strings.Contains(bad.Text, worst.Reason) {
				t.Errorf("%s: the most dangerous %s: %+v", p.ID, worst.Tile, bad)
			}
		}
	}
	if d := time.Since(start) / time.Duration(len(oshihikiLevels)*seeds); d > 100*time.Millisecond {
		t.Errorf("%v a problem, want under 100ms", d)
	}
}

// handTile is the hand's tile of the kind of s.
func handTile(p *Problem, s string) string {
	k := kindOf(s)
	i := slices.IndexFunc(p.answer.tiles, func(t tile.Tile) bool { return t.Kind == k })
	return p.answer.tiles[i].String()
}

func TestOshihikiDeterministic(t *testing.T) {
	a, b := generate(t, Oshihiki, 2, 7), generate(t, Oshihiki, 2, 7)
	if a.Source != b.Source || !slices.Equal(a.Position.Hand, b.Position.Hand) || len(a.Position.Seats) != len(b.Position.Seats) {
		t.Fatalf("not deterministic: %+v / %+v", a.Position, b.Position)
	}
	if _, err := a.Grade(tile.MustParseHand("1m1m")); err == nil {
		t.Error("two tiles graded")
	}
}
