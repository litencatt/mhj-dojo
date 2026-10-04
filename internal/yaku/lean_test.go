package yaku

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Golden vectors from the Lean model in formal/ (formal/run.sh vectors).

var waitNames = map[Wait]string{
	Ryanmen: "ryanmen", Kanchan: "kanchan", Penchan: "penchan", Shanpon: "shanpon", Tanki: "tanki",
}

func groupToken(m Meld) string {
	if m.Type == Trip {
		return fmt.Sprintf("t%d", m.Kind)
	}
	return fmt.Sprintf("s%d", m.Kind)
}

// leanReading prints a reading as formal/GenVectors.lean does.
func leanReading(r Reading, ctx Context) string {
	conc := slices.Clone(r.Melds[:4-len(ctx.Melds)])
	slices.SortFunc(conc, func(a, b Meld) int {
		return (int(a.Type)*100 + int(a.Kind)) - (int(b.Type)*100 + int(b.Kind))
	})
	toks := make([]string, len(conc))
	for i, m := range conc {
		toks[i] = groupToken(m)
	}
	win := "pair"
	if r.WinGroup >= 0 {
		win = groupToken(r.Melds[r.WinGroup])
	}
	return fmt.Sprintf("pair=%d groups=%s win=%s wait=%s fu=%d",
		r.Pair, strings.Join(toks, " "), win, waitNames[r.Wait], Fu(r, ctx))
}

func TestLeanFuVectors(t *testing.T) {
	b, err := os.ReadFile("testdata/lean_fu.json")
	if err != nil {
		t.Fatal(err)
	}
	var vs []struct {
		Hand  string
		Melds []struct {
			Type      string
			Kind      int
			Open, Kan bool
		}
		Win, Round, Seat int
		Ron              bool
		Readings         []string
	}
	if err := json.Unmarshal(b, &vs); err != nil {
		t.Fatal(err)
	}
	if len(vs) < 4000 {
		t.Fatalf("%d vectors, want at least 4000", len(vs))
	}
	for _, v := range vs {
		ctx := Context{WinTile: tile.Kind(v.Win), Ron: v.Ron,
			Winds: Winds{tile.Kind(v.Round), tile.Kind(v.Seat)}}
		for _, m := range v.Melds {
			g := Meld{Type: Seq, Kind: tile.Kind(m.Kind), Open: m.Open, Kan: m.Kan}
			if m.Type == "trip" {
				g.Type = Trip
			}
			ctx.Melds = append(ctx.Melds, g)
		}
		var got []string
		for _, r := range ReadingsWith(tile.MustCounts(v.Hand), ctx.Melds, ctx.WinTile) {
			got = append(got, leanReading(r, ctx))
		}
		slices.Sort(got)
		want := slices.Clone(v.Readings)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			t.Errorf("%s %v on %d ron=%v winds=%d/%d:\n Go   %q\n Lean %q",
				v.Hand, v.Melds, v.Win, v.Ron, v.Round, v.Seat, got, want)
		}
	}
}
