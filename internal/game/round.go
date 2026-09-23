// Package game plays one closed-hand round of four-player riichi mahjong
// (Phase 2a): deal, draws and discards, riichi, tsumo and ron, and the
// exhaustive draw, with points settled at the end. Calls (pon, chii, kan)
// and multi-round games come in Phase 2b.
package game

import (
	"errors"
	"fmt"
	"slices"

	"github.com/litencatt/mhj2/internal/score"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
	"github.com/litencatt/mhj2/internal/yaku"
)

// Errors returned by Apply; the server maps them to HTTP statuses.
var (
	ErrInvalid  = errors.New("invalid action")
	ErrConflict = errors.New("action not allowed now")
)

const (
	// StartPoints is each player's score at the start.
	StartPoints = 25000
	// RiichiStick is the deposit for declaring riichi.
	RiichiStick = 1000
	// notenPenalty is split between the noten and tenpai players at a draw.
	notenPenalty = 3000
	// minDrawsForRiichi is the number of draws that must remain to declare.
	minDrawsForRiichi = 4
)

// Phase is what the round is waiting for.
type Phase string

// Phases.
const (
	// PhaseDiscard waits for the seat to move (Turn) to discard, declare
	// riichi or tsumo. That seat holds 14 tiles.
	PhaseDiscard Phase = "discard"
	// PhaseCall waits for a seat that can ron the last discard to ron or skip.
	PhaseCall Phase = "call"
	// PhaseEnded means the round is over; see Result.
	PhaseEnded Phase = "ended"
)

// ActionType is a player's move.
type ActionType string

// Action types.
const (
	Discard ActionType = "discard"
	Riichi  ActionType = "riichi" // declare riichi and discard Tile
	Tsumo   ActionType = "tsumo"
	Ron     ActionType = "ron"
	Skip    ActionType = "skip" // pass on a ron
)

// Action is one move by a seat. Tile is set for Discard and Riichi.
type Action struct {
	Seat int        `json:"seat"`
	Type ActionType `json:"type"`
	Tile string     `json:"tile,omitempty"`
}

// RiverTile is a discarded tile; Riichi marks the declaration tile.
type RiverTile struct {
	Tile   tile.Tile
	Riichi bool
}

type player struct {
	hand   []tile.Tile // 13 concealed tiles, sorted
	drawn  *tile.Tile  // the 14th tile while it is this seat's turn
	river  []RiverTile
	points int

	riichi, doubleRiichi bool
	ippatsu              bool
	// tempFuriten: passed a winning tile since this seat's last draw.
	// riichiFuriten: passed a winning tile after riichi (lasts the round).
	tempFuriten, riichiFuriten bool
}

// Result describes how the round ended.
type Result struct {
	Kind   string // "tsumo", "ron" or "draw"
	Winner int    // -1 on a draw
	From   int    // the discarder on a ron, else -1
	// Win, Points and WinTile are set for tsumo and ron.
	Win     *yaku.Win
	Points  score.Points
	WinTile tile.Tile
	Tenpai  [4]bool // set on a draw
	Deltas  [4]int  // points at the end minus points at the start (riichi sticks paid and received included)
	// Deposit is the riichi sticks left on the table (only after a draw).
	Deposit int
}

// Round is one round in progress. It is not safe for concurrent use.
type Round struct {
	wall      *wall.Wall
	dealer    int
	roundWind tile.Kind
	players   [4]player
	turn      int // seat whose PhaseDiscard it is, or who discarded last
	draws     int // live draws taken
	phase     Phase
	deposit   int

	// The last discard and who may still ron it (in head-bump order).
	lastDiscard   tile.Tile
	callers       []int
	pendingRiichi bool // the last discard declared riichi, not yet accepted

	log    []Action
	result *Result
}

// New deals a round from seed. The dealer is seed mod 4; the round is East.
func New(seed int64) *Round {
	return NewWithWall(wall.New(seed), int(((seed%4)+4)%4))
}

// NewWithWall deals a round from a given wall and dealer (used by tests).
func NewWithWall(w *wall.Wall, dealer int) *Round {
	r := &Round{wall: w, dealer: dealer, roundWind: tile.East, turn: dealer}
	for s := range r.players {
		r.players[s].hand = w.HandOf(s)
		r.players[s].points = StartPoints
	}
	r.draw(dealer)
	return r
}

// Seed returns the wall's seed.
func (r *Round) Seed() int64 { return r.wall.Seed() }

// Dealer returns the dealer's seat.
func (r *Round) Dealer() int { return r.dealer }

// Phase returns what the round is waiting for.
func (r *Round) Phase() Phase { return r.phase }

// Result returns the outcome once the round has ended, else nil.
func (r *Round) Result() *Result { return r.result }

// Log returns every applied action in order.
func (r *Round) Log() []Action { return slices.Clone(r.log) }

// SeatWind returns seat's wind: the dealer is East.
func (r *Round) SeatWind(seat int) tile.Kind {
	return tile.East + tile.Kind((seat-r.dealer+4)%4)
}

// DrawsLeft returns how many live draws remain.
func (r *Round) DrawsLeft() int { return wall.LiveDraws4 - r.draws }

// Actor returns the seat that must act now, or -1 once the round has ended.
func (r *Round) Actor() int {
	switch r.phase {
	case PhaseDiscard:
		return r.turn
	case PhaseCall:
		return r.callers[0]
	}
	return -1
}

func (r *Round) draw(seat int) {
	t, ok := r.wall.Draw4(r.draws)
	if !ok {
		panic(fmt.Sprintf("game: draw %d past the live wall", r.draws))
	}
	r.draws++
	p := &r.players[seat]
	p.drawn = &t
	p.tempFuriten = false
	r.turn = seat
	r.phase = PhaseDiscard
}

// Apply performs a move. It returns ErrConflict if the seat may not make
// that move now and ErrInvalid for a malformed one; the round is unchanged
// on error.
func (r *Round) Apply(a Action) error {
	if r.phase == PhaseEnded {
		return fmt.Errorf("%w: the round has ended", ErrConflict)
	}
	if a.Seat != r.Actor() {
		return fmt.Errorf("%w: seat %d is not to act (seat %d is)", ErrConflict, a.Seat, r.Actor())
	}
	var err error
	switch {
	case r.phase == PhaseDiscard && (a.Type == Discard || a.Type == Riichi):
		err = r.discard(a.Seat, a.Tile, a.Type == Riichi)
	case r.phase == PhaseDiscard && a.Type == Tsumo:
		err = r.tsumo(a.Seat)
	case r.phase == PhaseCall && a.Type == Ron:
		err = r.ron(a.Seat)
	case r.phase == PhaseCall && a.Type == Skip:
		r.skip(a.Seat)
	default:
		err = fmt.Errorf("%w: %s during %s", ErrConflict, a.Type, r.phase)
	}
	if err == nil {
		r.log = append(r.log, a)
	}
	return err
}

// tiles14 returns the seat's hand plus its drawn tile.
func (p *player) tiles14() []tile.Tile {
	ts := slices.Clone(p.hand)
	if p.drawn != nil {
		ts = append(ts, *p.drawn)
	}
	return ts
}

func (r *Round) discard(seat int, s string, declare bool) error {
	p := &r.players[seat]
	tiles := p.tiles14()
	idx := slices.IndexFunc(tiles, func(t tile.Tile) bool { return t.String() == s })
	if idx < 0 {
		return fmt.Errorf("%w: tile %q is not in seat %d's hand", ErrInvalid, s, seat)
	}
	if p.riichi {
		// Only the drawn tile (the last one) may go, even if the hand holds
		// the same tile.
		if idx = len(tiles) - 1; tiles[idx].String() != s {
			return fmt.Errorf("%w: after riichi only the drawn tile can be discarded", ErrConflict)
		}
	}
	if declare && !slices.Contains(r.riichiDiscards(seat), s) {
		return fmt.Errorf("%w: riichi is not allowed discarding %s", ErrConflict, s)
	}
	t := tiles[idx]
	first := len(p.river) == 0
	p.hand = slices.Delete(tiles, idx, idx+1)
	tile.Sort(p.hand)
	p.drawn = nil
	p.ippatsu = false // a discard after the declaration ends ippatsu
	p.river = append(p.river, RiverTile{Tile: t, Riichi: declare})
	if declare {
		// Accepted once the discard passes without a ron.
		p.doubleRiichi = first // no calls in Phase 2a, so the first go-around is never interrupted
	}
	r.pendingRiichi = declare
	r.lastDiscard = t
	r.callers = nil
	for i := 1; i < 4; i++ {
		o := (seat + i) % 4
		if !slices.Contains(r.waits(o), t.Kind) {
			continue
		}
		if r.canRon(o) {
			r.callers = append(r.callers, o)
		} else {
			r.passed(o)
		}
	}
	if len(r.callers) > 0 {
		r.phase = PhaseCall
		return nil
	}
	r.afterDiscard()
	return nil
}

// passed records that seat let a winning tile go by.
func (r *Round) passed(seat int) {
	p := &r.players[seat]
	p.tempFuriten = true
	if p.riichi {
		p.riichiFuriten = true
	}
}

// afterDiscard runs once nobody rons the last discard.
func (r *Round) afterDiscard() {
	if r.pendingRiichi {
		p := &r.players[r.turn]
		p.riichi = true
		p.ippatsu = true
		p.points -= RiichiStick
		r.deposit += RiichiStick
		r.pendingRiichi = false
	}
	r.callers = nil
	if r.DrawsLeft() == 0 {
		r.exhaustiveDraw()
		return
	}
	r.draw((r.turn + 1) % 4)
}

func (r *Round) skip(seat int) {
	r.passed(seat)
	r.callers = r.callers[1:]
	if len(r.callers) == 0 {
		r.afterDiscard()
	}
}

// ctx is the win context for seat winning on win.
func (r *Round) ctx(seat int, win tile.Kind, ron bool) yaku.Context {
	p := &r.players[seat]
	last := r.DrawsLeft() == 0
	return yaku.Context{
		WinTile:        win,
		Ron:            ron,
		Riichi:         p.riichi && !p.doubleRiichi,
		DoubleRiichi:   p.riichi && p.doubleRiichi,
		Ippatsu:        p.ippatsu,
		Haitei:         !ron && last,
		Houtei:         ron && last,
		RoundWind:      r.roundWind,
		SeatWind:       r.SeatWind(seat),
		DoraIndicators: r.wall.DoraIndicators(),
		UraIndicators:  r.wall.UraDoraIndicators(),
	}
}

// ronWin evaluates seat's hand plus the last discard.
func (r *Round) ronWin(seat int) (yaku.Win, bool) {
	ts := append(slices.Clone(r.players[seat].hand), r.lastDiscard)
	w, ok := yaku.Evaluate(ts, r.ctx(seat, r.lastDiscard.Kind, true))
	return w, ok && w.HasYaku()
}

// tsumoWin evaluates seat's hand plus its drawn tile.
func (r *Round) tsumoWin(seat int) (yaku.Win, bool) {
	p := &r.players[seat]
	if p.drawn == nil {
		return yaku.Win{}, false
	}
	w, ok := yaku.Evaluate(p.tiles14(), r.ctx(seat, p.drawn.Kind, false))
	return w, ok && w.HasYaku()
}

func (r *Round) canRon(seat int) bool {
	if r.furiten(seat) {
		return false
	}
	_, ok := r.ronWin(seat)
	return ok
}

// furiten reports whether seat may not ron: a wait in its own river, or a
// winning tile passed (this go-around, or at all after riichi).
func (r *Round) furiten(seat int) bool {
	p := &r.players[seat]
	if p.tempFuriten || p.riichiFuriten {
		return true
	}
	for _, w := range r.waits(seat) {
		if slices.ContainsFunc(p.river, func(rt RiverTile) bool { return rt.Tile.Kind == w }) {
			return true
		}
	}
	return false
}

// waits returns the kinds that complete seat's 13-tile hand.
func (r *Round) waits(seat int) []tile.Kind {
	return Waits(tile.CountsOf(r.players[seat].hand))
}

// Waits returns the kinds that complete a 13-tile hand (a kind whose four
// tiles are all in the hand cannot be waited on).
func Waits(c tile.Counts) []tile.Kind {
	var out []tile.Kind
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
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

// riichiDiscards returns the tiles seat may discard while declaring riichi:
// closed, not yet in riichi, enough points and draws, and tenpai after the
// discard. Empty when riichi is not allowed.
func (r *Round) riichiDiscards(seat int) []string {
	p := &r.players[seat]
	if p.riichi || p.drawn == nil || p.points < RiichiStick || r.DrawsLeft() < minDrawsForRiichi {
		return nil
	}
	tiles := p.tiles14()
	var out []string
	for i, t := range tiles {
		if slices.Contains(out, t.String()) {
			continue
		}
		c := tile.CountsOf(slices.Delete(slices.Clone(tiles), i, i+1))
		if len(Waits(c)) > 0 {
			out = append(out, t.String())
		}
	}
	return out
}

func (r *Round) tsumo(seat int) error {
	w, ok := r.tsumoWin(seat)
	if !ok {
		return fmt.Errorf("%w: seat %d has no winning hand with yaku", ErrConflict, seat)
	}
	p := &r.players[seat]
	pts := score.FromWin(w, seat == r.dealer, true)
	res := &Result{Kind: "tsumo", Winner: seat, From: -1, Win: &w, Points: pts, WinTile: *p.drawn}
	for o := range r.players {
		if o == seat {
			continue
		}
		pay := pts.FromNonDealer
		if o == r.dealer {
			pay = pts.FromDealer
		}
		res.Deltas[o] -= pay
		res.Deltas[seat] += pay
	}
	r.finish(res)
	return nil
}

func (r *Round) ron(seat int) error {
	w, ok := r.ronWin(seat)
	if !ok {
		return fmt.Errorf("%w: seat %d cannot ron", ErrConflict, seat)
	}
	// A riichi declared on the winning discard is not accepted: no stick.
	if r.pendingRiichi {
		r.players[r.turn].doubleRiichi = false
		r.pendingRiichi = false
	}
	pts := score.FromWin(w, seat == r.dealer, false)
	res := &Result{Kind: "ron", Winner: seat, From: r.turn, Win: &w, Points: pts, WinTile: r.lastDiscard}
	res.Deltas[r.turn] -= pts.Ron
	res.Deltas[seat] += pts.Ron
	r.finish(res)
	return nil
}

// finish pays the riichi sticks to the winner, applies the deltas and ends
// the round. The sticks were taken from the declarers when accepted, so
// they are subtracted from the reported deltas afterwards.
func (r *Round) finish(res *Result) {
	if res.Winner >= 0 {
		res.Deltas[res.Winner] += r.deposit
		r.deposit = 0
	}
	res.Deposit = r.deposit
	for s := range r.players {
		r.players[s].points += res.Deltas[s]
		if r.players[s].riichi {
			res.Deltas[s] -= RiichiStick
		}
	}
	r.callers = nil
	r.result = res
	r.phase = PhaseEnded
}

func (r *Round) exhaustiveDraw() {
	res := &Result{Kind: "draw", Winner: -1, From: -1}
	n := 0
	for s := range r.players {
		res.Tenpai[s] = len(r.waits(s)) > 0
		if res.Tenpai[s] {
			n++
		}
	}
	if n > 0 && n < 4 {
		for s, t := range res.Tenpai {
			if t {
				res.Deltas[s] = notenPenalty / n
			} else {
				res.Deltas[s] = -notenPenalty / (4 - n)
			}
		}
	}
	r.finish(res)
}
