package session

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/webts"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// The dojo's yaku guide (web/src/dojo/yakuGuide.json, yakuSeeds.json): the han
// and the example hand of each yaku sold in the shop, and a practice seed whose
// starting hand is near that yaku. Both are machine-checked here, so they
// cannot drift from the engine.
//
// To regenerate the seeds after a change to the deal or the analysis:
//
//	UPDATE_YAKU_SEEDS=1 go test ./internal/session -run TestYakuGuideSeeds

const (
	guideFile = "src/dojo/yakuGuide.json"
	seedsFile = "src/dojo/yakuSeeds.json"
	// seedRange is how many seeds (1..seedRange) are searched for each yaku.
	seedRange = 10000
)

type guideExample struct {
	Hand      string   `json:"hand"`
	Melds     []string `json:"melds"`
	Win       string   `json:"win"`
	Ron       bool     `json:"ron"`
	Situation string   `json:"situation"`
	EvalKey   string   `json:"evalKey"`
	Note      string   `json:"note"`
}

type guideEntry struct {
	Han     int          `json:"han"`
	OpenHan *int         `json:"openHan"`
	Example guideExample `json:"example"`
}

func readGuide(t testing.TB) map[string]guideEntry {
	t.Helper()
	var g map[string]guideEntry
	dec := json.NewDecoder(strings.NewReader(webts.Read(t, guideFile)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&g); err != nil {
		t.Fatalf("%s: %v", guideFile, err)
	}
	return g
}

// practiceRows are the analysis rows whose shanten picks a yaku's practice
// seed (the lowest of them). Yaku without a row of their own are practiced on
// the normal form: the aim is to reach tenpai. A nil entry: nothing in
// practice mode (a discard-only game) reaches the yaku.
var practiceRows = map[string][]string{
	"riichi":          {"normal"},
	"double_riichi":   {"normal"},
	"ippatsu":         {"normal"},
	"yakuhai":         {"haku", "hatsu", "chun", "ton"},
	"iipeikou":        {"iipeikou"},
	"sanshoku":        {"sanshoku"},
	"ittsu":           {"ittsu"},
	"chanta":          {"chanta"},
	"chiitoitsu":      {"chiitoitsu"},
	"toitoi":          {"toitoi"},
	"sanankou":        {"sanankou"},
	"sanshoku_doukou": {"sanshoku_doukou"},
	"shousangen":      {"shousangen"},
	"honroutou":       {"honroutou"},
	"honitsu":         {"honitsu"},
	"junchan":         {"junchan"},
	"ryanpeikou":      {"ryanpeikou"},
	"chinitsu":        {"chinitsu"},
	"haitei":          nil,
	"houtei":          nil,
	"rinshan":         nil,
	"chankan":         nil,
	"sankantsu":       nil,
}

type seedEntry struct {
	Seed    int    `json:"seed"`
	Row     string `json:"row"`
	Shanten int    `json:"shanten"`
}

type seedTable struct {
	Range int                  `json:"range"`
	Seeds map[string]seedEntry `json:"seeds"`
}

// bestSeeds finds, for each yaku with practice rows, the seed in 1..seedRange
// with the lowest shanten on those rows (the lowest seed on a tie, the first
// listed row on a tie of rows), from the same deal and analysis a practice
// session starts with.
func bestSeeds() seedTable {
	out := seedTable{Range: seedRange, Seeds: map[string]seedEntry{}}
	an := yakushanten.NewAnalyzer()
	for seed := 1; seed <= seedRange; seed++ {
		res := an.Analyze(tile.CountsOf(wall.New(int64(seed)).Hand()))
		byKey := map[string]yakushanten.Result{}
		for _, r := range res {
			byKey[r.Key] = r
		}
		for key, rows := range practiceRows {
			for _, row := range rows {
				r, ok := byKey[row]
				if !ok || !r.Possible {
					continue
				}
				if cur, have := out.Seeds[key]; !have || r.Shanten < cur.Shanten {
					out.Seeds[key] = seedEntry{Seed: seed, Row: row, Shanten: r.Shanten}
				}
			}
		}
	}
	return out
}

func TestYakuGuideSeeds(t *testing.T) {
	want := bestSeeds()
	if os.Getenv("UPDATE_YAKU_SEEDS") != "" {
		b, err := json.MarshalIndent(want, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("../../web/"+seedsFile, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var got seedTable
	if err := json.Unmarshal([]byte(webts.Read(t, seedsFile)), &got); err != nil {
		t.Fatalf("%s: %v", seedsFile, err)
	}
	gb, _ := json.Marshal(got)
	wb, _ := json.Marshal(want)
	if string(gb) != string(wb) {
		t.Fatalf("%s is stale; run UPDATE_YAKU_SEEDS=1 go test ./internal/session -run TestYakuGuideSeeds\n got: %s\nwant: %s", seedsFile, gb, wb)
	}

	// The table's keys are the guide's yaku, bar those practice cannot reach.
	guide := readGuide(t)
	for key := range guide {
		rows, ok := practiceRows[key]
		if !ok {
			t.Errorf("%s: %s has no practiceRows entry", guideFile, key)
		}
		if _, have := got.Seeds[key]; have == (rows == nil) {
			t.Errorf("%s: seed for %s present=%v, want %v", seedsFile, key, have, rows != nil)
		}
	}

	// A practice session on the seed shows the row at that shanten.
	st := NewStore(8)
	for key, e := range got.Seeds {
		seed := int64(e.Seed)
		s, err := st.Create(&seed, 18)
		if err != nil {
			t.Fatal(err)
		}
		var found bool
		for _, r := range s.State(View{NoAdvice: true}).Analysis {
			if r.Key == e.Row {
				found = true
				if r.Shanten == nil || *r.Shanten != e.Shanten {
					t.Errorf("%s: seed %d row %s shanten = %v, want %d", key, e.Seed, e.Row, r.Shanten, e.Shanten)
				}
			}
		}
		if !found {
			t.Errorf("%s: seed %d has no row %s", key, e.Seed, e.Row)
		}
	}
}

func TestYakuGuideExamples(t *testing.T) {
	for key, g := range readGuide(t) {
		ex := g.Example
		evalKey := key
		if ex.EvalKey != "" {
			evalKey = ex.EvalKey
		}

		// Han: closed, and when open (null: needs a closed hand).
		if h := yaku.HanFor(evalKey, yaku.EastEast); h != g.Han {
			t.Errorf("%s: han = %d, the engine says %d", key, g.Han, h)
		}
		open := yaku.HanOpenFor(evalKey, yaku.EastEast, true)
		if (g.OpenHan == nil) != (open == 0) || (g.OpenHan != nil && *g.OpenHan != open) {
			t.Errorf("%s: openHan = %v, the engine says %d (0: closed only)", key, g.OpenHan, open)
		}

		// The example is a complete hand that scores the yaku.
		ts, err := tile.ParseHand(ex.Hand)
		if err != nil {
			t.Fatalf("%s: hand: %v", key, err)
		}
		win, err := tile.Parse(ex.Win)
		if err != nil {
			t.Fatalf("%s: win: %v", key, err)
		}
		ctx := yaku.Context{Winds: yaku.EastEast, WinTile: win.Kind, Ron: ex.Ron}
		for _, m := range ex.Melds {
			mt, err := tile.ParseHand(m)
			if err != nil || len(mt) != 4 || mt[0].Kind != mt[3].Kind {
				t.Fatalf("%s: meld %q is not four of a kind", key, m)
			}
			ctx.Melds = append(ctx.Melds, yaku.Meld{Type: yaku.Trip, Kind: mt[0].Kind, Kan: true})
			ctx.MeldTiles = append(ctx.MeldTiles, mt...)
		}
		switch ex.Situation {
		case "":
		case "riichi":
			ctx.Riichi = true
		case "ippatsu":
			ctx.Riichi, ctx.Ippatsu = true, true
		case "double_riichi":
			ctx.DoubleRiichi = true
		case "haitei":
			ctx.Haitei = true
		case "houtei":
			ctx.Houtei = true
		case "rinshan":
			ctx.Rinshan = true
		case "chankan":
			ctx.Chankan = true
		default:
			t.Fatalf("%s: unknown situation %q", key, ex.Situation)
		}
		if (ex.Situation == "houtei" || ex.Situation == "chankan") && !ex.Ron {
			t.Errorf("%s: ron = %v does not fit the situation %q", key, ex.Ron, ex.Situation)
		}
		w, ok := yaku.Evaluate(ts, ctx)
		if !ok {
			t.Errorf("%s: %s %v is not a complete hand containing %s", key, ex.Hand, ex.Melds, ex.Win)
			continue
		}
		var keys []string
		for _, y := range w.Yaku {
			keys = append(keys, y.Key)
		}
		if !slices.Contains(keys, evalKey) {
			t.Errorf("%s: the example scores %v, not %s", key, keys, evalKey)
		}
	}
}
