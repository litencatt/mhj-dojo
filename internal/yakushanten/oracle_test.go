package yakushanten

import (
	"math/rand/v2"
	"slices"
	"strings"
	"testing"

	"github.com/litencatt/mhj2/internal/shanten"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
	"github.com/litencatt/mhj2/internal/yaku"
)

// satisfies is an independent, decomposition-based definition of "W satisfies
// Y" for a 14-tile hand, used as the brute-force oracle. Pinfu here is the
// relaxed shape (the wait is checked separately).
func satisfies(key string, c tile.Counts) bool {
	// tile-set predicates
	suits := map[int]bool{}
	honors, yaochuTile, allYaochu, allHonors, allTerminal, allGreen := false, false, true, true, true, true
	for k, n := range c {
		if n == 0 {
			continue
		}
		kk := tile.Kind(k)
		if kk.IsHonor() {
			honors = true
		} else {
			suits[kk.Suit()] = true
		}
		yaochuTile = yaochuTile || kk.IsYaochu()
		allYaochu = allYaochu && kk.IsYaochu()
		allHonors = allHonors && kk.IsHonor()
		allTerminal = allTerminal && kk.IsTerminal()
		allGreen = allGreen && strings.Contains("2s 3s 4s 6s 8s 6z", kk.String())
	}
	switch key {
	case "chiitoitsu":
		return yaku.IsChiitoitsu(c)
	case "kokushi":
		return yaku.IsKokushi(c)
	case "honroutou":
		return allYaochu && (yaku.IsChiitoitsu(c) || quickComplete(c))
	case "tsuuiisou":
		return allHonors && (yaku.IsChiitoitsu(c) || quickComplete(c))
	case "chuuren":
		// one number suit holding 1112345678999 plus one more tile
		if len(suits) != 1 || honors || c.Total() != 14 {
			return false
		}
		for s := range suits {
			for n, need := range [9]int{3, 1, 1, 1, 1, 1, 1, 1, 3} {
				if c[tile.MakeKind(s, n+1)] < need {
					return false
				}
			}
		}
		return true
	}
	if !quickComplete(c) {
		return false
	}
	switch key {
	case "normal":
		return true
	case "tanyao":
		return !yaochuTile
	case "honitsu":
		return len(suits) <= 1
	case "chinitsu":
		return len(suits) <= 1 && !honors
	case "ryuuiisou":
		return allGreen
	case "chinroutou":
		return allTerminal
	}
	for _, d := range yaku.Decompose(c) {
		if readingSatisfies(key, d) {
			return true
		}
	}
	return false
}

func readingSatisfies(key string, d yaku.Decomposition) bool {
	seqs, trips := 0, 0
	var seqCount [tile.NumKinds]int
	has := func(k tile.Kind, typ yaku.GroupType) bool {
		for _, m := range d.Melds {
			if m.Type == typ && m.Kind == k {
				return true
			}
		}
		return false
	}
	for _, m := range d.Melds {
		if m.Type == yaku.Seq {
			seqs++
			seqCount[m.Kind]++
		} else {
			trips++
		}
	}
	groupHas := func(pred func(tile.Kind) bool) bool {
		if !pred(d.Pair) {
			return false
		}
		for _, m := range d.Melds {
			ok := pred(m.Kind)
			if m.Type == yaku.Seq {
				ok = ok || pred(m.Kind+2)
			}
			if !ok {
				return false
			}
		}
		return true
	}
	switch key {
	case "pinfu":
		return seqs == 4 && d.Pair != tile.East && d.Pair < tile.Haku
	case "iipeikou":
		return slices.ContainsFunc(seqCount[:], func(n int) bool { return n >= 2 })
	case "sanshoku":
		for n := 1; n <= 7; n++ {
			if has(tile.MakeKind(0, n), yaku.Seq) && has(tile.MakeKind(1, n), yaku.Seq) && has(tile.MakeKind(2, n), yaku.Seq) {
				return true
			}
		}
		return false
	case "ittsu":
		for s := 0; s < 3; s++ {
			if has(tile.MakeKind(s, 1), yaku.Seq) && has(tile.MakeKind(s, 4), yaku.Seq) && has(tile.MakeKind(s, 7), yaku.Seq) {
				return true
			}
		}
		return false
	case "chanta":
		return groupHas(tile.Kind.IsYaochu)
	case "junchan":
		return groupHas(tile.Kind.IsTerminal)
	case "ryanpeikou":
		return seqs == 4 && !slices.ContainsFunc(seqCount[:], func(n int) bool { return n%2 == 1 })
	case "sanshoku_doukou":
		for n := 1; n <= 9; n++ {
			if has(tile.MakeKind(0, n), yaku.Trip) && has(tile.MakeKind(1, n), yaku.Trip) && has(tile.MakeKind(2, n), yaku.Trip) {
				return true
			}
		}
		return false
	case "toitoi", "suuankou":
		return trips == 4
	case "sanankou":
		return trips >= 3
	case "shousangen":
		return countTrips(has, tile.Haku, tile.Chun) == 2 && d.Pair >= tile.Haku
	case "daisangen":
		return countTrips(has, tile.Haku, tile.Chun) == 3
	case "shousuushii":
		return countTrips(has, tile.East, tile.North) == 3 && d.Pair >= tile.East && d.Pair <= tile.North
	case "daisuushii":
		return countTrips(has, tile.East, tile.North) == 4
	case "haku":
		return has(tile.Haku, yaku.Trip)
	case "hatsu":
		return has(tile.Hatsu, yaku.Trip)
	case "chun":
		return has(tile.Chun, yaku.Trip)
	case "ton":
		return has(tile.East, yaku.Trip)
	}
	panic("unknown key " + key)
}

// countTrips counts the kinds in [lo, hi] held as a triplet.
func countTrips(has func(tile.Kind, yaku.GroupType) bool, lo, hi tile.Kind) int {
	n := 0
	for k := lo; k <= hi; k++ {
		if has(k, yaku.Trip) {
			n++
		}
	}
	return n
}

// quickComplete is a fast standard-shape test used before decomposing.
func quickComplete(c tile.Counts) bool {
	for h := range c {
		if c[h] >= 2 {
			c[h] -= 2
			ok := meldsOnly(&c, 0)
			c[h] += 2
			if ok {
				return true
			}
		}
	}
	return false
}

func meldsOnly(c *tile.Counts, i int) bool {
	for i < tile.NumKinds && c[i] == 0 {
		i++
	}
	if i == tile.NumKinds {
		return true
	}
	if c[i] >= 3 {
		c[i] -= 3
		ok := meldsOnly(c, i)
		c[i] += 3
		if ok {
			return true
		}
	}
	k := tile.Kind(i)
	if !k.IsHonor() && k.Num() <= 7 && c[i+1] > 0 && c[i+2] > 0 {
		c[i]--
		c[i+1]--
		c[i+2]--
		ok := meldsOnly(c, i)
		c[i]++
		c[i+1]++
		c[i+2]++
		return ok
	}
	return false
}

// bruteTenpaiWaits returns the kinds t (held < 4) with H+t satisfying key.
func bruteTenpaiWaits(key string, c tile.Counts) []tile.Kind {
	var out []tile.Kind
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if c[k] >= 4 {
			continue
		}
		c[k]++
		if satisfies(key, c) {
			out = append(out, k)
		}
		c[k]--
	}
	return out
}

// bruteDist returns the exact distance if it is 1 or 2, else 3.
func bruteDist(key string, c tile.Counts) int {
	if len(bruteTenpaiWaits(key, c)) > 0 {
		return 1
	}
	for x := range c {
		if c[x] == 0 {
			continue
		}
		c[x]--
		for a := range c {
			if c[a] >= 4 {
				continue
			}
			c[a]++
			for b := a; b < tile.NumKinds; b++ {
				if c[b] >= 4 {
					continue
				}
				c[b]++
				ok := satisfies(key, c)
				c[b]--
				if ok {
					return 2
				}
			}
			c[a]--
		}
		c[x]++
	}
	return 3
}

// bruteUkeire returns the kinds lowering a distance of 1 or 2.
func bruteUkeire(key string, c tile.Counts, dist int) []tile.Kind {
	if dist == 1 {
		return bruteTenpaiWaits(key, c)
	}
	var out []tile.Kind
	for t := tile.Kind(0); t < tile.NumKinds; t++ {
		if c[t] >= 4 {
			continue
		}
		c[t]++
		found := false
		for x := range c {
			if c[x] == 0 || found {
				continue
			}
			c[x]--
			found = len(bruteTenpaiWaits(key, c)) > 0
			c[x]++
		}
		if found {
			out = append(out, t)
		}
		c[t]--
	}
	return out
}

// randomTarget returns a random complete hand satisfying key.
func randomTarget(r *rand.Rand, key string) tile.Counts {
	for {
		var c tile.Counts
		melds := 4
		switch key {
		case "iipeikou":
			s, n := r.IntN(3), r.IntN(7)
			addSeq(&c, s, n, 2)
			melds = 2
		case "sanshoku":
			n := r.IntN(7)
			for s := 0; s < 3; s++ {
				addSeq(&c, s, n, 1)
			}
			melds = 1
		case "ittsu":
			s := r.IntN(3)
			for _, n := range []int{0, 3, 6} {
				addSeq(&c, s, n, 1)
			}
			melds = 1
		case "haku", "hatsu", "chun", "ton":
			k := map[string]tile.Kind{"haku": tile.Haku, "hatsu": tile.Hatsu, "chun": tile.Chun, "ton": tile.East}[key]
			c[k] += 3
			melds = 3
		case "chiitoitsu":
			for _, k := range r.Perm(tile.NumKinds)[:7] {
				c[k] += 2
			}
			return c
		case "ryanpeikou":
			for range 2 {
				addSeq(&c, r.IntN(3), r.IntN(7), 2)
			}
			melds = 0
		case "sanshoku_doukou":
			n := r.IntN(9)
			for s := 0; s < 3; s++ {
				c[tile.MakeKind(s, n+1)] += 3
			}
			melds = 1
		case "honroutou", "tsuuiisou", "chinroutou", "suuankou":
			// random groups (triplets + pair, or seven pairs) from the allowed kinds
			var kinds []tile.Kind
			for k := tile.Kind(0); k < tile.NumKinds; k++ {
				if key == "suuankou" || (key == "tsuuiisou" && k.IsHonor()) ||
					(key == "honroutou" && k.IsYaochu()) || (key == "chinroutou" && k.IsTerminal()) {
					kinds = append(kinds, k)
				}
			}
			if (key == "honroutou" || key == "tsuuiisou") && r.IntN(3) == 0 {
				for _, i := range r.Perm(len(kinds))[:7] {
					c[kinds[i]] += 2
				}
				return c
			}
			for m := 0; m < 4; m++ {
				c[kinds[r.IntN(len(kinds))]] += 3
			}
			c[kinds[r.IntN(len(kinds))]] += 2
			if valid(c) && satisfies(key, c) {
				return c
			}
			continue
		case "shousangen", "daisangen", "shousuushii", "daisuushii":
			first, n, trips := tile.Haku, 3, 2
			switch key {
			case "daisangen":
				trips = 3
			case "shousuushii":
				first, n, trips = tile.East, 4, 3
			case "daisuushii":
				first, n, trips = tile.East, 4, 4
			}
			perm := r.Perm(n)
			for _, i := range perm[:trips] {
				c[first+tile.Kind(i)] += 3
			}
			if trips < n && (key == "shousangen" || key == "shousuushii") {
				c[first+tile.Kind(perm[trips])] += 2
				for m := trips; m < 4; m++ {
					addRandomMeld(r, &c)
				}
				if valid(c) && satisfies(key, c) {
					return c
				}
				continue
			}
			melds = 4 - trips
		case "ryuuiisou":
			green := []tile.Kind{19, 20, 21, 23, 25, tile.Hatsu}
			for m := 0; m < 4; m++ {
				if r.IntN(3) == 0 {
					addSeq(&c, tile.Sou, 1, 1)
				} else {
					c[green[r.IntN(len(green))]] += 3
				}
			}
			c[green[r.IntN(len(green))]] += 2
			if valid(c) && satisfies(key, c) {
				return c
			}
			continue
		case "chuuren":
			s := r.IntN(3)
			for n, v := range [9]int{3, 1, 1, 1, 1, 1, 1, 1, 3} {
				c[tile.MakeKind(s, n+1)] = v
			}
			c[tile.MakeKind(s, 1+r.IntN(9))]++
			return c
		case "kokushi":
			for k := tile.Kind(0); k < tile.NumKinds; k++ {
				if k.IsYaochu() {
					c[k]++
				}
			}
			yc := []tile.Kind{0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33}
			c[yc[r.IntN(len(yc))]]++
			return c
		}
		suit := r.IntN(3)
		for m := 0; m < melds; m++ {
			if r.IntN(2) == 0 {
				s := r.IntN(3)
				if key == "honitsu" || key == "chinitsu" {
					s = suit
				}
				addSeq(&c, s, r.IntN(7), 1)
			} else {
				k := tile.Kind(r.IntN(tile.NumKinds))
				if key == "honitsu" || key == "chinitsu" {
					k = tile.MakeKind(suit, 1+r.IntN(9))
				}
				c[k] += 3
			}
		}
		c[r.IntN(tile.NumKinds)] += 2
		if valid(c) && satisfies(key, c) {
			return c
		}
	}
}

func addRandomMeld(r *rand.Rand, c *tile.Counts) {
	if r.IntN(2) == 0 {
		addSeq(c, r.IntN(3), r.IntN(7), 1)
	} else {
		c[r.IntN(tile.NumKinds)] += 3
	}
}

func addSeq(c *tile.Counts, s, n, times int) {
	for j := 0; j < 3; j++ {
		c[s*9+n+j] += times
	}
}

func valid(c tile.Counts) bool {
	for _, n := range c {
		if n > 4 {
			return false
		}
	}
	return true
}

func perturb(r *rand.Rand, c tile.Counts) tile.Counts {
	for {
		d := c
		remove(r, &d)
		if r.IntN(2) == 0 {
			remove(r, &d)
			add(r, &d)
		}
		if valid(d) {
			return d
		}
	}
}

func remove(r *rand.Rand, c *tile.Counts) {
	for {
		if k := r.IntN(tile.NumKinds); c[k] > 0 {
			c[k]--
			return
		}
	}
}

func add(r *rand.Rand, c *tile.Counts) {
	for {
		if k := r.IntN(tile.NumKinds); c[k] < 4 {
			c[k]++
			return
		}
	}
}

func randomHand(r *rand.Rand) tile.Counts {
	set := wall.FullSet()
	r.Shuffle(len(set), func(i, j int) { set[i], set[j] = set[j], set[i] })
	return tile.CountsOf(set[:13])
}

// TestRowsMatchBruteForce compares every row (except pinfu's exact wait,
// covered below) with the brute-force definition on near-target hands.
func TestRowsMatchBruteForce(t *testing.T) {
	r := rand.New(rand.NewPCG(11, 12))
	a := NewAnalyzer()
	perKey := 24
	if testing.Short() {
		perKey = 6
	}
	for _, row := range Rows {
		for i := 0; i < perKey; i++ {
			var c tile.Counts
			switch i % 4 {
			case 3:
				c = randomHand(r)
			default:
				c = perturb(r, randomTarget(r, row.Key))
			}
			res := a.Row(c, row.Key)
			if row.Key == "pinfu" {
				// compare the relaxed shape value
				res = a.target(c, targets["pinfu"])
			}
			if !res.Possible {
				t.Fatalf("%s %s: impossible", row.Key, c)
			}
			want := bruteDist(row.Key, c)
			got := min(res.Shanten+1, 3)
			if got != want {
				t.Fatalf("%s %s: shanten %d, brute dist %d", row.Key, c, res.Shanten, want)
			}
			if want <= 2 {
				wantU := bruteUkeire(row.Key, c, want)
				if !slices.Equal(res.Ukeire, wantU) {
					t.Fatalf("%s %s: ukeire %v, brute %v", row.Key, c, names(res.Ukeire), names(wantU))
				}
			}
		}
	}
}

// TestPinfuExactWaits checks the exact tenpai rule against the brute
// definition "H+t has a pinfu reading with t on a two-sided wait".
func TestPinfuExactWaits(t *testing.T) {
	r := rand.New(rand.NewPCG(13, 14))
	a := NewAnalyzer()
	n := 300
	if testing.Short() {
		n = 50
	}
	for i := 0; i < n; i++ {
		c := perturb(r, randomTarget(r, "pinfu"))
		res := a.Row(c, "pinfu")
		relaxed := a.target(c, targets["pinfu"])
		var waits []tile.Kind
		for k := tile.Kind(0); k < tile.NumKinds; k++ {
			if c[k] >= 4 {
				continue
			}
			c[k]++
			for _, d := range yaku.Decompose(c) {
				if readingSatisfies("pinfu", d) && slices.ContainsFunc(d.Melds[:], func(m yaku.Meld) bool {
					// two-sided: k is the low end of a non-789 sequence or the high end of a non-123 one
					return m.Type == yaku.Seq && ((k == m.Kind && m.Kind.Num() <= 6) || (k == m.Kind+2 && m.Kind.Num() >= 2))
				}) {
					waits = append(waits, k)
					break
				}
			}
			c[k]--
		}
		switch {
		case len(waits) > 0:
			if res.Shanten != 0 || res.Approx || !slices.Equal(res.Ukeire, waits) {
				t.Fatalf("%s: got %d approx=%v %v, want tenpai %v", c, res.Shanten, res.Approx, names(res.Ukeire), names(waits))
			}
		case relaxed.Shanten == 0:
			if res.Shanten != 1 || !res.Approx {
				t.Fatalf("%s: relaxed tenpai without ryanmen should be 1 (approx), got %d", c, res.Shanten)
			}
		default:
			if res.Shanten != relaxed.Shanten || !res.Approx || res.Shanten < 1 {
				t.Fatalf("%s: got %d approx=%v, relaxed %d", c, res.Shanten, res.Approx, relaxed.Shanten)
			}
		}
	}
}

func TestPropertiesRandom(t *testing.T) {
	r := rand.New(rand.NewPCG(21, 22))
	a := NewAnalyzer()
	n := 3000
	if testing.Short() {
		n = 300
	}
	for i := 0; i < n; i++ {
		c := randomHand(r)
		rows := a.Analyze(c)
		get := func(key string) Result {
			for _, row := range rows {
				if row.Key == key {
					return row
				}
			}
			t.Fatalf("missing row %s", key)
			return Result{}
		}
		normal := get("normal")
		if normal.Shanten != shanten.ClassicNormal(c) {
			t.Fatalf("%s: unconstrained %d != classic %d", c, normal.Shanten, shanten.ClassicNormal(c))
		}
		for _, row := range rows {
			if !row.Possible {
				t.Fatalf("%s: %s impossible", c, row.Key)
			}
			if row.Yakuman != (row.Key == "kokushi" || rowIndex(row.Key) > rowIndex("kokushi")) {
				t.Fatalf("%s: yakuman flag %v", row.Key, row.Yakuman)
			}
			switch row.Key {
			case "chiitoitsu", "kokushi", "honroutou", "tsuuiisou":
				// not (only) 4 melds + pair
				continue
			}
			if row.Shanten < normal.Shanten {
				t.Fatalf("%s: %s shanten %d < normal %d", c, row.Key, row.Shanten, normal.Shanten)
			}
		}
		// Containment: every W of the first row also satisfies one of the others,
		// so the first row's shanten is never lower.
		for _, rel := range [][]string{
			{"chinitsu", "honitsu"},
			{"junchan", "chanta"},
			{"toitoi", "sanankou"},
			{"ryanpeikou", "iipeikou"},
			{"sanshoku_doukou", "sanankou"},
			{"honroutou", "toitoi", "chiitoitsu"},
			{"honroutou", "normal", "chiitoitsu"},
			{"tsuuiisou", "honroutou"},
			{"tsuuiisou", "honitsu", "chiitoitsu"},
			{"chinroutou", "honroutou"},
			{"chinroutou", "junchan"},
			{"chinroutou", "toitoi"},
			{"daisangen", "haku"}, {"daisangen", "hatsu"}, {"daisangen", "chun"},
			{"daisuushii", "ton"},
			{"daisuushii", "toitoi"},
			{"ryuuiisou", "honitsu"},
			{"chuuren", "chinitsu"},
		} {
			lower := get(rel[1]).Shanten
			for _, k := range rel[2:] {
				lower = min(lower, get(k).Shanten)
			}
			if get(rel[0]).Shanten < lower {
				t.Fatalf("%s: %s %d < %v %d", c, rel[0], get(rel[0]).Shanten, rel[1:], lower)
			}
		}
		if a.eng.MemoSize() > 1<<20 {
			a = NewAnalyzer()
		}
	}
}

func rowIndex(key string) int {
	return slices.IndexFunc(Rows, func(r RowDef) bool { return r.Key == key })
}

func names(ks []tile.Kind) []string {
	out := make([]string, len(ks))
	for i, k := range ks {
		out[i] = k.String()
	}
	return out
}
