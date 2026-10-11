// Package cpu is the computer player: it always takes a win, declares
// riichi when tenpai with a wait not all in sight, calls when the hand keeps
// a yaku (see calls.go), discards for tile efficiency (lowest shanten, then
// most unseen accepting tiles) and folds against a riichi (folds) by the
// danger of each tile (Danger). It is deterministic. The weak player
// (NewWeak) plays worse on purpose; the master (NewMaster, master.go)
// better.
package cpu

import (
	"encoding/binary"
	"hash/fnv"
	"slices"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// foldShanten is the shanten from which the player folds against a riichi.
const foldShanten = 2

// memoGen is the number of suit tables in each generation of the player's
// shanten memo (at most twice as many, ~1 MiB): the three CPU seats build
// only a few thousand tables over a whole game, reusing few across rounds.
// The yaku routes of open hands (byYaku, calls) add tables of their own
// suit rules; the memo drops the oldest generation past the bound, which
// costs time, never correctness.
const memoGen = 4_000

// kyuushuKeep is the thirteen-orphans shanten up to which the player goes
// for kokushi instead of declaring 九種九牌 (ten kinds and a pair, or more).
const kyuushuKeep = 2

// kokushiShanten returns the thirteen-orphans shanten of the viewer's 14
// tiles, drawn tile included (a hand one discard from 13).
func kokushiShanten(v game.View) int {
	me := v.Seats[v.Viewer]
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil {
		tiles = append(tiles, *me.Drawn)
	}
	c := tile.CountsOf(tiles)
	kinds, pair := 0, false
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if k.IsYaochu() && c[k] > 0 {
			kinds++
			pair = pair || c[k] >= 2
		}
	}
	return 13 - kinds - b2i(pair)
}

// Player decides moves for CPU seats. It keeps a shanten memo, so use one
// Player per game (it is not safe for concurrent use).
type Player struct {
	eng    *shanten.Engine
	weak   bool
	master bool
}

// Levels of play.
const (
	Weak   = "weak"   // 弱い: NewWeak
	Normal = "normal" // 普通: New
	Master = "master" // 師範: NewMaster
	Ura    = "ura"    // 裏師範: NewUra
)

// UraDrawBias is the urashihan's draw bias (game.SeatConfig.DrawBias), in
// percent: its strength, set by the match with its peek. Changing it
// changes the games the urashihan plays, so their saves no longer replay
// (their check fails); TestUraSim measures it.
const UraDrawBias = 5

// weakStray is the share, in percent, of the weak player's discards picked
// among all those keeping the lowest shanten instead of the best one.
const weakStray = 50

// New returns a player with an empty memo.
func New() *Player { return &Player{eng: shanten.NewEngineGen(memoGen)} }

// NewWeak returns a weaker player: it still takes every win and declares
// riichi when tenpai, but never calls or declares a kan, never folds, and
// on about every other discard picks any discard that keeps the lowest
// shanten instead of the one with the most ukeire. That pick is a hash of
// what the seat sees, not a random draw, so a game replays exactly.
func NewWeak() *Player { return &Player{eng: shanten.NewEngineGen(memoGen), weak: true} }

// NewMaster returns a stronger player with an empty memo (see master.go).
func NewMaster() *Player { return &Player{eng: shanten.NewEngineGen(memoGen), master: true} }

// NewUra returns the urashihan (裏師範): the master, who plays with
// cheats. They come from its seats' rules (game.SeatConfig), which the
// match sets for cpu.Ura: a peek at the other seats' tiles, which the player
// uses (peek.go), and a bias of its draws toward useful tiles
// (UraDrawBias), which the engine applies.
func NewUra() *Player { return NewMaster() }

// Decide implements game.Decider.
func (p *Player) Decide(v game.View, l game.Legal) game.Action {
	switch {
	case l.Tsumo:
		return game.Action{Type: game.Tsumo}
	case l.Ron:
		return game.Action{Type: game.Ron}
	case l.Skip && p.weak:
		return game.Action{Type: game.Skip}
	case l.Skip:
		if a, ok := p.decideCall(v, l); ok {
			return a
		}
		return game.Action{Type: game.Skip}
	case l.Kyuushu && kokushiShanten(v) > kyuushuKeep:
		return game.Action{Type: game.Kyuushu}
	}
	if len(l.Kan) > 0 && !p.weak {
		if a, ok := p.decideSelfKan(v, l); ok {
			return a
		}
	}
	me := v.Seats[v.Viewer]
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil { // no drawn tile right after a call
		tiles = append(tiles, *me.Drawn)
	}
	visible := v.Visible()
	peek := !p.weak && peeked(v)
	if peek {
		seePeeked(v, &visible)
	}

	best := p.byEfficiency(tiles, len(me.Melds), l.Discards, &visible)
	if !p.weak && needsRoute(v, me.Melds) {
		p.byYaku(v, best, tiles, &visible)
	}
	if p.master {
		p.rankMaster(v, best, tiles, &visible)
	}
	pick := best[0]
	if !p.weak {
		threats, riichi := p.threats(v)
		if p.folds(v, best[0].shanten, best[0].ukeire, riichi) {
			choice := safest(best, threats, &visible)
			return game.Action{Type: game.Discard, Tile: choice}
		}
		if p.master && len(threats) > 0 {
			pick = guarded(best, threats, &visible)
		}
	}
	if p.weak {
		pick.tile = stray(v, best)
	} else if pick.shanten == 0 && pick.ukeire == 0 {
		// A wait whose tiles are all in sight cannot win: keep a hand one
		// step back with tiles left to draw instead, if there is one.
		if i := slices.IndexFunc(best, func(o option) bool { return o.shanten <= 1 && o.ukeire > 0 }); i >= 0 {
			pick = best[i]
		}
	}
	if peek {
		deadly := p.deadly(v)
		if i := slices.IndexFunc(best, func(o option) bool { return !deadly[o.kind] }); deadly[pick.kind] && i >= 0 {
			pick = best[i]
		}
	}
	choice := pick.tile
	// No riichi on a wait whose tiles are all in sight (the weak player
	// declares anyway).
	live := pick.ukeire > 0 || p.weak
	if pick.shanten == 0 && live && slices.Contains(l.Riichi, choice) {
		if p.master && len(me.Melds) == 0 {
			c := tile.CountsOf(tiles)
			c[pick.kind]--
			if _, waits := p.shanten(c, 0); dama(v, tiles, choice, waits) {
				return game.Action{Type: game.Discard, Tile: choice}
			}
		}
		return game.Action{Type: game.Riichi, Tile: choice}
	}
	return game.Action{Type: game.Discard, Tile: choice}
}

// stray returns the weak player's discard from the ranked opts: usually the
// best, else any that keeps the lowest shanten. The pick depends only on the
// round's wall seed, the seat and how far the round has got.
func stray(v game.View, opts []option) string {
	moves := 0
	for _, s := range v.Seats {
		moves += len(s.River) + len(s.Melds)
	}
	var b [32]byte
	binary.BigEndian.PutUint64(b[0:], uint64(v.Seed))
	binary.BigEndian.PutUint64(b[8:], uint64(v.Viewer))
	binary.BigEndian.PutUint64(b[16:], uint64(v.DrawsLeft))
	binary.BigEndian.PutUint64(b[24:], uint64(moves))
	h := fnv.New64a()
	h.Write(b[:])
	x := h.Sum64()
	if x%100 >= weakStray {
		return opts[0].tile
	}
	n := 1
	for n < len(opts) && opts[n].shanten == opts[0].shanten {
		n++
	}
	return opts[(x/100)%uint64(n)].tile
}

// option is a discard with the shanten and unseen accepting tiles it leaves.
// base is the shanten byEfficiency gave it (byYaku may change shanten), and
// weight the master's ranking of it (rankMaster).
type option struct {
	tile    string
	kind    tile.Kind
	red     bool
	shanten int
	ukeire  int
	base    int
	weight  int
}

// byEfficiency ranks the discards: lowest shanten, most ukeire, then honors
// before terminals before simples, then tile order, keeping red fives.
func (p *Player) byEfficiency(tiles []tile.Tile, melds int, discards []string, visible *tile.Counts) []option {
	var opts []option
	all := tile.CountsOf(tiles)
	for _, s := range discards {
		i := slices.IndexFunc(tiles, func(t tile.Tile) bool { return t.String() == s })
		o := option{tile: s, kind: tiles[i].Kind, red: tiles[i].Red}
		// A red five and a plain one leave the same hand.
		if j := slices.IndexFunc(opts, func(x option) bool { return x.kind == o.kind }); j >= 0 {
			o.shanten, o.ukeire, o.base = opts[j].shanten, opts[j].ukeire, opts[j].base
			opts = append(opts, o)
			continue
		}
		c := all
		c[o.kind]--
		sh, acc := p.shanten(c, melds)
		for _, k := range acc {
			o.ukeire += max(0, 4-visible[k])
		}
		o.shanten, o.base = sh, sh
		opts = append(opts, o)
	}
	sortx.Func(opts, func(a, b option) int {
		switch {
		case a.shanten != b.shanten:
			return a.shanten - b.shanten
		case a.ukeire != b.ukeire:
			return b.ukeire - a.ukeire
		case outer(a.kind) != outer(b.kind):
			return outer(b.kind) - outer(a.kind)
		case a.kind != b.kind:
			return int(a.kind) - int(b.kind)
		case a.red != b.red:
			return b2i(a.red) - b2i(b.red) // a red five is dora: discard the plain one
		}
		return 0
	})
	return opts
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// outer ranks how isolated a tile tends to be: honors 2, terminals 1.
func outer(k tile.Kind) int {
	switch {
	case k.IsHonor():
		return 2
	case k.IsTerminal():
		return 1
	}
	return 0
}

// shanten returns the lowest shanten of the concealed tiles c, with melds
// called melds, and the kinds that lower it. Seven pairs and thirteen
// orphans count only without melds.
func (p *Player) shanten(c tile.Counts, melds int) (int, []tile.Kind) {
	target := shanten.NormalTarget
	target.Melds -= melds
	ev := p.eng.Evaluate(&c, &target)
	var set [tile.NumKinds]bool
	ev.Ukeire(&set)
	best := ev.Dist - 1
	if melds > 0 {
		return best, kindsOf(&set)
	}
	best, _ = shanten.Lowest(&c, best, &set)
	return best, kindsOf(&set)
}

func kindsOf(set *[tile.NumKinds]bool) []tile.Kind {
	var out []tile.Kind
	for k, ok := range set {
		if ok {
			out = append(out, tile.Kind(k))
		}
	}
	return out
}

// folds reports whether a hand at shanten sh folds against threats riichi
// seats: always from foldShanten, and one step from tenpai against two or
// more of them or with a cheap hand. The master decides by masterFolds,
// with the hand's ukeire (< 0 when not known).
func (p *Player) folds(v game.View, sh, ukeire, threats int) bool {
	if p.master {
		return p.masterFolds(v, sh, ukeire, threats)
	}
	switch {
	case p.weak || threats == 0 || sh <= 0:
		return false
	case sh >= foldShanten:
		return true
	}
	return threats >= 2 || cheap(v)
}

// cheap reports whether the viewer's hand is not worth pushing one step
// from tenpai: a non-dealer's hand without dora (red fives included).
func cheap(v game.View) bool {
	if v.Dealer == v.Viewer {
		return false
	}
	me := v.Seats[v.Viewer]
	tiles := slices.Clone(me.Hand)
	if me.Drawn != nil {
		tiles = append(tiles, *me.Drawn)
	}
	for _, m := range me.Melds {
		tiles = append(tiles, m.Tiles...)
	}
	for _, t := range tiles {
		if t.Red {
			return false
		}
		for _, ind := range v.DoraIndicators {
			if t.Kind == tile.DoraFromIndicator(ind.Kind) {
				return false
			}
		}
	}
	return true
}

// safeKinds returns the kinds that cannot deal into seat: its own river
// and, once it is in riichi, every tile any seat discarded after its
// declaration (passing a winning tile then is furiten for the round).
func safeKinds(v game.View, seat int) [tile.NumKinds]bool {
	var safe [tile.NumKinds]bool
	s := v.Seats[seat]
	declared := -1
	for _, rt := range s.River {
		safe[rt.Tile.Kind] = true
		if rt.Riichi {
			declared = rt.Order
		}
	}
	// declared < 0 with Riichi set does not happen in a real round (the
	// declaration tile keeps its mark, called or not); a hand-built view
	// gets only the river then.
	if !s.Riichi || declared < 0 {
		return safe
	}
	for _, o := range v.Seats {
		for _, rt := range o.River {
			if rt.Order > declared {
				safe[rt.Tile.Kind] = true
			}
		}
	}
	return safe
}

// threats returns the safe kinds of the seats the player defends against,
// every other seat in riichi first (riichi of them) and for the master
// open hands after them (see openThreats).
func (p *Player) threats(v game.View) (safe [][tile.NumKinds]bool, riichi int) {
	if peeked(v) {
		return nil, 0 // it sees what it would deal into instead (peek.go)
	}
	safe = riichiThreats(v)
	riichi = len(safe)
	if p.master {
		safe = openThreats(v, safe)
	}
	return safe, riichi
}

// riichiThreats returns the safe kinds of every other seat in riichi.
func riichiThreats(v game.View) [][tile.NumKinds]bool {
	var out [][tile.NumKinds]bool
	for _, s := range v.Seats {
		if s.Seat != v.Viewer && s.Riichi {
			out = append(out, safeKinds(v, s.Seat))
		}
	}
	return out
}

// safest picks the discard with the least danger summed over the riichi
// seats, keeping the efficiency order among equals.
func safest(opts []option, threats [][tile.NumKinds]bool, visible *tile.Counts) string {
	best, bestDanger := "", -1
	for _, o := range opts {
		d := 0
		for i := range threats {
			d += danger(o.kind, &threats[i], visible)
		}
		if bestDanger < 0 || d < bestDanger {
			best, bestDanger = o.tile, d
		}
	}
	return best
}

// MaxDanger is the highest score Danger returns.
const MaxDanger = 9

// Danger scores, from 0 (safe) to MaxDanger, how likely discarding k is to
// deal into seat as the CPU judges it, with the tiles v's viewer can see.
// It is meant for a seat in riichi; for another seat only its own river
// counts as safe.
func Danger(v game.View, seat int, k tile.Kind) int {
	safe := safeKinds(v, seat)
	visible := v.Visible()
	return danger(k, &safe, &visible)
}

// danger scores k against one seat whose safe kinds are safe (see
// safeKinds): 0 safe or an honor with all 4 seen, 1 an honor with 3 seen,
// 2 a number tile with no two-sided wait left on it, 3 an honor with 2
// seen, 5 one of two two-sided waits ruled out, 6 other honors, then 7
// terminals, 8 2/8 and 9 middle tiles. A two-sided wait on k is ruled out
// when its other tile is safe (suji) or one of its two tiles has all 4 in
// sight (kabe, no-chance).
func danger(k tile.Kind, safe *[tile.NumKinds]bool, visible *tile.Counts) int {
	if safe[k] {
		return 0
	}
	if k.IsHonor() {
		switch visible[k] {
		case 4:
			return 0 // nobody can wait on it
		case 3:
			return 1
		case 2:
			return 3
		}
		return 6
	}
	n := k.Num()
	// The two-sided waits on k: k-2 k-1 (from 4 up) and k+1 k+2 (up to 6).
	sides, open := 0, 0
	if n >= 4 {
		sides++
		if !safe[k-3] && visible[k-1] < 4 && visible[k-2] < 4 {
			open++
		}
	}
	if n <= 6 {
		sides++
		if !safe[k+3] && visible[k+1] < 4 && visible[k+2] < 4 {
			open++
		}
	}
	switch {
	case open == 0:
		return 2 // suji or no-chance
	case open < sides:
		return 5 // half suji of 4, 5, 6
	case n == 1 || n == 9:
		return 7
	case n == 2 || n == 8:
		return 8
	}
	return 9
}
