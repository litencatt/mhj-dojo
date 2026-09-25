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
	UraDora  int // ura dora; counted only for a riichi hand
	HanTotal int // yaku + dora + ura dora (yakuman: yaku only)
	Fu       int // 0 for yakuman
	// Reading is the scored 4 melds + pair reading; nil for seven pairs and
	// thirteen orphans.
	Reading *Reading
}

// HasYaku reports whether the win has a yaku; dora alone cannot win.
func (w Win) HasYaku() bool { return len(w.Yaku) > 0 }

// Context describes how a hand was won. The zero value of the flags is a
// plain closed tsumo without melds, which is every Phase 1 win.
type Context struct {
	WinTile tile.Kind
	// Ron is a win on another player's discard; false is a tsumo.
	Ron bool
	// Riichi and DoubleRiichi (a riichi on the first uninterrupted discard)
	// are exclusive; Ippatsu needs one of them.
	Riichi, DoubleRiichi, Ippatsu bool
	// Haitei is a tsumo on the last draw, Houtei a ron on the last discard.
	Haitei, Houtei bool
	Winds          Winds
	DoraIndicators []tile.Tile
	// UraIndicators are counted only when the hand is in riichi.
	UraIndicators []tile.Tile
	// Melds are the called melds (and ankan), and MeldTiles their tiles,
	// which count for dora.
	Melds     []Meld
	MeldTiles []tile.Tile
}

func (ctx Context) inRiichi() bool { return ctx.Riichi || ctx.DoubleRiichi }

// Open reports whether the hand has called a meld; an ankan keeps it closed.
func (ctx Context) Open() bool {
	return slices.ContainsFunc(ctx.Melds, func(m Meld) bool { return m.Open })
}

// kuisagari lowers the han of the yaku that lose one han when open.
func kuisagari(y Yaku, open bool) Yaku {
	if open {
		y.Han--
	}
	return y
}

// Han values of a closed hand.
var (
	yRiichi       = Yaku{"riichi", "立直", 1}
	yDoubleRiichi = Yaku{"double_riichi", "ダブル立直", 2}
	yIppatsu      = Yaku{"ippatsu", "一発", 1}
	yHaitei       = Yaku{"haitei", "海底摸月", 1}
	yHoutei       = Yaku{"houtei", "河底撈魚", 1}
	yTsumo        = Yaku{"tsumo", "門前清自摸和", 1}
	yTanyao       = Yaku{"tanyao", "断么九", 1}
	yPinfu        = Yaku{"pinfu", "平和", 1}
	yIipeikou     = Yaku{"iipeikou", "一盃口", 1}
	yRyanpeikou   = Yaku{"ryanpeikou", "二盃口", 3}
	ySanshoku     = Yaku{"sanshoku", "三色同順", 2}
	yDoukou       = Yaku{"sanshoku_doukou", "三色同刻", 2}
	yIttsu        = Yaku{"ittsu", "一気通貫", 2}
	yChanta       = Yaku{"chanta", "混全帯么九", 2}
	yJunchan      = Yaku{"junchan", "純全帯么九", 3}
	yHonroutou    = Yaku{"honroutou", "混老頭", 2}
	yHonitsu      = Yaku{"honitsu", "混一色", 3}
	yChinitsu     = Yaku{"chinitsu", "清一色", 6}
	yToitoi       = Yaku{"toitoi", "対々和", 2}
	ySanankou     = Yaku{"sanankou", "三暗刻", 2}
	yShousangen   = Yaku{"shousangen", "小三元", 2}
	yHaku         = Yaku{"haku", "役牌 白", 1}
	yHatsu        = Yaku{"hatsu", "役牌 發", 1}
	yChun         = Yaku{"chun", "役牌 中", 1}
	yChiitoitsu   = Yaku{"chiitoitsu", "七対子", 2}
)

// Yakuman: 13 han each; several yakuman add up, and a hand with any yakuman
// scores only its yakuman (no dora, no other yaku).
var (
	yKokushi     = Yaku{"kokushi", "国士無双", 13}
	ySuuankou    = Yaku{"suuankou", "四暗刻", 13}
	yDaisangen   = Yaku{"daisangen", "大三元", 13}
	yTsuuiisou   = Yaku{"tsuuiisou", "字一色", 13}
	yShousuushii = Yaku{"shousuushii", "小四喜", 13}
	yDaisuushii  = Yaku{"daisuushii", "大四喜", 13}
	yRyuuiisou   = Yaku{"ryuuiisou", "緑一色", 13}
	yChinroutou  = Yaku{"chinroutou", "清老頭", 13}
	yChuuren     = Yaku{"chuuren", "九蓮宝燈", 13}
)

// closedHan maps each yaku key to its han in a closed hand. Value winds are
// handled by HanFor.
var closedHan = func() map[string]int {
	m := map[string]int{}
	for _, y := range []Yaku{
		yRiichi, yDoubleRiichi, yIppatsu, yHaitei, yHoutei,
		yTsumo, yTanyao, yPinfu, yIipeikou, yRyanpeikou, ySanshoku, yDoukou, yIttsu,
		yChanta, yJunchan, yHonroutou, yHonitsu, yChinitsu, yToitoi, ySanankou,
		yShousangen, yHaku, yHatsu, yChun, yChiitoitsu,
		yKokushi, ySuuankou, yDaisangen, yTsuuiisou, yShousuushii, yDaisuushii,
		yRyuuiisou, yChinroutou, yChuuren,
	} {
		m[y.Key] = y.Han
	}
	return m
}()

// HanFor returns the han of the yaku with the given key in a closed hand
// with the given winds, or 0 if key is not a yaku (e.g. "normal"). A value
// wind counts once for the round wind and once for the seat wind, so it is 0
// when it is neither.
func HanFor(key string, w Winds) int {
	for i, wk := range WindKeys {
		if wk == key {
			return w.Count(tile.East + tile.Kind(i))
		}
	}
	return closedHan[key]
}

// Evaluate detects the yaku of a complete hand: the concealed tiles
// (including the winning tile, 14 - 3*len(ctx.Melds) of them) and the called
// melds in ctx. It chooses the reading with the most han, then the most fu
// (a yakuman reading always wins). ok is false if the tiles are not complete
// or do not contain ctx.WinTile. A complete hand without yaku is ok with no
// Yaku; callers must check HasYaku before allowing the win.
func Evaluate(tiles []tile.Tile, ctx Context) (win Win, ok bool) {
	c := tile.CountsOf(tiles)
	if len(tiles) != 14-3*len(ctx.Melds) || c[ctx.WinTile] == 0 || !IsCompleteWith(c, ctx.Melds) {
		return Win{}, false
	}
	shown := append(slices.Clone(tiles), ctx.MeldTiles...)
	win.Dora = countRed(shown) + countDora(shown, ctx.DoraIndicators)
	if ctx.inRiichi() {
		win.UraDora = countDora(shown, ctx.UraIndicators)
	}
	// all counts every tile of the hand (a kan as three) for the yaku that
	// depend only on the tile set.
	all := c
	for _, m := range ctx.Melds {
		for i := range 3 {
			if m.Type == Seq {
				all[m.Kind+tile.Kind(i)]++
			} else {
				all[m.Kind]++
			}
		}
	}
	if IsKokushi(c) {
		win.Yaku = []Yaku{yKokushi}
		win.HanTotal = yKokushi.Han
		return win, true
	}
	var best, bestYakuman []Yaku
	var bestReading, bestYakumanReading *Reading
	bestHan, bestFu, bestYakumanHan := -1, 0, 0
	consider := func(ys, yakuman []Yaku, fu int, r *Reading) {
		if h := sumHan(yakuman); h > bestYakumanHan {
			bestYakuman, bestYakumanHan, bestYakumanReading = order(yakuman), h, r
		}
		if h := sumHan(ys); h > bestHan || (h == bestHan && fu > bestFu) {
			best, bestHan, bestFu, bestReading = order(ys), h, fu, r
		}
	}
	if len(ctx.Melds) == 0 && IsChiitoitsu(c) {
		ys := situational(ctx)
		ys = append(ys, handWide(c, false)...)
		if onlyYaochu(c) {
			ys = append(ys, yHonroutou)
		}
		ys = append(ys, yChiitoitsu)
		consider(ys, yakumanWide(c, false, true), chiitoitsuFu, nil)
	}
	for _, r := range ReadingsWith(c, ctx.Melds, ctx.WinTile) {
		ys := evalReading(all, r, ctx)
		consider(ys, append(yakumanWide(all, true, len(ctx.Melds) == 0), yakumanReading(r, ctx)...), Fu(r, ctx), &r)
	}
	if bestYakumanHan > 0 {
		win.Yaku = bestYakuman
		win.HanTotal = bestYakumanHan
		win.Reading = bestYakumanReading
		return win, true
	}
	win.Yaku = best
	win.Reading = bestReading
	win.Fu = bestFu
	if len(best) > 0 {
		win.HanTotal = bestHan + win.Dora + win.UraDora
	}
	return win, true
}

// situational returns the yaku that come from how the hand was won rather
// than from its shape.
func situational(ctx Context) []Yaku {
	var ys []Yaku
	switch {
	case ctx.DoubleRiichi:
		ys = append(ys, yDoubleRiichi)
	case ctx.Riichi:
		ys = append(ys, yRiichi)
	}
	if ctx.Ippatsu && ctx.inRiichi() {
		ys = append(ys, yIppatsu)
	}
	if !ctx.Ron {
		if !ctx.Open() {
			ys = append(ys, yTsumo) // 門前清自摸和 needs a closed hand
		}
		if ctx.Haitei {
			ys = append(ys, yHaitei)
		}
	} else if ctx.Houtei {
		ys = append(ys, yHoutei)
	}
	return ys
}

// yakumanWide returns the yakuman that depend only on the tile set; standard
// reports a 4 melds + pair reading (false: seven pairs), and noMelds a hand
// without called melds or kan (needed for chuuren).
func yakumanWide(c tile.Counts, standard, noMelds bool) []Yaku {
	allHonor, allTerminal, allGreen, anyHonor := true, true, true, false
	suits := map[int]bool{}
	for k, n := range c {
		if n == 0 {
			continue
		}
		kk := tile.Kind(k)
		allHonor = allHonor && kk.IsHonor()
		allTerminal = allTerminal && kk.IsTerminal()
		allGreen = allGreen && green[kk]
		if kk.IsHonor() {
			anyHonor = true
		} else {
			suits[kk.Suit()] = true
		}
	}
	var ys []Yaku
	if allHonor {
		ys = append(ys, yTsuuiisou)
	}
	if !standard {
		return ys
	}
	if allTerminal {
		ys = append(ys, yChinroutou)
	}
	if allGreen {
		ys = append(ys, yRyuuiisou)
	}
	if noMelds && len(suits) == 1 && !anyHonor {
		for s := range suits {
			chuuren := true
			for n, need := range [9]int{3, 1, 1, 1, 1, 1, 1, 1, 3} {
				chuuren = chuuren && c[tile.MakeKind(s, n+1)] >= need
			}
			if chuuren {
				ys = append(ys, yChuuren)
			}
		}
	}
	return ys
}

// green holds the tiles of 緑一色: 2 3 4 6 8s and 發.
var green = map[tile.Kind]bool{
	tile.MakeKind(tile.Sou, 2): true, tile.MakeKind(tile.Sou, 3): true, tile.MakeKind(tile.Sou, 4): true,
	tile.MakeKind(tile.Sou, 6): true, tile.MakeKind(tile.Sou, 8): true, tile.Hatsu: true,
}

// yakumanReading returns the yakuman of one reading.
func yakumanReading(r Reading, ctx Context) []Yaku {
	dragons, winds := 0, 0
	for _, m := range r.Melds {
		if m.Type != Trip {
			continue
		}
		switch {
		case m.Kind >= tile.Haku:
			dragons++
		case m.Kind >= tile.East:
			winds++
		}
	}
	var ys []Yaku
	if concealedTrips(r, ctx) == 4 {
		ys = append(ys, ySuuankou)
	}
	if dragons == 3 {
		ys = append(ys, yDaisangen)
	}
	switch {
	case winds == 4:
		ys = append(ys, yDaisuushii)
	case winds == 3 && r.Pair >= tile.East && r.Pair <= tile.North:
		ys = append(ys, yShousuushii)
	}
	return ys
}

func sumHan(ys []Yaku) int {
	n := 0
	for _, y := range ys {
		n += y.Han
	}
	return n
}

// handWide returns yaku that depend only on the tile set: tanyao (open
// tanyao allowed), honitsu, chinitsu.
func handWide(c tile.Counts, open bool) []Yaku {
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
			ys = append(ys, kuisagari(yHonitsu, open))
		} else {
			ys = append(ys, kuisagari(yChinitsu, open))
		}
	}
	return ys
}

func onlyYaochu(c tile.Counts) bool {
	for k, n := range c {
		if n > 0 && !tile.Kind(k).IsYaochu() {
			return false
		}
	}
	return true
}

// IsValuePair reports whether a pair of k is a value pair (dragon, round
// wind or seat wind), which rules out pinfu and, from Phase 2, adds fu.
func (ctx Context) IsValuePair(k tile.Kind) bool {
	return k >= tile.Haku || ctx.Winds.Count(k) > 0
}

// IsPinfu reports whether r is a pinfu reading: a closed hand of four
// sequences, a non-value pair and a two-sided wait.
func IsPinfu(r Reading, ctx Context) bool {
	if len(ctx.Melds) > 0 {
		return false
	}
	for _, m := range r.Melds {
		if m.Type != Seq {
			return false
		}
	}
	return r.Wait == Ryanmen && !ctx.IsValuePair(r.Pair)
}

// ronCompleted reports whether meld i was completed by the winning tile on a
// ron; such a triplet counts as open.
func (r Reading) ronCompleted(i int, ctx Context) bool {
	return ctx.Ron && i == r.WinGroup
}

// concealed reports whether meld i of r is concealed: not called, and not a
// triplet the winning tile completed on a ron. An ankan is concealed.
func (r Reading) concealed(i int, ctx Context) bool {
	return !r.Melds[i].Open && !r.ronCompleted(i, ctx)
}

// concealedTrips counts the concealed triplets (and ankan) of a reading.
func concealedTrips(r Reading, ctx Context) int {
	n := 0
	for i, m := range r.Melds {
		if m.Type == Trip && r.concealed(i, ctx) {
			n++
		}
	}
	return n
}

// evalReading returns the yaku of one reading; c counts every tile of the
// hand, called melds included.
func evalReading(c tile.Counts, r Reading, ctx Context) []Yaku {
	d := &r.Decomposition
	open := ctx.Open()
	ys := situational(ctx)
	ys = append(ys, handWide(c, open)...)

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

	if IsPinfu(r, ctx) {
		ys = append(ys, yPinfu)
	}
	peikou := 0
	for _, n := range seqCount {
		peikou += n / 2
	}
	switch {
	case open: // iipeikou and ryanpeikou need a closed hand
	case peikou == 2:
		ys = append(ys, yRyanpeikou)
	case peikou == 1:
		ys = append(ys, yIipeikou)
	}
	for n := 1; n <= 7; n++ {
		if seqCount[tile.MakeKind(tile.Man, n)] > 0 && seqCount[tile.MakeKind(tile.Pin, n)] > 0 &&
			seqCount[tile.MakeKind(tile.Sou, n)] > 0 {
			ys = append(ys, kuisagari(ySanshoku, open))
			break
		}
	}
	for n := 1; n <= 9; n++ {
		if d.hasTrip(tile.MakeKind(tile.Man, n)) && d.hasTrip(tile.MakeKind(tile.Pin, n)) &&
			d.hasTrip(tile.MakeKind(tile.Sou, n)) {
			ys = append(ys, yDoukou)
			break
		}
	}
	for s := tile.Man; s <= tile.Sou; s++ {
		if seqCount[tile.MakeKind(s, 1)] > 0 && seqCount[tile.MakeKind(s, 4)] > 0 &&
			seqCount[tile.MakeKind(s, 7)] > 0 {
			ys = append(ys, kuisagari(yIttsu, open))
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
			ys = append(ys, kuisagari(yChanta, open))
		} else {
			ys = append(ys, kuisagari(yJunchan, open))
		}
	}

	// honroutou: only terminals and honors, i.e. all triplets (chanta/junchan need a sequence).
	if allYaochu && seqs == 0 {
		ys = append(ys, yHonroutou)
	}
	if trips == 4 {
		ys = append(ys, yToitoi)
	}
	if concealedTrips(r, ctx) >= 3 {
		ys = append(ys, ySanankou)
	}
	dragonTrips := 0
	for _, m := range d.Melds {
		if m.Type == Trip && m.Kind >= tile.Haku {
			dragonTrips++
		}
	}
	if d.Pair >= tile.Haku && dragonTrips == 2 {
		ys = append(ys, yShousangen)
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
			if han := ctx.Winds.Count(m.Kind); han > 0 {
				i := m.Kind - tile.East
				ys = append(ys, Yaku{WindKeys[i], "役牌 " + WindNames[i], han})
			}
		}
	}
	return ys
}

// displayOrder is the canonical display order of yaku keys.
var displayOrder = map[string]int{}

func init() {
	for i, k := range []string{
		"riichi", "double_riichi", "ippatsu", "tsumo", "haitei", "houtei", "tanyao", "pinfu", "iipeikou", "ryanpeikou", "sanshoku", "sanshoku_doukou",
		"ittsu", "chanta", "junchan", "honroutou", "honitsu", "chinitsu", "toitoi", "sanankou",
		"shousangen", "haku", "hatsu", "chun", "ton", "nan", "shaa", "pei", "chiitoitsu",
		"kokushi", "suuankou", "daisangen", "tsuuiisou", "shousuushii", "daisuushii",
		"ryuuiisou", "chinroutou", "chuuren",
	} {
		displayOrder[k] = i
	}
}

// order sorts yaku into the canonical display order.
func order(ys []Yaku) []Yaku {
	slices.SortStableFunc(ys, func(a, b Yaku) int { return displayOrder[a.Key] - displayOrder[b.Key] })
	return ys
}

func countRed(tiles []tile.Tile) int {
	n := 0
	for _, t := range tiles {
		if t.Red {
			n++
		}
	}
	return n
}

// countDora counts the tiles that are dora for the given indicators.
func countDora(tiles []tile.Tile, indicators []tile.Tile) int {
	n := 0
	for _, t := range tiles {
		for _, ind := range indicators {
			if t.Kind == tile.DoraFromIndicator(ind.Kind) {
				n++
			}
		}
	}
	return n
}
