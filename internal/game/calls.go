package game

import (
	"fmt"
	"slices"

	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// claim is what one seat may do with the last discard (or a tile added to
// a kan), and its answer once given.
type claim struct {
	seat   int
	ron    bool
	pon    bool
	minkan bool
	chii   [][2]tile.Tile // concealed pairs that make a sequence with the tile
	answer *Action
}

// pendingKakan is an added kan waiting for the other seats to rob it.
type pendingKakan struct {
	seat int
	meld int // index of the pon being extended
	tile tile.Tile
}

// openClaims collects every seat's claims on the tile just discarded (or
// added to a kan, robbing: ron only) and enters the call phase, or moves on
// when nobody can claim it. A seat that could ron but cannot (furiten or no
// yaku) has passed the tile.
func (r *Round) openClaims(from int, robbing bool) {
	t := r.lastDiscard
	r.claims = nil
	canCall := !robbing && r.DrawsLeft() > 0 // the last discard cannot be called
	for i := 1; i < 4; i++ {
		o := (from + i) % 4
		p := &r.players[o]
		c := claim{seat: o}
		if slices.Contains(r.waits(o), t.Kind) {
			if r.canRon(o) {
				c.ron = true
			} else {
				r.passed(o)
			}
		}
		if canCall && !p.riichi {
			n := countKind(p.hand, t.Kind)
			c.pon = n >= 2 && r.hasDiscardAfter(o, pickKind(p.hand, t.Kind, 2), kuikaePon(t.Kind))
			c.minkan = n == 3 && r.canKan()
			if i == 1 {
				c.chii = r.chiiOptions(o, t)
			}
		}
		if c.ron || c.pon || c.minkan || len(c.chii) > 0 {
			r.claims = append(r.claims, c)
		}
	}
	if len(r.claims) > 0 {
		r.phase = PhaseCall
		return
	}
	r.claimsDeclined()
}

// claimsDeclined moves on after nobody claims the tile: the discard passes,
// or the added kan completes.
func (r *Round) claimsDeclined() {
	r.claims = nil
	if k := r.robbing; k != nil {
		r.robbing = nil
		r.completeKakan(k)
		return
	}
	r.afterDiscard()
}

// answer records a seat's answer to its claim; once every seat has
// answered, the highest claim is carried out.
func (r *Round) answer(a Action) error {
	i := slices.IndexFunc(r.claims, func(c claim) bool { return c.seat == a.Seat })
	c := &r.claims[i]
	ok := false
	switch a.Type {
	case Skip:
		ok = true
	case Ron:
		ok = c.ron
	case Pon:
		ok = c.pon && (len(a.Tiles) == 0 || r.validPonTiles(a.Seat, a.Tiles))
	case Kan:
		ok = c.minkan
	case Chii:
		ok = slices.ContainsFunc(c.chii, func(pair [2]tile.Tile) bool {
			return len(a.Tiles) == 2 && sameTiles(pair[:], a.Tiles)
		})
	default:
		return fmt.Errorf("%w: %s during %s", ErrConflict, a.Type, r.phase)
	}
	if !ok {
		return fmt.Errorf("%w: seat %d cannot %s now", ErrConflict, a.Seat, a.Type)
	}
	c.answer = &a
	// Seats answer in turn order, so a ron beats every later claim (head
	// bump, and ron over pon and chii) and ends the call phase at once.
	if a.Type == Ron || r.Actor() < 0 {
		r.resolveClaims()
	}
	return nil
}

// resolveClaims carries out the highest answer: a ron (the first seat in
// turn order: head bump), then a pon or kan, then a chii. Seats that could
// ron but did not have passed the tile.
func (r *Round) resolveClaims() {
	claims := r.claims
	answered := func(c claim, typ ActionType) bool { return c.answer != nil && c.answer.Type == typ }
	win := slices.IndexFunc(claims, func(c claim) bool { return answered(c, Ron) })
	for _, c := range claims {
		if c.ron && (win < 0 || c.seat != claims[win].seat) {
			r.passed(c.seat)
		}
	}
	if win >= 0 {
		_ = r.ron(claims[win].seat) // valid: offered only when canRon
		return
	}
	for _, typ := range []ActionType{Pon, Kan, Chii} {
		if i := slices.IndexFunc(claims, func(c claim) bool { return answered(c, typ) }); i >= 0 {
			r.claims = nil
			r.call(*claims[i].answer)
			return
		}
	}
	r.claimsDeclined()
}

// call makes seat's pon, open kan or chii on the last discard.
func (r *Round) call(a Action) {
	from := r.turn
	r.acceptRiichi() // a riichi discard that is called stands
	t := r.lastDiscard
	rp := &r.players[from]
	rp.river[len(rp.river)-1].Called = true
	p := &r.players[a.Seat]
	var used []tile.Tile
	meld := yaku.Meld{Type: yaku.Trip, Kind: t.Kind, Open: true}
	switch a.Type {
	case Pon:
		if len(a.Tiles) == 2 {
			used = tilesByString(p.hand, a.Tiles)
		} else {
			used = pickKind(p.hand, t.Kind, 2)
		}
		p.kuikae = kuikaePon(t.Kind)
	case Kan:
		used = pickKind(p.hand, t.Kind, 3)
		meld.Kan = true
	case Chii:
		used = tilesByString(p.hand, a.Tiles)
		ks := []tile.Kind{used[0].Kind, used[1].Kind, t.Kind}
		slices.Sort(ks)
		meld = yaku.Meld{Type: yaku.Seq, Kind: ks[0], Open: true}
		p.kuikae = kuikaeChii(t.Kind, ks[0])
	}
	p.hand = removeTiles(p.hand, used)
	p.melds = append(p.melds, Called{Meld: meld, Tiles: append(used, t), From: from})
	if a.Type != Chii {
		r.notePao(a.Seat, from)
	}
	r.interrupt()
	r.logEvent(Action{Seat: a.Seat, Type: a.Type, Tile: t.String(), Tiles: tile.Strings(used)})
	r.startTurn(a.Seat)
	if a.Type == Kan {
		r.kanSeats = append(r.kanSeats, a.Seat)
		r.drawRinshan(a.Seat, true)
		r.markEvent()
	}
}

// notePao makes from responsible (包) when seat's pon or open kan of its
// discard completed the melds of a yakuman: the third dragon (大三元), the
// fourth wind (大四喜) or, an open kan only, the fourth kan (四槓子). An ankan
// or an added kan never makes a seat responsible, but counts towards the
// melds.
func (r *Round) notePao(seat, from int) {
	p := &r.players[seat]
	last := p.melds[len(p.melds)-1].Meld
	dragons, winds, kans := 0, 0, 0
	for _, m := range p.melds {
		if m.Meld.Type != yaku.Trip {
			continue
		}
		switch {
		case m.Meld.Kind >= tile.Haku:
			dragons++
		case m.Meld.Kind >= tile.East:
			winds++
		}
		if m.Meld.Kan {
			kans++
		}
	}
	switch {
	case last.Kind >= tile.Haku && dragons == 3:
		p.pao = append(p.pao, Pao{Seat: from, Yaku: "daisangen"})
	case last.Kind >= tile.East && winds == 4:
		p.pao = append(p.pao, Pao{Seat: from, Yaku: "daisuushii"})
	}
	if last.Kan && kans == 4 {
		p.pao = append(p.pao, Pao{Seat: from, Yaku: "suukantsu"})
	}
}

// interrupt ends every seat's ippatsu: a call breaks the go-around.
func (r *Round) interrupt() {
	for s := range r.players {
		r.players[s].ippatsu = false
	}
}

// canKan reports whether another kan is allowed: at most four, and a draw
// must remain after the replacement.
func (r *Round) canKan() bool {
	return r.kans < wall.MaxKans && r.DrawsLeft() > 0
}

// drawRinshan gives seat the next replacement tile after a kan; the kan
// takes a draw off the live wall and adds a dora indicator. A concealed kan
// turns its indicator over at once; an open or added kan (open true) waits
// until the declarer discards, or makes another kan first.
func (r *Round) drawRinshan(seat int, open bool) {
	t, ok := r.wall.Rinshan(r.kans)
	if !ok {
		panic(fmt.Sprintf("game: rinshan %d past the dead wall", r.kans))
	}
	r.kans++
	r.revealKanDora()
	if open {
		r.pendingDora++
	} else {
		r.kanDora++
	}
	p := &r.players[seat]
	p.drawn = &t
	p.rinshan = true
	r.startTurn(seat)
}

// selfKans returns the kinds seat may declare a kan of on its own turn: a
// concealed kan of four held tiles, or an added kan onto its pon. In riichi
// only a concealed kan that keeps the waits is allowed.
func (r *Round) selfKans(seat int) []string {
	p := &r.players[seat]
	if seat != r.turn || r.phase != PhaseDiscard || p.drawn == nil || !r.canKan() {
		return nil
	}
	tiles := p.concealed()
	c := tile.CountsOf(tiles)
	var out []string
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		switch {
		case c[k] == 4 && (!p.riichi || (p.drawn.Kind == k && r.kanKeepsWaits(seat, k))):
			out = append(out, k.String())
		case c[k] >= 1 && !p.riichi && slices.ContainsFunc(p.melds, func(m Called) bool {
			return m.Meld.Type == yaku.Trip && !m.Meld.Kan && m.Meld.Kind == k
		}):
			out = append(out, k.String())
		}
	}
	return out
}

// kanKeepsWaits reports whether a riichi seat's concealed kan of k (with k
// just drawn) leaves its waits unchanged.
func (r *Round) kanKeepsWaits(seat int, k tile.Kind) bool {
	p := &r.players[seat]
	before := r.waits(seat)
	c := tile.CountsOf(p.hand)
	c[k] -= 3
	after := WaitsWith(c, append(p.meldShapes(), yaku.Meld{Type: yaku.Trip, Kind: k, Kan: true}))
	return len(before) > 0 && slices.Equal(before, after)
}

// selfKan declares a concealed or added kan of kind s on seat's turn.
func (r *Round) selfKan(seat int, s string) error {
	if !slices.Contains(r.selfKans(seat), s) {
		return fmt.Errorf("%w: seat %d cannot declare a kan of %q", ErrConflict, seat, s)
	}
	p := &r.players[seat]
	tiles := p.concealed()
	k := tiles[slices.IndexFunc(tiles, func(t tile.Tile) bool { return t.Kind.String() == s })].Kind
	p.hand, p.drawn = tiles, nil
	if m := slices.IndexFunc(p.melds, func(m Called) bool {
		return m.Meld.Type == yaku.Trip && !m.Meld.Kan && m.Meld.Kind == k
	}); m >= 0 {
		// Added kan: the other seats may rob it (chankan) first.
		added := pickKind(p.hand, k, 1)
		p.hand = removeTiles(p.hand, added)
		tile.Sort(p.hand)
		r.logEvent(Action{Seat: seat, Type: Kan, Tile: added[0].String()})
		r.lastDiscard = added[0]
		r.robbing = &pendingKakan{seat: seat, meld: m, tile: added[0]}
		r.openClaims(seat, true)
		return nil
	}
	used := pickKind(p.hand, k, 4)
	p.hand = removeTiles(p.hand, used)
	tile.Sort(p.hand)
	p.melds = append(p.melds, Called{Meld: yaku.Meld{Type: yaku.Trip, Kind: k, Kan: true}, Tiles: used, From: -1})
	r.logEvent(Action{Seat: seat, Type: Kan, Tile: s})
	r.interrupt()
	r.kanSeats = append(r.kanSeats, seat)
	r.drawRinshan(seat, false)
	r.markEvent()
	return nil
}

// completeKakan finishes an added kan nobody robbed.
func (r *Round) completeKakan(k *pendingKakan) {
	p := &r.players[k.seat]
	m := &p.melds[k.meld]
	m.Meld.Kan = true
	m.Added = true
	// keep the called tile last: the added tile goes before it
	n := len(m.Tiles)
	m.Tiles = append(m.Tiles[:n-1:n-1], k.tile, m.Tiles[n-1])
	r.interrupt()
	r.kanSeats = append(r.kanSeats, k.seat)
	r.drawRinshan(k.seat, true)
}

// chiiOptions returns the concealed pairs seat can chii t with, each with a
// legal discard left afterwards.
func (r *Round) chiiOptions(seat int, t tile.Tile) [][2]tile.Tile {
	k := t.Kind
	if k.IsHonor() {
		return nil
	}
	p := &r.players[seat]
	var out [][2]tile.Tile
	for _, low := range []tile.Kind{k - 2, k - 1, k} {
		if low > k || low.Suit() != k.Suit() || low.Num() > 7 || (k-low > 2) {
			continue
		}
		var need []tile.Kind
		for x := low; x < low+3; x++ {
			if x != k {
				need = append(need, x)
			}
		}
		// every distinct choice of physical tiles (a red five or not)
		for _, a := range distinct(p.hand, need[0]) {
			for _, b := range distinct(p.hand, need[1]) {
				pair := [2]tile.Tile{a, b}
				if r.hasDiscardAfter(seat, pair[:], kuikaeChii(k, low)) {
					out = append(out, pair)
				}
			}
		}
	}
	return out
}

// hasDiscardAfter reports whether seat keeps a discard that kuikae allows
// after calling with used.
func (r *Round) hasDiscardAfter(seat int, used []tile.Tile, banned []tile.Kind) bool {
	for _, t := range removeTiles(r.players[seat].hand, used) {
		if !slices.Contains(banned, t.Kind) {
			return true
		}
	}
	return false
}

// kuikaePon bans discarding the called kind right after a pon.
func kuikaePon(k tile.Kind) []tile.Kind { return []tile.Kind{k} }

// kuikaeChii bans discarding the called kind and, when it sits at an end of
// the sequence starting at low, the tile on the other side (suji kuikae).
func kuikaeChii(k, low tile.Kind) []tile.Kind {
	banned := []tile.Kind{k}
	switch {
	case k == low && low.Num() <= 6:
		banned = append(banned, low+3)
	case k == low+2 && low.Num() >= 2:
		banned = append(banned, low-1)
	}
	return banned
}

func (r *Round) validPonTiles(seat int, ss []string) bool {
	used := tilesByString(r.players[seat].hand, ss)
	return len(used) == 2 && used[0].Kind == r.lastDiscard.Kind && used[1].Kind == r.lastDiscard.Kind
}

func countKind(ts []tile.Tile, k tile.Kind) int {
	n := 0
	for _, t := range ts {
		if t.Kind == k {
			n++
		}
	}
	return n
}

// pickKind returns n tiles of kind k from ts, plain ones before a red five.
func pickKind(ts []tile.Tile, k tile.Kind, n int) []tile.Tile {
	var plain, red []tile.Tile
	for _, t := range ts {
		switch {
		case t.Kind != k:
		case t.Red:
			red = append(red, t)
		default:
			plain = append(plain, t)
		}
	}
	all := append(plain, red...)
	if len(all) < n {
		return nil
	}
	return all[:n]
}

// distinct returns one tile of kind k per physical variant (plain, red).
func distinct(ts []tile.Tile, k tile.Kind) []tile.Tile {
	var out []tile.Tile
	for _, t := range ts {
		if t.Kind == k && !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	return out
}

// tilesByString finds the tiles named by ss in ts (each used once); nil if
// any is missing.
func tilesByString(ts []tile.Tile, ss []string) []tile.Tile {
	left := slices.Clone(ts)
	var out []tile.Tile
	for _, s := range ss {
		i := slices.IndexFunc(left, func(t tile.Tile) bool { return t.String() == s })
		if i < 0 {
			return nil
		}
		out = append(out, left[i])
		left = slices.Delete(left, i, i+1)
	}
	return out
}

// removeTiles returns ts without one copy of each tile in used.
func removeTiles(ts, used []tile.Tile) []tile.Tile {
	out := slices.Clone(ts)
	for _, u := range used {
		if i := slices.Index(out, u); i >= 0 {
			out = slices.Delete(out, i, i+1)
		}
	}
	return out
}

func sameTiles(a []tile.Tile, ss []string) bool {
	x, y := tile.Strings(a), slices.Clone(ss)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(x, y)
}
