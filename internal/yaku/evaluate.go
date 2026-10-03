package yaku

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// Yaku is one scoring element of a win.
type Yaku struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Han  int    `json:"han"`
	open openRule
}

// openRule is how a yaku scores in an open hand (one with a called meld).
type openRule uint8

const (
	openSame      openRule = iota // scores as in a closed hand
	openKuisagari                 // one han less (kuisagari)
	openNever                     // needs a closed hand
)

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
	// Rinshan is a tsumo on the replacement tile after a kan, Chankan a ron
	// on the tile added to a pon (robbing the kan).
	Rinshan, Chankan bool
	Winds            Winds
	DoraIndicators   []tile.Tile
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

// kuisagari lowers the han of a kuisagari yaku in an open hand.
func kuisagari(y Yaku, open bool) Yaku {
	if open && y.open == openKuisagari {
		y.Han--
	}
	return y
}

// Han values of a closed hand, and how each yaku scores in an open hand.
var (
	yRiichi       = Yaku{"riichi", "立直", 1, openNever}
	yDoubleRiichi = Yaku{"double_riichi", "ダブル立直", 2, openNever}
	yIppatsu      = Yaku{"ippatsu", "一発", 1, openNever}
	yHaitei       = Yaku{"haitei", "海底摸月", 1, openSame}
	yHoutei       = Yaku{"houtei", "河底撈魚", 1, openSame}
	yRinshan      = Yaku{"rinshan", "嶺上開花", 1, openSame}
	yChankan      = Yaku{"chankan", "槍槓", 1, openSame}
	ySankantsu    = Yaku{"sankantsu", "三槓子", 2, openSame}
	yTsumo        = Yaku{"tsumo", "門前清自摸和", 1, openNever}
	yTanyao       = Yaku{"tanyao", "断么九", 1, openSame}
	yPinfu        = Yaku{"pinfu", "平和", 1, openNever}
	yIipeikou     = Yaku{"iipeikou", "一盃口", 1, openNever}
	yRyanpeikou   = Yaku{"ryanpeikou", "二盃口", 3, openNever}
	ySanshoku     = Yaku{"sanshoku", "三色同順", 2, openKuisagari}
	yDoukou       = Yaku{"sanshoku_doukou", "三色同刻", 2, openSame}
	yIttsu        = Yaku{"ittsu", "一気通貫", 2, openKuisagari}
	yChanta       = Yaku{"chanta", "混全帯么九", 2, openKuisagari}
	yJunchan      = Yaku{"junchan", "純全帯么九", 3, openKuisagari}
	yHonroutou    = Yaku{"honroutou", "混老頭", 2, openSame}
	yHonitsu      = Yaku{"honitsu", "混一色", 3, openKuisagari}
	yChinitsu     = Yaku{"chinitsu", "清一色", 6, openKuisagari}
	yToitoi       = Yaku{"toitoi", "対々和", 2, openSame}
	ySanankou     = Yaku{"sanankou", "三暗刻", 2, openSame}
	yShousangen   = Yaku{"shousangen", "小三元", 2, openSame}
	yHaku         = Yaku{"haku", "役牌 白", 1, openSame}
	yHatsu        = Yaku{"hatsu", "役牌 發", 1, openSame}
	yChun         = Yaku{"chun", "役牌 中", 1, openSame}
	yChiitoitsu   = Yaku{"chiitoitsu", "七対子", 2, openNever}
)

// Yakuman: 13 han each (26 for a double yakuman); several yakuman add up, and
// a hand with any yakuman scores only its yakuman (no dora, no other yaku).
var (
	yKokushi     = Yaku{"kokushi", "国士無双", 13, openNever}
	ySuuankou    = Yaku{"suuankou", "四暗刻", 13, openNever}
	yDaisangen   = Yaku{"daisangen", "大三元", 13, openSame}
	yTsuuiisou   = Yaku{"tsuuiisou", "字一色", 13, openSame}
	yShousuushii = Yaku{"shousuushii", "小四喜", 13, openSame}
	yDaisuushii  = Yaku{"daisuushii", "大四喜", 13, openSame}
	yRyuuiisou   = Yaku{"ryuuiisou", "緑一色", 13, openSame}
	yChinroutou  = Yaku{"chinroutou", "清老頭", 13, openSame}
	yChuuren     = Yaku{"chuuren", "九蓮宝燈", 13, openNever}
	ySuukantsu   = Yaku{"suukantsu", "四槓子", 13, openSame}
)

// Double yakuman: 26 han. They keep the key of the yakuman, whose single form
// is what byKey (and so the per-yaku analysis rows) report; 大四喜 always
// scores as a double yakuman.
var (
	yDaisuushii2   = Yaku{"daisuushii", "大四喜", 26, openSame}
	yKokushi13     = Yaku{"kokushi", "国士無双十三面待ち", 26, openNever}
	ySuuankouTanki = Yaku{"suuankou", "四暗刻単騎", 26, openNever}
	yJunseiChuuren = Yaku{"chuuren", "純正九蓮宝燈", 26, openNever}
)

// byKey maps each yaku key to its definition (closed-hand han). Value winds
// are handled by HanFor.
var byKey = func() map[string]Yaku {
	m := map[string]Yaku{}
	for _, y := range []Yaku{
		yRiichi, yDoubleRiichi, yIppatsu, yHaitei, yHoutei, yRinshan, yChankan, ySankantsu, ySuukantsu,
		yTsumo, yTanyao, yPinfu, yIipeikou, yRyanpeikou, ySanshoku, yDoukou, yIttsu,
		yChanta, yJunchan, yHonroutou, yHonitsu, yChinitsu, yToitoi, ySanankou,
		yShousangen, yHaku, yHatsu, yChun, yChiitoitsu,
		yKokushi, ySuuankou, yDaisangen, yTsuuiisou, yShousuushii, yDaisuushii,
		yRyuuiisou, yChinroutou, yChuuren,
	} {
		m[y.Key] = y
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
	return byKey[key].Han
}

// HanOpenFor is HanFor for a hand that is open (has called a meld) or not:
// an open hand scores the kuisagari yaku one han lower and the yaku that
// need a closed hand 0.
func HanOpenFor(key string, w Winds, open bool) int {
	if y, ok := byKey[key]; ok && open {
		if y.open == openNever {
			return 0
		}
		return kuisagari(y, open).Han
	}
	return HanFor(key, w)
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
		y := yKokushi
		if c[ctx.WinTile] == 2 { // the 13 tiles held one of each kind: a 13-sided wait
			y = yKokushi13
		}
		win.Yaku = []Yaku{y}
		win.HanTotal = y.Han
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
		consider(ys, yakumanWide(c, false, true, ctx.WinTile), chiitoitsuFu, nil)
	}
	for _, r := range ReadingsWith(c, ctx.Melds, ctx.WinTile) {
		ys := evalReading(all, r, ctx)
		consider(ys, append(yakumanWide(all, true, len(ctx.Melds) == 0, ctx.WinTile), yakumanReading(r, ctx)...), Fu(r, ctx), &r)
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
		if ctx.Rinshan {
			ys = append(ys, yRinshan)
		}
	} else {
		if ctx.Houtei {
			ys = append(ys, yHoutei)
		}
		if ctx.Chankan {
			ys = append(ys, yChankan)
		}
	}
	return ys
}

// yakumanWide returns the yakuman that depend only on the tile set; standard
// reports a 4 melds + pair reading (false: seven pairs), noMelds a hand
// without called melds or kan (needed for chuuren), and win the winning tile
// (純正九蓮宝燈: the 13 tiles before it are exactly 1112345678999).
func yakumanWide(c tile.Counts, standard, noMelds bool, win tile.Kind) []Yaku {
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
			chuuren, junsei := true, true
			for n, need := range [9]int{3, 1, 1, 1, 1, 1, 1, 1, 3} {
				k := tile.MakeKind(s, n+1)
				chuuren = chuuren && c[k] >= need
				if k == win {
					need++
				}
				junsei = junsei && c[k] == need
			}
			switch {
			case junsei:
				ys = append(ys, yJunseiChuuren)
			case chuuren:
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
	switch {
	case concealedTrips(r, ctx) == 4 && r.Wait == Tanki:
		ys = append(ys, ySuuankouTanki)
	case concealedTrips(r, ctx) == 4:
		ys = append(ys, ySuuankou)
	}
	if kans(r) == 4 {
		ys = append(ys, ySuukantsu)
	}
	if dragons == 3 {
		ys = append(ys, yDaisangen)
	}
	switch {
	case winds == 4:
		ys = append(ys, yDaisuushii2)
	case winds == 3 && r.Pair >= tile.East && r.Pair <= tile.North:
		ys = append(ys, yShousuushii)
	}
	return ys
}

// kans counts the kans of a reading.
func kans(r Reading) int {
	n := 0
	for _, m := range r.Melds {
		if m.Kan {
			n++
		}
	}
	return n
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
	if kans(r) == 3 {
		ys = append(ys, ySankantsu)
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
				ys = append(ys, Yaku{Key: WindKeys[i], Name: "役牌 " + WindNames[i], Han: han})
			}
		}
	}
	return ys
}

// displayOrder is the canonical display order of yaku keys.
var displayOrder = map[string]int{}

func init() {
	for i, k := range []string{
		"riichi", "double_riichi", "ippatsu", "tsumo", "haitei", "houtei", "rinshan", "chankan", "tanyao", "pinfu", "iipeikou", "ryanpeikou", "sanshoku", "sanshoku_doukou",
		"ittsu", "chanta", "junchan", "honroutou", "honitsu", "chinitsu", "toitoi", "sanankou", "sankantsu",
		"shousangen", "haku", "hatsu", "chun", "ton", "nan", "shaa", "pei", "chiitoitsu",
		"kokushi", "suuankou", "daisangen", "tsuuiisou", "shousuushii", "daisuushii",
		"ryuuiisou", "chinroutou", "chuuren", "suukantsu",
	} {
		displayOrder[k] = i
	}
}

// order sorts yaku into the canonical display order.
func order(ys []Yaku) []Yaku {
	sortx.Func(ys, func(a, b Yaku) int { return displayOrder[a.Key] - displayOrder[b.Key] })
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
