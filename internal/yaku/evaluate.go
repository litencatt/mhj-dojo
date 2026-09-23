package yaku

import (
	"slices"

	"github.com/litencatt/mhj2/internal/tile"
)

// Yaku is one scoring element of a win.
type Yaku struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Han  int    `json:"han"`
}

// Win is the evaluation of a complete hand.
type Win struct {
	Yaku     []Yaku
	Dora     int // dora + red fives
	HanTotal int
}

// Context describes how the hand was won. Phase 1 wins are always closed tsumo.
type Context struct {
	WinTile        tile.Kind
	RoundWind      tile.Kind
	SeatWind       tile.Kind
	DoraIndicators []tile.Tile
}

// Han values of a closed hand.
var (
	yTsumo      = Yaku{"tsumo", "門前清自摸和", 1}
	yTanyao     = Yaku{"tanyao", "断么九", 1}
	yPinfu      = Yaku{"pinfu", "平和", 1}
	yIipeikou   = Yaku{"iipeikou", "一盃口", 1}
	ySanshoku   = Yaku{"sanshoku", "三色同順", 2}
	yIttsu      = Yaku{"ittsu", "一気通貫", 2}
	yChanta     = Yaku{"chanta", "混全帯么九", 2}
	yJunchan    = Yaku{"junchan", "純全帯么九", 3}
	yHonitsu    = Yaku{"honitsu", "混一色", 3}
	yChinitsu   = Yaku{"chinitsu", "清一色", 6}
	yToitoi     = Yaku{"toitoi", "対々和", 2}
	ySanankou   = Yaku{"sanankou", "三暗刻", 2}
	yHaku       = Yaku{"haku", "役牌 白", 1}
	yHatsu      = Yaku{"hatsu", "役牌 發", 1}
	yChun       = Yaku{"chun", "役牌 中", 1}
	yChiitoitsu = Yaku{"chiitoitsu", "七対子", 2}
	yKokushi    = Yaku{"kokushi", "国士無双", 13}
)

var windKeys = [4]struct{ key, name string }{
	{"ton", "役牌 東"}, {"nan", "役牌 南"}, {"shaa", "役牌 西"}, {"pei", "役牌 北"},
}

// Evaluate detects the yaku of a complete 14-tile closed tsumo hand, choosing
// the reading with the most han. ok is false if the tiles are not complete.
func Evaluate(tiles []tile.Tile, ctx Context) (win Win, ok bool) {
	c := tile.CountsOf(tiles)
	if len(tiles) != 14 || !IsComplete(c) {
		return Win{}, false
	}
	win.Dora = countDora(tiles, ctx.DoraIndicators)
	if IsKokushi(c) {
		win.Yaku = []Yaku{yKokushi}
		win.HanTotal = yKokushi.Han
		return win, true
	}
	var best []Yaku
	bestHan := -1
	consider := func(ys []Yaku) {
		if h := sumHan(ys); h > bestHan {
			best, bestHan = ys, h
		}
	}
	if IsChiitoitsu(c) {
		ys := []Yaku{yTsumo}
		ys = append(ys, handWide(c)...)
		ys = append(ys, yChiitoitsu)
		consider(order(ys))
	}
	for _, d := range Decompose(c) {
		consider(order(evalDecomp(c, d, ctx)))
	}
	win.Yaku = best
	win.HanTotal = bestHan + win.Dora
	return win, true
}

func sumHan(ys []Yaku) int {
	n := 0
	for _, y := range ys {
		n += y.Han
	}
	return n
}

// handWide returns yaku that depend only on the tile set: tanyao, honitsu, chinitsu.
func handWide(c tile.Counts) []Yaku {
	var ys []Yaku
	yaochu, honors := false, false
	suits := map[int]bool{}
	for k, n := range c {
		if n == 0 {
			continue
		}
		kk := tile.Kind(k)
		if kk.IsYaochu() {
			yaochu = true
		}
		if kk.IsHonor() {
			honors = true
		} else {
			suits[kk.Suit()] = true
		}
	}
	if !yaochu {
		ys = append(ys, yTanyao)
	}
	if len(suits) == 1 {
		if honors {
			ys = append(ys, yHonitsu)
		} else {
			ys = append(ys, yChinitsu)
		}
	}
	return ys
}

func isValuePair(k tile.Kind, ctx Context) bool {
	return k >= tile.Haku || k == ctx.RoundWind || k == ctx.SeatWind
}

func evalDecomp(c tile.Counts, d Decomposition, ctx Context) []Yaku {
	ys := []Yaku{yTsumo}
	ys = append(ys, handWide(c)...)

	seqs, trips := 0, 0
	var seqCount [tile.NumKinds]int
	for _, m := range d.Melds {
		if m.Type == Seq {
			seqs++
			seqCount[m.Kind]++
		} else {
			trips++
		}
	}

	// pinfu: four sequences, non-value pair, some two-sided reading of the winning tile.
	if seqs == 4 && !isValuePair(d.Pair, ctx) {
		for _, m := range d.Melds {
			if IsRyanmen(m, ctx.WinTile) {
				ys = append(ys, yPinfu)
				break
			}
		}
	}
	for _, n := range seqCount {
		if n >= 2 {
			ys = append(ys, yIipeikou)
			break
		}
	}
	for n := 1; n <= 7; n++ {
		if seqCount[tile.MakeKind(tile.Man, n)] > 0 && seqCount[tile.MakeKind(tile.Pin, n)] > 0 &&
			seqCount[tile.MakeKind(tile.Sou, n)] > 0 {
			ys = append(ys, ySanshoku)
			break
		}
	}
	for s := tile.Man; s <= tile.Sou; s++ {
		if seqCount[tile.MakeKind(s, 1)] > 0 && seqCount[tile.MakeKind(s, 4)] > 0 &&
			seqCount[tile.MakeKind(s, 7)] > 0 {
			ys = append(ys, yIttsu)
			break
		}
	}

	// chanta / junchan: every group holds a terminal or honor, with at least one sequence.
	allYaochu, anyHonor := d.Pair.IsYaochu(), d.Pair.IsHonor()
	for _, m := range d.Melds {
		if m.Type == Trip {
			allYaochu = allYaochu && m.Kind.IsYaochu()
			anyHonor = anyHonor || m.Kind.IsHonor()
		} else {
			allYaochu = allYaochu && (m.Kind.Num() == 1 || m.Kind.Num() == 7)
		}
	}
	if allYaochu && seqs > 0 {
		if anyHonor {
			ys = append(ys, yChanta)
		} else {
			ys = append(ys, yJunchan)
		}
	}

	if trips == 4 {
		ys = append(ys, yToitoi)
	}
	// All triplets are concealed on a closed tsumo.
	if trips >= 3 {
		ys = append(ys, ySanankou)
	}
	for _, m := range d.Melds {
		if m.Type != Trip {
			continue
		}
		switch {
		case m.Kind == tile.Haku:
			ys = append(ys, yHaku)
		case m.Kind == tile.Hatsu:
			ys = append(ys, yHatsu)
		case m.Kind == tile.Chun:
			ys = append(ys, yChun)
		case m.Kind >= tile.East && m.Kind <= tile.North:
			han := 0
			if m.Kind == ctx.RoundWind {
				han++
			}
			if m.Kind == ctx.SeatWind {
				han++
			}
			if han > 0 {
				w := windKeys[m.Kind-tile.East]
				ys = append(ys, Yaku{w.key, w.name, han})
			}
		}
	}
	return ys
}

// displayOrder is the canonical display order of yaku keys.
var displayOrder = map[string]int{}

func init() {
	for i, k := range []string{
		"tsumo", "tanyao", "pinfu", "iipeikou", "sanshoku", "ittsu", "chanta", "junchan",
		"honitsu", "chinitsu", "toitoi", "sanankou", "haku", "hatsu", "chun",
		"ton", "nan", "shaa", "pei", "chiitoitsu", "kokushi",
	} {
		displayOrder[k] = i
	}
}

// order sorts yaku into the canonical display order.
func order(ys []Yaku) []Yaku {
	slices.SortStableFunc(ys, func(a, b Yaku) int { return displayOrder[a.Key] - displayOrder[b.Key] })
	return ys
}

func countDora(tiles []tile.Tile, indicators []tile.Tile) int {
	n := 0
	for _, t := range tiles {
		if t.Red {
			n++
		}
		for _, ind := range indicators {
			if t.Kind == tile.DoraFromIndicator(ind.Kind) {
				n++
			}
		}
	}
	return n
}
