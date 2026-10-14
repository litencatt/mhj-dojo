package session

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/webts"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// The dojo's yaku guide (web/src/dojo/yakuGuide.json, yakuSeeds.json): the han
// and the example hand of each yaku sold in the shop (and of 立直, now an
// initial yaku), and practice seeds on which the yaku can surely be made.
// Both are machine-checked here, so they cannot drift from the engine.
//
// A seed is kept when some line of play reaches the goal in practice mode
// (18 turns, discards and tsumo only, so always closed; the draws do not
// depend on the discards): a tsumo win scoring the yaku (winLines, an exact
// search), or for the 立直 family (practice cannot declare riichi) a tenpai
// on the normal form within tenpaiBy discards (tenpaiLine, a greedy line).
//
// go test replays each stored seed's line through a practice session;
// MHJDOJO_FULL=1 also searches again and requires the same file. To
// regenerate the seeds after a change to the deal or the analysis:
//
//	UPDATE_YAKU_SEEDS=1 go test ./internal/session -run TestYakuGuideSeeds

const (
	guideFile = "src/dojo/yakuGuide.json"
	seedsFile = "src/dojo/yakuSeeds.json"
	// seedRange is how many seeds (1..seedRange) are searched for each yaku.
	seedRange = 50000
	// seedsPerYaku is how many seeds are kept for each yaku (the lowest ones).
	seedsPerYaku = 8
	// practiceTurns is the practice link's max_turns (yakuGuide.ts practiceHref).
	practiceTurns = 18
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

// practiceRows are a yaku's analysis rows: the search tries the deals near
// the nearest of them (dealShantenMax), and a 役牌 win may score any of
// theirs. Yaku without a row of their own are practiced on the normal form:
// the aim is to reach tenpai. A nil entry: nothing in practice mode (a
// discard-only game) reaches the yaku.
var practiceRows = map[string][]string{
	"riichi":          {"normal"},
	"double_riichi":   {"normal"},
	"ippatsu":         {"normal"},
	"pinfu":           {"pinfu"},
	"yakuhai":         {"haku", "hatsu", "chun", "ton"},
	"iipeikou":        {"iipeikou"},
	"sanshoku":        {"sanshoku"},
	"ittsu":           {"ittsu"},
	"chanta":          {"chanta"},
	"chiitoitsu":      {"chiitoitsu"},
	"toitoi":          nil, // closed, four triplets won by tsumo are 四暗刻
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

// tenpaiBy is the discards the 立直 family has to reach tenpai in: ダブル立直
// is declared with the first one.
var tenpaiBy = map[string]int{"riichi": 6, "ippatsu": 6, "double_riichi": 1}

// dealShantenMax skips, in the search, the deals further than this from the
// yaku's rows (default 3), to keep the search short.
var dealShantenMax = map[string]int{
	"double_riichi": 1, "chinitsu": 4, "honroutou": 4, "sanshoku_doukou": 6,
	"shousangen": 6, "ryanpeikou": 4, "junchan": 4,
}

const (
	goalWin    = "win"
	goalTenpai = "tenpai"
)

type seedEntry struct {
	Goal  string `json:"goal"`
	Seeds []int  `json:"seeds"`
}

type seedTable struct {
	Range int                  `json:"range"`
	Seeds map[string]seedEntry `json:"seeds"`
}

func goalOf(key string) string {
	if _, ok := tenpaiBy[key]; ok {
		return goalTenpai
	}
	return goalWin
}

// lineRow is the yaku's row nearest a deal (the first listed on a tie; ok
// false: none of its rows is possible), and the deal's shanten there.
func lineRow(deal []yakushanten.Result, key string) (row string, shanten int, ok bool) {
	for _, r := range practiceRows[key] {
		for _, d := range deal {
			if d.Key == r && d.Possible && (!ok || d.Shanten < shanten) {
				row, shanten, ok = r, d.Shanten, true
			}
		}
	}
	return row, shanten, ok
}

// scores reports whether a win scores the yaku key (役牌: any of its rows').
func scores(w yaku.Win, key string) bool {
	want := practiceRows[key]
	if key != "yakuhai" {
		want = []string{key}
	}
	return slices.ContainsFunc(w.Yaku, func(y yaku.Yaku) bool { return slices.Contains(want, y.Key) })
}

// tenpaiLine plays the 立直 family's line on a seed: each turn, the discard
// leaving the lowest normal-form shanten (then the most unseen ukeire, then
// the first tile in hand order), until tenpai or tenpaiBy discards. It returns
// the discards and whether the hand is tenpai.
func tenpaiLine(an *yakushanten.Analyzer, seed int64, key string) ([]string, bool) {
	w := wall.New(seed)
	hand := w.Hand()
	var moves []string
	for turn := range tenpaiBy[key] {
		d, _ := w.Draw(turn)
		tiles := append(slices.Clone(hand), d)
		tile.Sort(tiles)
		all := tile.CountsOf(tiles)
		best, bestShanten, bestUkeire := -1, 0, 0
		for i, x := range tiles {
			if i > 0 && tiles[i-1] == x {
				continue
			}
			c := all
			c[x.Kind]--
			r := an.NormalShanten(c)
			uk := 0
			for _, k := range r.Ukeire {
				uk += 4 - all[k]
			}
			if best < 0 || r.Shanten < bestShanten || r.Shanten == bestShanten && uk > bestUkeire {
				best, bestShanten, bestUkeire = i, r.Shanten, uk
			}
		}
		moves = append(moves, tiles[best].String())
		hand = append(tiles[:best:best], tiles[best+1:]...)
		if bestShanten == 0 {
			return moves, true
		}
	}
	return moves, false
}

// completeHands calls visit with each complete hand (four groups and a pair,
// or seven pairs) within avail that holds a w, each once, until visit
// returns false.
func completeHands(avail tile.Counts, w tile.Kind, visit func(tile.Counts) bool) {
	seen := map[tile.Counts]bool{}
	var h tile.Counts
	emit := func() bool {
		if h[w] == 0 || seen[h] {
			return true
		}
		seen[h] = true
		return visit(h)
	}
	var groups func(from tile.Kind, left int) bool
	groups = func(from tile.Kind, left int) bool {
		if left == 0 {
			return emit()
		}
		for k := from; k < tile.NumKinds; k++ {
			if avail[k]-h[k] >= 3 {
				h[k] += 3
				ok := groups(k, left-1)
				h[k] -= 3
				if !ok {
					return false
				}
			}
			if !k.IsHonor() && k.Num() <= 7 && avail[k]-h[k] >= 1 && avail[k+1]-h[k+1] >= 1 && avail[k+2]-h[k+2] >= 1 {
				h[k]++
				h[k+1]++
				h[k+2]++
				ok := groups(k, left-1)
				h[k]--
				h[k+1]--
				h[k+2]--
				if !ok {
					return false
				}
			}
		}
		return true
	}
	for p := range tile.Kind(tile.NumKinds) {
		if avail[p] >= 2 {
			h[p] += 2
			ok := groups(0, 4)
			h[p] -= 2
			if !ok {
				return
			}
		}
	}
	var pairs func(from tile.Kind, left int) bool
	pairs = func(from tile.Kind, left int) bool {
		if left == 0 {
			return emit()
		}
		for k := from; k < tile.NumKinds; k++ {
			if avail[k] >= 2 {
				h[k] = 2
				ok := pairs(k+1, left-1)
				h[k] = 0
				if !ok {
					return false
				}
			}
		}
		return true
	}
	pairs(0, 7)
}

// winLines finds, for each of keys, a line of play on a seed that wins by
// tsumo scoring the yaku within practiceTurns, if there is one; it is exact.
// The draws do not depend on the discards, so a hand H can be held complete
// on draw k exactly when H takes draw k and otherwise only tiles of the deal
// and the earlier draws: each turn holds 14 tiles, at most 13 of them H's, so
// there is always one to discard. Draw by draw, the first such H (in
// completeHands' order) scoring the yaku makes the line; the result maps each
// key found to its moves (discards, then "tsumo").
func winLines(seed int64, keys []string) map[string][]string {
	w := wall.New(seed)
	deal := w.Hand()
	out := map[string][]string{}
	pool := tile.CountsOf(deal)
	for k := range practiceTurns {
		d, _ := w.Draw(k)
		avail := pool
		avail[d.Kind]++
		completeHands(avail, d.Kind, func(h tile.Counts) bool {
			var tiles []tile.Tile
			for kind, n := range h {
				for range n {
					tiles = append(tiles, tile.Tile{Kind: tile.Kind(kind)})
				}
			}
			res, ok := yaku.Evaluate(tiles, yaku.Context{WinTile: d.Kind, Winds: winds})
			if !ok {
				return true
			}
			for _, key := range keys {
				if _, have := out[key]; !have && scores(res, key) {
					out[key] = lineTo(w, deal, k, h)
				}
			}
			return len(out) < len(keys)
		})
		if len(out) == len(keys) {
			break
		}
		pool[d.Kind]++
	}
	return out
}

// lineTo is the line that holds h complete on draw k: each turn discards the
// first tile in hand order of a kind held beyond h's count.
func lineTo(w *wall.Wall, hand []tile.Tile, k int, h tile.Counts) []string {
	d, _ := w.Draw(k)
	keep := h
	keep[d.Kind]--
	var moves []string
	for turn := range k {
		d, _ := w.Draw(turn)
		tiles := append(slices.Clone(hand), d)
		tile.Sort(tiles)
		c := tile.CountsOf(tiles)
		i := slices.IndexFunc(tiles, func(x tile.Tile) bool { return c[x.Kind] > keep[x.Kind] })
		moves = append(moves, tiles[i].String())
		hand = append(tiles[:i:i], tiles[i+1:]...)
	}
	return append(moves, StatusTsumo)
}

// practiceLine is a yaku's line on a seed and whether it reaches the goal.
func practiceLine(an *yakushanten.Analyzer, seed int64, key string) ([]string, bool) {
	if goalOf(key) == goalTenpai {
		return tenpaiLine(an, seed, key)
	}
	line, ok := winLines(seed, []string{key})[key]
	return line, ok
}

// searchSeeds finds, for each practicable yaku, the first seedsPerYaku seeds
// in 1..seedRange (among the deals within dealShantenMax of its row) whose
// line reaches the goal.
func searchSeeds() seedTable {
	out := seedTable{Range: seedRange, Seeds: map[string]seedEntry{}}
	an := yakushanten.NewAnalyzer()
	for key, rows := range practiceRows {
		if rows != nil {
			out.Seeds[key] = seedEntry{Goal: goalOf(key), Seeds: []int{}}
		}
	}
	for seed := 1; seed <= seedRange && !full(out); seed++ {
		deal := an.Analyze(tile.CountsOf(wall.New(int64(seed)).Hand()))
		var wins []string
		for key, e := range out.Seeds {
			if len(e.Seeds) >= seedsPerYaku {
				continue
			}
			limit, ok := dealShantenMax[key]
			if !ok {
				limit = 3
			}
			if _, sh, ok := lineRow(deal, key); !ok || sh > limit {
				continue
			}
			if e.Goal == goalWin {
				wins = append(wins, key)
			} else if _, ok := tenpaiLine(an, int64(seed), key); ok {
				e.Seeds = append(e.Seeds, seed)
				out.Seeds[key] = e
			}
		}
		for key := range winLines(int64(seed), wins) {
			e := out.Seeds[key]
			e.Seeds = append(e.Seeds, seed)
			out.Seeds[key] = e
		}
	}
	return out
}

// full reports whether every yaku has its seedsPerYaku seeds.
func full(t seedTable) bool {
	for _, e := range t.Seeds {
		if len(e.Seeds) < seedsPerYaku {
			return false
		}
	}
	return true
}

func readSeeds(t testing.TB) seedTable {
	t.Helper()
	var got seedTable
	dec := json.NewDecoder(strings.NewReader(webts.Read(t, seedsFile)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&got); err != nil {
		t.Fatalf("%s: %v", seedsFile, err)
	}
	return got
}

func TestYakuGuideSeeds(t *testing.T) {
	if testmode.Full() || os.Getenv("UPDATE_YAKU_SEEDS") != "" {
		want := searchSeeds()
		if os.Getenv("UPDATE_YAKU_SEEDS") != "" {
			b, err := json.MarshalIndent(want, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile("../../web/"+seedsFile, append(b, '\n'), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		gb, _ := json.Marshal(readSeeds(t))
		wb, _ := json.Marshal(want)
		if string(gb) != string(wb) {
			t.Fatalf("%s is stale; run UPDATE_YAKU_SEEDS=1 go test ./internal/session -run TestYakuGuideSeeds\n got: %s\nwant: %s", seedsFile, gb, wb)
		}
	}
	got := readSeeds(t)

	// The table's keys are the guide's yaku, bar those practice cannot reach.
	guide := readGuide(t)
	for key := range guide {
		rows, ok := practiceRows[key]
		if !ok {
			t.Errorf("%s: %s has no practiceRows entry", guideFile, key)
		}
		if _, have := got.Seeds[key]; have == (rows == nil) {
			t.Errorf("%s: seeds for %s present=%v, want %v", seedsFile, key, have, rows != nil)
		}
	}

	// Each seed's line, played in a practice session, reaches the goal.
	an := yakushanten.NewAnalyzer()
	st := NewStore(1)
	for key, e := range got.Seeds {
		if e.Goal != goalOf(key) {
			t.Errorf("%s: goal %q, want %q", key, e.Goal, goalOf(key))
		}
		if len(e.Seeds) == 0 {
			t.Errorf("%s: no seeds", key)
		}
		for _, seed := range e.Seeds {
			moves, ok := practiceLine(an, int64(seed), key)
			if !ok {
				t.Errorf("%s: seed %d: the line misses the goal (%v)", key, seed, moves)
				continue
			}
			s64 := int64(seed)
			s, err := st.Create(&s64, practiceTurns)
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range moves {
				if m == StatusTsumo {
					err = s.tsumo(nil)
				} else {
					err = s.discard(m, nil, false)
				}
				if err != nil {
					t.Fatalf("%s: seed %d: %s: %v", key, seed, m, err)
				}
			}
			n := s.nodes[s.current]
			switch e.Goal {
			case goalWin:
				if n.win == nil || !scores(yaku.Win{Yaku: n.win.Yaku}, key) {
					t.Errorf("%s: seed %d: the session's win %+v does not score it", key, seed, n.win)
				}
			case goalTenpai:
				if sh := an.NormalShanten(tile.CountsOf(n.hand)); sh.Shanten != 0 || n.turn > tenpaiBy[key] {
					t.Errorf("%s: seed %d: turn %d normal shanten %d, want tenpai by turn %d", key, seed, n.turn, sh.Shanten, tenpaiBy[key])
				}
			}
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
