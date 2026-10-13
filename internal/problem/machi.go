package problem

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/session"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// machiLevels is the number of machi levels (docs/problems.md):
// 1 a simple wait of one or two kinds, 2 three or more waits or a wait no
// single block explains, 3 a one-suit hand (清一色) with three or more waits.
const machiLevels = 3

// maxWaits bounds the waits of a problem, and so the tiles of an answer.
// Only kokushi's thirteen-sided wait goes past it.
const maxWaits = 9

// machi makes the 13-tile tenpai hand of a level from src, or nil if src
// gives none. The caller holds mu.
func machi(level int, src int64) *Problem {
	var hand []tile.Tile
	if level == 3 {
		hand = chinitsuHand(level, src)
	} else {
		hand = walkToTenpai(level, src)
	}
	if hand == nil {
		return nil
	}
	c := tile.CountsOf(hand)
	return &Problem{
		Choose: "many",
		Position: Position{
			Hand: tile.Strings(hand), DoraIndicators: []string{},
			RoundWind: winds.Round.String(), SeatWind: winds.Seat.String(),
			Discards: []string{}, Remaining: apiview.Remaining(&c),
		},
		answer: answer{hand: c, waits: waits(c)},
	}
}

// walkToTenpai plays the practice wall of src, discarding each turn the
// tile that leaves the lowest normal-form shanten with the most unseen
// ukeire (the advice's first two keys; its full ranking makes level 2 ten
// times slower), and returns the first 13-tile hand left after a discard
// that fits the level; nil if none does by the game's last turn.
func walkToTenpai(level int, src int64) []tile.Tile {
	w := wall.New(src)
	hand := w.Hand()
	var visible tile.Counts
	for _, t := range hand {
		visible[t.Kind]++
	}
	for turn := range session.DefaultMaxTurns {
		d, ok := w.Draw(turn)
		if !ok {
			return nil
		}
		visible[d.Kind]++
		tiles := append(hand, d)
		i := discard(tiles, &visible)
		hand = slices.Delete(tiles, i, i+1)
		tile.Sort(hand)
		if c := tile.CountsOf(hand); fits(level, c, waits(c)) {
			return hand
		}
	}
	return nil
}

// discard returns the index in tiles of the tile to discard: the kind
// leaving the lowest normal shanten, then the most unseen copies of its
// ukeire, then honors and terminals first, then kind order; a plain copy
// before a red five.
func discard(tiles []tile.Tile, visible *tile.Counts) int {
	c := tile.CountsOf(tiles)
	best, bestSh, bestUk, bestYaochu := -1, 0, 0, false
	for i, t := range tiles {
		if best >= 0 && tiles[best].Kind == t.Kind {
			if tiles[best].Red && !t.Red {
				best = i
			}
			continue
		}
		c[t.Kind]--
		r := analyzer.NormalShanten(c)
		c[t.Kind]++
		uk := 0
		for _, k := range r.Ukeire {
			uk += 4 - visible[k]
		}
		y := t.Kind.IsYaochu()
		if best < 0 || r.Shanten < bestSh || (r.Shanten == bestSh && (uk > bestUk || (uk == bestUk && y && !bestYaochu))) {
			best, bestSh, bestUk, bestYaochu = i, r.Shanten, uk, y
		}
	}
	return best
}

// chinitsuHand deals 13 tiles of one suit picked by src, and returns them
// if they fit the level (nil if not).
func chinitsuHand(level int, src int64) []tile.Tile {
	r := rand.New(rand.NewPCG(uint64(src), 0x6d616368+uint64(level))) // arbitrary PCG stream constant
	suit := r.IntN(3)
	pool := make([]tile.Tile, 0, 36)
	for n := 1; n <= 9; n++ {
		for range 4 {
			pool = append(pool, tile.Tile{Kind: tile.MakeKind(suit, n)})
		}
	}
	r.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
	hand := pool[:wall.HandSize]
	tile.Sort(hand)
	if c := tile.CountsOf(hand); fits(level, c, waits(c)) {
		return hand
	}
	return nil
}

// fits reports whether a hand with these waits fits the level.
func fits(level int, c tile.Counts, ws []tile.Kind) bool {
	if len(ws) == 0 || len(ws) > maxWaits {
		return false
	}
	switch level {
	case 1:
		return !oneSuit(c) && simple(c, ws)
	case 2:
		return !oneSuit(c) && (len(ws) >= 3 || !simple(c, ws))
	default:
		return oneSuit(c) && len(ws) >= 3
	}
}

// oneSuit reports whether every tile is of one number suit (清一色).
func oneSuit(c tile.Counts) bool {
	suit := -1
	for k, n := range c {
		if n == 0 {
			continue
		}
		s := tile.Kind(k).Suit()
		if s == tile.Honor || (suit >= 0 && s != suit) {
			return false
		}
		suit = s
	}
	return suit >= 0
}

// waits returns, in kind order, every kind that completes the 13 tiles c
// into a winning shape (4 melds + pair, chiitoitsu or kokushi). A kind of
// which c holds all four copies cannot be drawn, so it is never a wait.
func waits(c tile.Counts) []tile.Kind {
	var out []tile.Kind
	for k := range tile.Kind(tile.NumKinds) {
		if c[k] >= 4 {
			continue
		}
		c[k]++
		if yaku.IsComplete(c) {
			out = append(out, k)
		}
		c[k]--
	}
	return out
}

// simple reports whether one block of the hand explains every wait: a
// single tile (単騎), a closed or edge wait (嵌張・辺張), an open wait (両面)
// or two pairs (双碰) with the rest complete. 延べ単, a 両面 with a 単騎 and
// the like are not simple.
func simple(c tile.Counts, ws []tile.Kind) bool {
	for _, w := range ws {
		c[w]++
		rs := yaku.Readings(c, w)
		c[w]--
		if len(rs) == 0 && len(ws) == 1 {
			return true // chiitoitsu's or kokushi's single wait
		}
		for _, r := range rs {
			if slices.Equal(blockWaits(r, w), ws) {
				return true
			}
		}
	}
	return false
}

// blockWaits is the waits of the block the winning tile w completed in r,
// in kind order.
func blockWaits(r yaku.Reading, w tile.Kind) []tile.Kind {
	switch r.Wait {
	case yaku.Shanpon:
		return []tile.Kind{min(w, r.Pair), max(w, r.Pair)}
	case yaku.Ryanmen:
		k := r.Melds[r.WinGroup].Kind
		if w == k {
			return []tile.Kind{k, k + 3}
		}
		return []tile.Kind{k - 1, k + 2}
	}
	return []tile.Kind{w}
}

// gradeMachi grades a set of kinds: correct when it is exactly the waits.
func (p *Problem) gradeMachi(ans []tile.Tile) (*Result, error) {
	if len(ans) == 0 || len(ans) > maxWaits {
		return nil, fmt.Errorf("%w: answer must be 1 to %d tiles", ErrInvalid, maxWaits)
	}
	ws := p.answer.waits
	c := p.answer.hand
	res := &Result{ID: p.ID, Best: []string{}, Missed: []string{}, Ranking: []Eval{}}
	seen := map[tile.Kind]bool{}
	var wrong []string
	for _, t := range ans {
		if t.Kind >= tile.NumKinds {
			return nil, fmt.Errorf("%w: invalid tile", ErrInvalid)
		}
		if seen[t.Kind] {
			return nil, fmt.Errorf("%w: kind %s answered twice", ErrInvalid, t.Kind)
		}
		seen[t.Kind] = true
		e := machiEval(c, ws, t.Kind)
		e.Tile = t.String()
		res.Answer = append(res.Answer, e)
		if e.Rank != 1 {
			wrong = append(wrong, tileName(t.Kind))
		}
	}
	var missed []string
	for _, w := range ws {
		res.Best = append(res.Best, w.String())
		res.Ranking = append(res.Ranking, machiEval(c, ws, w))
		if !seen[w] {
			res.Missed = append(res.Missed, w.String())
			missed = append(missed, tileName(w))
		}
	}
	res.Correct = len(missed) == 0 && len(wrong) == 0

	var b strings.Builder
	if res.Correct {
		b.WriteString("正解。")
	} else {
		if len(missed) > 0 {
			b.WriteString("見逃した待ち: " + strings.Join(missed, "・") + "。")
		}
		if len(wrong) > 0 {
			b.WriteString("待ちではない牌: " + strings.Join(wrong, "・") + "。")
		}
	}
	names := make([]string, len(ws))
	for i, w := range ws {
		names[i] = tileName(w)
	}
	fmt.Fprintf(&b, "待ちは %s の%d種。", strings.Join(names, "・"), len(ws))
	for _, w := range ws {
		b.WriteString(readingText(c, w) + "。")
	}
	res.Text = b.String()
	return res, nil
}

// machiEval is the evaluation of answering kind k: rank 1 and shanten −1
// (complete) for a wait, rank 2 and shanten 0 for any other kind; ukeire is
// the wait's copies outside the hand.
func machiEval(c tile.Counts, ws []tile.Kind, k tile.Kind) Eval {
	if slices.Contains(ws, k) {
		return Eval{Tile: k.String(), Rank: 1, Shanten: -1, Ukeire: 4 - c[k]}
	}
	return Eval{Tile: k.String(), Rank: 2}
}

var waitNames = map[yaku.Wait]string{
	yaku.Ryanmen: "両面", yaku.Kanchan: "嵌張", yaku.Penchan: "辺張", yaku.Shanpon: "双碰", yaku.Tanki: "単騎",
}

// readingText writes how wait w completes c: "6萬で 123m 456m 789m 55p 666s（両面）",
// with the reading whose wait is the most open (両面 first, 単騎 last).
func readingText(c tile.Counts, w tile.Kind) string {
	c[w]++
	rs := yaku.Readings(c, w)
	head := tileName(w) + "で "
	if len(rs) == 0 {
		if yaku.IsKokushi(c) {
			return head + "国士無双"
		}
		var pairs []string
		for k, n := range c {
			if n == 2 {
				pairs = append(pairs, group(tile.Kind(k), 0, 2))
			}
		}
		return head + strings.Join(pairs, " ") + "（七対子の単騎）"
	}
	r := slices.MinFunc(rs, func(a, b yaku.Reading) int { return int(a.Wait) - int(b.Wait) })
	type g struct {
		k    tile.Kind
		text string
	}
	gs := []g{{r.Pair, group(r.Pair, 0, 2)}}
	for _, m := range r.Melds {
		if m.Type == yaku.Seq {
			gs = append(gs, g{m.Kind, group(m.Kind, 1, 3)})
		} else {
			gs = append(gs, g{m.Kind, group(m.Kind, 0, 3)})
		}
	}
	slices.SortStableFunc(gs, func(a, b g) int { return int(a.k) - int(b.k) })
	parts := make([]string, len(gs))
	for i, x := range gs {
		parts[i] = x.text
	}
	return head + strings.Join(parts, " ") + "（" + waitNames[r.Wait] + "）"
}

// group writes n tiles from k in steps of step, as "456m" or "55p".
func group(k tile.Kind, step, n int) string {
	var b strings.Builder
	for i := range n {
		b.WriteString(strconv.Itoa(k.Num() + i*step))
	}
	b.WriteByte(k.String()[1])
	return b.String()
}

var (
	honorNames = [...]string{"東", "南", "西", "北", "白", "發", "中"}
	suitNames  = [...]string{"萬", "筒", "索"}
)

// tileName writes a kind as the web UI does: 9萬, 北 (advice's name).
func tileName(k tile.Kind) string {
	if k.IsHonor() {
		return honorNames[k-tile.East]
	}
	return strconv.Itoa(k.Num()) + suitNames[k.Suit()]
}
