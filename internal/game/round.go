// Package game plays four-player riichi mahjong against CPU seats: a Round
// (deal, draws and discards, riichi, tsumo and ron, exhaustive and abortive
// draws, settlement) and a Hanchan of rounds (dealer rotation, honba,
// carried sticks, end of the game and standings), with calls (pon, chii, kan).
package game

import (
	"errors"
	"fmt"
	"slices"

	"github.com/litencatt/mhj-dojo/internal/score"
	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// Errors returned by Apply; apicall maps them to status codes.
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
	// honbaRon is paid per honba by the discarder on a ron, honbaTsumo by
	// each other seat on a tsumo.
	honbaRon   = 300
	honbaTsumo = 100
)

// Phase is what the round is waiting for.
type Phase string

// Phases.
const (
	// PhaseDiscard waits for the seat to move (Turn) to discard, declare
	// riichi or tsumo. That seat holds 14 tiles.
	PhaseDiscard Phase = "discard"
	// PhaseCall waits for the seats that may claim the last discard (ron,
	// pon, kan, chii), or rob an added kan (ron), to answer or skip.
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
	Skip    ActionType = "skip"    // pass on a claim
	Kyuushu ActionType = "kyuushu" // declare nine different terminals and honors: an abortive draw
	Pon     ActionType = "pon"     // claim the discard with two tiles of its kind
	Chii    ActionType = "chii"    // claim the left seat's discard with the two Tiles
	// Kan is a claimed open kan (daiminkan) in the call phase, or on the
	// seat's own turn a concealed kan (ankan) or an added kan (kakan) of
	// the kind of Tile.
	Kan ActionType = "kan"
	// Redraw sends the drawn tile to the end of the live wall and draws the
	// next one instead (a dojo cheat; see SeatConfig.RedrawsPerRound).
	Redraw ActionType = "redraw"
	// Summon swaps the drawn tile with the next live-wall tile of the kind
	// of Tile (a dojo cheat; see SeatConfig.SummonsPerRound).
	Summon ActionType = "summon"
)

// Abortive draw reasons (Result.Reason when Kind is "abort").
const (
	AbortKyuushu = "kyuushu"   // 九種九牌
	AbortSuufon  = "suufon"    // 四風連打
	AbortSuucha  = "suucha"    // 四家立直
	AbortKans    = "suukaikan" // 四開槓: four kans by more than one seat
)

// Action is one move by a seat. Tile is set for Discard, Riichi and Kan
// (the kind), Tiles for Chii (the two concealed tiles) and optionally Pon.
type Action struct {
	Seat  int        `json:"seat"`
	Type  ActionType `json:"type"`
	Tile  string     `json:"tile,omitempty"`
	Tiles []string   `json:"tiles,omitempty"`
}

// RiverTile is a discarded tile. Riichi marks the declaration tile (not one
// that was ronned: that riichi never stood), Called a tile another seat
// claimed into a meld (it stays in the river for furiten, but counts once,
// in the meld). Order is the discard's place among all the round's
// discards, every seat's (0 first), so a tile passed after a riichi can be
// told apart.
type RiverTile struct {
	Tile   tile.Tile
	Riichi bool
	Called bool
	Order  int
}

// Called is a meld a seat has called (or an ankan): its shape, its tiles
// and the seat the called tile came from (-1 for an ankan). Added marks a
// kan made by adding a tile to a pon (kakan).
type Called struct {
	Meld  yaku.Meld
	Tiles []tile.Tile
	From  int
	Added bool
}

type player struct {
	hand   []tile.Tile // concealed tiles, sorted: 13 - 3*len(melds)
	drawn  *tile.Tile  // the tile drawn this turn, if any (none after a call)
	melds  []Called
	river  []RiverTile
	points int

	riichi, doubleRiichi bool
	ippatsu              bool
	// tempFuriten: passed a winning tile since this seat's last turn.
	// riichiFuriten: passed a winning tile after riichi (lasts the round).
	tempFuriten, riichiFuriten bool
	// kuikae are the kinds the seat may not discard right after a call.
	kuikae []tile.Kind
	// rinshan: the drawn tile is a kan replacement (rinshan kaihou, not haitei).
	rinshan bool
	// pao are the seats responsible for a yakuman this seat's calls
	// completed (責任払い), if it wins with that yakuman.
	pao []Pao
}

// Pao is a seat responsible (包) for a yakuman of the winner: it let the
// winner call the meld that completed 大三元, 大四喜 or 四槓子. Yaku is the
// yakuman's key.
type Pao struct {
	Seat int    `json:"seat"`
	Yaku string `json:"yaku"`
}

// Result describes how the round ended.
type Result struct {
	Kind   string // "tsumo", "ron", "draw" or "abort"
	Reason string // for "abort": AbortKyuushu, AbortSuufon, AbortSuucha or AbortKans
	Winner int    // -1 on a draw
	From   int    // the discarder on a ron, else -1
	// Win, Points and WinTile are set for tsumo and ron.
	Win     *yaku.Win
	Points  score.Points
	WinTile tile.Tile
	Tenpai  [4]bool // set on a draw
	// Pao are the responsible seats for yakuman the win scored (責任払い).
	Pao []Pao
	// Deltas are points at the end minus points at the start: the sum of
	// the hand's payments (or the noten penalty), the honba payments and
	// the riichi sticks paid and received.
	Deltas      [4]int
	HandDeltas  [4]int
	HonbaDeltas [4]int
	StickDeltas [4]int
	// Honba is the round's repeat counter; Deposit the riichi sticks left on
	// the table (only after a draw), carried ones included.
	Honba   int
	Deposit int
}

// RoundConfig sets up a round: the wall, the dealer's seat, the round wind,
// the honba counter, the riichi sticks carried over and each seat's points.
type RoundConfig struct {
	Wall      *wall.Wall
	Dealer    int
	RoundWind tile.Kind
	Honba     int
	Deposit   int
	Points    [4]int

	// FirstDealer is the game's first dealer (起家): ties in the standings
	// go to the seat nearer it.
	FirstDealer int
	SeatConfig
}

// SeatConfig holds the per-seat house rules of the dojo; the zero value is
// the standard rules.
type SeatConfig struct {
	// Restrict is the yaku each seat may count (nil: all of them); riichi
	// needs "riichi" in it.
	Restrict [4]*yaku.KeySet
	// RedrawsPerRound is how many Redraw moves each seat may make in a
	// round (0: none).
	RedrawsPerRound [4]int
	// SummonsPerRound is how many Summon moves each seat may make in a
	// round (0: none).
	SummonsPerRound [4]int
	// Peek shows a seat's view (ViewFor) the other seats' concealed tiles:
	// a CPU's cheat, for its decisions only (the human's peek is the
	// match's).
	Peek [4]bool
	// DrawBias is the chance, in percent, that a seat's live-wall draw
	// which does not lower its shanten is swapped for the next live-wall
	// tile that does (see biasDraw): a CPU's cheat, out of riichi only.
	DrawBias [4]int
	// WallPeek is how many of its next draws a seat is shown (the dojo's
	// wall peek, see NextDraws): DrawBias never moves them.
	WallPeek [4]int
}

// Round is one round in progress. It is not safe for concurrent use.
type Round struct {
	wall      *wall.Wall
	dealer    int
	roundWind tile.Kind
	players   [4]player
	turn      int // seat whose PhaseDiscard it is, or who discarded last
	draws     int // live draws taken
	kans      int // kans made; each shortens the live wall and adds a dora
	phase     Phase
	deposit   int
	honba     int
	start     [4]int // points at the start of the round

	firstDealer int // the game's (RoundConfig.FirstDealer)

	// kanDora counts the kan dora indicators turned over; pendingDora the
	// open or added kans whose indicator waits for the discard after them.
	kanDora, pendingDora int

	// The last discard (or the tile added to a kan) and the claims on it,
	// in turn order from the discarder.
	lastDiscard   tile.Tile
	claims        []claim
	robbing       *pendingKakan // claims on an added kan: ron only (chankan)
	pendingRiichi bool          // the last discard declared riichi, not yet accepted
	kanSeats      []int         // who made each kan (四開槓)

	seats   SeatConfig
	redraws [4]int // Redraw moves made this round
	summons [4]int // Summon moves made this round

	biasEng *shanten.Engine // DrawBias's shanten memo, made on its first use

	log    []Action    // every applied action, for replay
	events []Action    // the moves that happened, without skips and unused claims
	marks  []EventMark // the table right after each event
	result *Result
}

// New deals a single-round game from seed: the dealer is seed mod 4, the
// round is East, and everyone starts with StartPoints.
func New(seed int64) *Round {
	return NewWithWall(wall.New(seed), DefaultFirstDealer(seed))
}

// NewWithWall is New with a given wall and dealer (used by tests).
func NewWithWall(w *wall.Wall, dealer int) *Round {
	return NewRound(RoundConfig{
		Wall: w, Dealer: dealer, FirstDealer: dealer, RoundWind: tile.East,
		Points: [4]int{StartPoints, StartPoints, StartPoints, StartPoints},
	})
}

// NewRound deals a round of a longer game from cfg.
func NewRound(cfg RoundConfig) *Round {
	r := &Round{
		wall: cfg.Wall, dealer: cfg.Dealer, roundWind: cfg.RoundWind, turn: cfg.Dealer,
		honba: cfg.Honba, deposit: cfg.Deposit, start: cfg.Points, seats: cfg.SeatConfig, firstDealer: cfg.FirstDealer,
	}
	for s := range r.players {
		r.players[s].hand = cfg.Wall.HandOf(s)
		r.players[s].points = cfg.Points[s]
	}
	r.draw(cfg.Dealer)
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

// Log returns every applied action in order, including the answers to
// claims (for replay).
func (r *Round) Log() []Action { return slices.Clone(r.log) }

// Events returns the moves that happened, in order: discards, riichi,
// executed calls, wins and declarations. Skips and claims that lost to a
// higher one are left out, so they reveal nothing about hidden hands.
func (r *Round) Events() []Action { return slices.Clone(r.events) }

// EventMark is the table around an event: the live draws left just before
// it (the mover's own draw taken) and right after it, and the kan dora
// indicators turned over right after it. A kan's replacement draw, and the
// indicator a concealed kan turns over at once, count with the kan; the
// next seat's draw counts with that seat's own move. An added kan counts
// its replacement draw with the declarer's next move: it completes only
// once every other seat has passed on robbing it, possibly in a later
// Apply, and a mark never changes after the Apply that logged its event.
type EventMark struct {
	DrawsBefore int
	DrawsLeft   int
	KanDora     int
}

// EventMarks returns the table around each of Events.
func (r *Round) EventMarks() []EventMark { return slices.Clone(r.marks) }

// logEvent records a move that happened and the table around it.
func (r *Round) logEvent(a Action) {
	r.events = append(r.events, a)
	r.marks = append(r.marks, EventMark{DrawsBefore: r.DrawsLeft()})
	r.markEvent()
}

// markEvent brings the last event's mark up to date: an open or concealed
// kan's replacement draw comes after the kan is logged, in the same Apply.
func (r *Round) markEvent() {
	m := &r.marks[len(r.marks)-1]
	m.DrawsLeft, m.KanDora = r.DrawsLeft(), r.kanDora
}

// SeatWind returns seat's wind: the dealer is East.
func (r *Round) SeatWind(seat int) tile.Kind {
	return tile.East + tile.Kind((seat-r.dealer+4)%4)
}

// Winds returns the round wind and seat's wind.
func (r *Round) Winds(seat int) yaku.Winds {
	return yaku.Winds{Round: r.roundWind, Seat: r.SeatWind(seat)}
}

// DrawsLeft returns how many live draws remain; each kan takes one off the
// end of the live wall, which moves haitei.
func (r *Round) DrawsLeft() int { return wall.LiveDraws4 - r.kans - r.draws }

// doraIndicators returns the revealed dora indicators: one plus one per
// revealed kan dora.
func (r *Round) doraIndicators() []tile.Tile { return r.wall.DoraIndicatorsN(1 + r.kanDora) }

// KanDora returns how many kan dora indicators are turned over.
func (r *Round) KanDora() int { return r.kanDora }

// uraIndicators returns the ura-dora indicators under the revealed ones.
func (r *Round) uraIndicators() []tile.Tile { return r.wall.UraDoraIndicatorsN(1 + r.kanDora) }

// revealKanDora turns over the indicators of the open and added kans
// waiting for the declarer's discard (後めくり).
func (r *Round) revealKanDora() {
	r.kanDora += r.pendingDora
	r.pendingDora = 0
}

// Actor returns the seat that must act now, or -1 once the round has ended.
func (r *Round) Actor() int {
	switch r.phase {
	case PhaseDiscard:
		return r.turn
	case PhaseCall:
		for _, c := range r.claims {
			if c.answer == nil {
				return c.seat
			}
		}
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
	p.rinshan = false
	r.biasDraw(seat)
	r.startTurn(seat)
}

// startTurn gives seat the turn: its same go-around furiten ends.
func (r *Round) startTurn(seat int) {
	r.players[seat].tempFuriten = false
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
		r.log = append(r.log, a) // logged first: the discard opens the claims
		if err = r.discard(a.Seat, a.Tile, a.Type == Riichi); err != nil {
			r.log = r.log[:len(r.log)-1]
		}
		return err
	case r.phase == PhaseDiscard && a.Type == Tsumo:
		r.logEvent(a)
		if err = r.tsumo(a.Seat); err != nil {
			r.events = r.events[:len(r.events)-1]
			r.marks = r.marks[:len(r.marks)-1]
		}
	case r.phase == PhaseDiscard && a.Type == Kan:
		r.log = append(r.log, a)
		if err = r.selfKan(a.Seat, a.Tile); err != nil {
			r.log = r.log[:len(r.log)-1]
		}
		return err
	case r.phase == PhaseDiscard && a.Type == Redraw:
		if !r.canRedraw(a.Seat) {
			err = fmt.Errorf("%w: redraw needs a live-wall draw after the first go-around, no riichi, a draw left and a redraw left this round", ErrConflict)
			break
		}
		a = Action{Seat: a.Seat, Type: Redraw}
		r.redraw(a.Seat)
		r.logEvent(a)
	case r.phase == PhaseDiscard && a.Type == Summon:
		if !slices.Contains(r.summonable(a.Seat), a.Tile) {
			err = fmt.Errorf("%w: summon needs a live-wall draw after the first go-around, no riichi, a draw left, a summon left this round and a %q left in the live wall", ErrConflict, a.Tile)
			break
		}
		a = Action{Seat: a.Seat, Type: Summon, Tile: a.Tile}
		r.summon(a.Seat, a.Tile)
		r.logEvent(Action{Seat: a.Seat, Type: Summon}) // the events do not tell the tile
	case r.phase == PhaseDiscard && a.Type == Kyuushu:
		if !r.canKyuushu(a.Seat) {
			err = fmt.Errorf("%w: kyuushu needs the first uninterrupted turn and nine different terminals and honors", ErrConflict)
			break
		}
		r.logEvent(a)
		r.finish(&Result{Kind: "abort", Reason: AbortKyuushu, Winner: -1, From: -1})
	case r.phase == PhaseCall:
		r.log = append(r.log, a)
		if err = r.answer(a); err != nil {
			r.log = r.log[:len(r.log)-1]
		}
		return err
	default:
		err = fmt.Errorf("%w: %s during %s", ErrConflict, a.Type, r.phase)
	}
	if err == nil {
		r.log = append(r.log, a)
	}
	return err
}

// concealed returns the seat's concealed tiles plus its drawn tile, if any.
func (p *player) concealed() []tile.Tile {
	ts := slices.Clone(p.hand)
	if p.drawn != nil {
		ts = append(ts, *p.drawn)
	}
	return ts
}

func (r *Round) discard(seat int, s string, declare bool) error {
	p := &r.players[seat]
	tiles := p.concealed()
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
	if slices.Contains(p.kuikae, tiles[idx].Kind) {
		return fmt.Errorf("%w: %s may not be discarded right after the call (kuikae)", ErrConflict, s)
	}
	if declare && !slices.Contains(r.riichiDiscards(seat), s) {
		return fmt.Errorf("%w: riichi is not allowed discarding %s", ErrConflict, s)
	}
	t := tiles[idx]
	first := r.firstGoAround(seat)
	p.hand = slices.Delete(tiles, idx, idx+1)
	tile.Sort(p.hand)
	p.drawn = nil
	p.rinshan = false
	p.kuikae = nil
	p.ippatsu = false // a discard after the declaration ends ippatsu
	order := 0
	for i := range r.players {
		order += len(r.players[i].river)
	}
	p.river = append(p.river, RiverTile{Tile: t, Riichi: declare, Order: order})
	r.revealKanDora() // before the claims: a ron on this discard counts it
	kind := Discard
	if declare {
		kind = Riichi
	}
	r.logEvent(Action{Seat: seat, Type: kind, Tile: s})
	if declare {
		// Accepted once the discard passes without a ron.
		p.doubleRiichi = first
	}
	r.pendingRiichi = declare
	r.lastDiscard = t
	r.openClaims(seat, false)
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

// acceptRiichi accepts a riichi declared on the last discard, once nobody
// rons it: the stick goes on the table.
func (r *Round) acceptRiichi() {
	if !r.pendingRiichi {
		return
	}
	p := &r.players[r.turn]
	p.riichi = true
	p.ippatsu = true
	p.points -= RiichiStick
	r.deposit += RiichiStick
	r.pendingRiichi = false
}

// afterDiscard runs once nobody claims the last discard.
func (r *Round) afterDiscard() {
	r.acceptRiichi()
	r.claims = nil
	if reason := r.abortAfterDiscard(); reason != "" {
		r.finish(&Result{Kind: "abort", Reason: reason, Winner: -1, From: -1})
		return
	}
	if r.DrawsLeft() == 0 {
		r.exhaustiveDraw()
		return
	}
	r.draw((r.turn + 1) % 4)
}

// ctx is the win context for seat winning on win.
func (r *Round) ctx(seat int, win tile.Kind, ron bool) yaku.Context {
	p := &r.players[seat]
	last := r.DrawsLeft() == 0
	chankan := ron && r.robbing != nil
	first := !ron && !p.rinshan && r.firstGoAround(seat)
	return yaku.Context{
		WinTile:        win,
		Ron:            ron,
		Riichi:         p.riichi && !p.doubleRiichi,
		DoubleRiichi:   p.riichi && p.doubleRiichi,
		Ippatsu:        p.ippatsu,
		Haitei:         !ron && last && !p.rinshan,
		Houtei:         ron && last && !chankan,
		Rinshan:        !ron && p.rinshan,
		Chankan:        chankan,
		Tenhou:         first && seat == r.dealer,
		Chiihou:        first && seat != r.dealer,
		Winds:          r.Winds(seat),
		DoraIndicators: r.doraIndicators(),
		UraIndicators:  r.uraIndicators(),
		Melds:          p.meldShapes(),
		MeldTiles:      p.meldTiles(),
	}
}

// meldShapes returns the shapes of the seat's called melds.
func (p *player) meldShapes() []yaku.Meld {
	out := make([]yaku.Meld, len(p.melds))
	for i, m := range p.melds {
		out[i] = m.Meld
	}
	return out
}

// meldTiles returns every tile of the seat's called melds.
func (p *player) meldTiles() []tile.Tile {
	var out []tile.Tile
	for _, m := range p.melds {
		out = append(out, m.Tiles...)
	}
	return out
}

// open reports whether the seat has called a meld (an ankan keeps it closed).
func (p *player) open() bool {
	return slices.ContainsFunc(p.melds, func(m Called) bool { return m.Meld.Open })
}

// ronWin evaluates seat's hand plus the last discard.
func (r *Round) ronWin(seat int) (yaku.Win, bool) {
	ts := append(slices.Clone(r.players[seat].hand), r.lastDiscard)
	w, ok := yaku.EvaluateWith(ts, r.ctx(seat, r.lastDiscard.Kind, true), r.seats.Restrict[seat])
	return w, ok && w.HasYaku()
}

// tsumoWin evaluates seat's hand plus its drawn tile.
func (r *Round) tsumoWin(seat int) (yaku.Win, bool) {
	p := &r.players[seat]
	if p.drawn == nil {
		return yaku.Win{}, false
	}
	w, ok := yaku.EvaluateWith(p.concealed(), r.ctx(seat, p.drawn.Kind, false), r.seats.Restrict[seat])
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
		if slices.ContainsFunc(p.river, func(rt RiverTile) bool { return rt.Tile.Kind == w }) { // called tiles count too
			return true
		}
	}
	return false
}

// waits returns the kinds that complete seat's concealed tiles with its melds.
func (r *Round) waits(seat int) []tile.Kind {
	p := &r.players[seat]
	return WaitsWith(tile.CountsOf(p.hand), p.meldShapes())
}

// Waits returns the kinds that complete a 13-tile closed hand.
func Waits(c tile.Counts) []tile.Kind { return WaitsWith(c, nil) }

// WaitsWith returns the kinds that complete concealed tiles c with the
// called melds. A kind whose four tiles are all in the hand, concealed or
// in a meld, cannot be waited on.
func WaitsWith(c tile.Counts, called []yaku.Meld) []tile.Kind {
	held := c
	for _, m := range called {
		switch {
		case m.Type == yaku.Seq:
			held[m.Kind]++
			held[m.Kind+1]++
			held[m.Kind+2]++
		case m.Kan:
			held[m.Kind] += 4
		default:
			held[m.Kind] += 3
		}
	}
	var out []tile.Kind
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if held[k] >= 4 {
			continue
		}
		c[k]++
		if yaku.IsCompleteWith(c, called) {
			out = append(out, k)
		}
		c[k]--
	}
	return out
}

// riichiDiscards returns the tiles seat may discard while declaring riichi:
// closed, not yet in riichi, enough points and draws, and tenpai after the
// discard. Empty when riichi is not allowed, or not among the seat's yaku.
func (r *Round) riichiDiscards(seat int) []string {
	p := &r.players[seat]
	if !r.seats.Restrict[seat].Has("riichi") || p.riichi || p.open() || p.drawn == nil || p.points < RiichiStick || r.DrawsLeft() < minDrawsForRiichi {
		return nil
	}
	tiles := p.concealed()
	var out []string
	for i, t := range tiles {
		if slices.Contains(out, t.String()) {
			continue
		}
		c := tile.CountsOf(slices.Delete(slices.Clone(tiles), i, i+1))
		if len(WaitsWith(c, p.meldShapes())) > 0 {
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
	dealer := seat == r.dealer
	pts := score.FromWin(w, dealer, true)
	res := &Result{Kind: "tsumo", Winner: seat, From: -1, Win: &w, Points: pts, WinTile: *p.drawn, Pao: r.paoOf(seat, w)}
	payTsumo(res, r.dealer)
	r.finish(res)
	return nil
}

// payTsumo sets the hand payments of a tsumo by res.Winner. A responsible
// seat pays its yakuman in full; the other seats share the rest of the hand
// as usual.
func payTsumo(res *Result, dealerSeat int) {
	seat, w, pts := res.Winner, *res.Win, res.Points
	dealer := seat == dealerSeat
	rest := pts
	if len(res.Pao) > 0 {
		n := pts.Multiplier
		for _, pa := range res.Pao {
			m := yakumanOf(w, pa.Yaku)
			pay := score.Compute(0, 0, m, dealer, true).Total
			res.HandDeltas[pa.Seat] -= pay
			res.HandDeltas[seat] += pay
			n -= m
		}
		rest = score.Compute(0, 0, n, dealer, true)
	}
	for o := range res.HandDeltas {
		if o == seat {
			continue
		}
		pay := rest.FromNonDealer
		if o == dealerSeat {
			pay = rest.FromDealer
		}
		res.HandDeltas[o] -= pay
		res.HandDeltas[seat] += pay
	}
}

func (r *Round) ron(seat int) error {
	w, ok := r.ronWin(seat)
	if !ok {
		return fmt.Errorf("%w: seat %d cannot ron", ErrConflict, seat)
	}
	// A riichi declared on the winning discard is not accepted: no stick,
	// and the tile is not laid sideways.
	if r.pendingRiichi {
		p := &r.players[r.turn]
		p.doubleRiichi = false
		p.river[len(p.river)-1].Riichi = false
		r.pendingRiichi = false
	}
	r.logEvent(Action{Seat: seat, Type: Ron})
	pts := score.FromWin(w, seat == r.dealer, false)
	res := &Result{Kind: "ron", Winner: seat, From: r.turn, Win: &w, Points: pts, WinTile: r.lastDiscard, Pao: r.paoOf(seat, w)}
	payRon(res, r.dealer)
	r.finish(res)
	return nil
}

// payRon sets the hand payments of a ron by res.Winner on res.From's
// discard. A responsible seat other than the discarder pays half of its
// yakuman.
func payRon(res *Result, dealerSeat int) {
	seat, from, w := res.Winner, res.From, *res.Win
	res.HandDeltas[from] -= res.Points.Ron
	res.HandDeltas[seat] += res.Points.Ron
	for _, pa := range res.Pao {
		if pa.Seat == from {
			continue
		}
		v := score.Compute(0, 0, yakumanOf(w, pa.Yaku), seat == dealerSeat, false).Ron
		h := score.Half(v)
		res.HandDeltas[from] += v - h
		res.HandDeltas[pa.Seat] -= h
		res.HandDeltas[seat] += 2*h - v
	}
}

// paoOf returns the responsible seats of seat's calls for the yakuman w
// scored.
func (r *Round) paoOf(seat int, w yaku.Win) []Pao {
	var out []Pao
	for _, pa := range r.players[seat].pao {
		if yakumanOf(w, pa.Yaku) > 0 {
			out = append(out, pa)
		}
	}
	return out
}

// yakumanOf returns how many yakuman the yaku key scored in w (2 for a
// double yakuman), 0 if w does not have it.
func yakumanOf(w yaku.Win, key string) int {
	for _, y := range w.Yaku {
		if y.Key == key {
			return y.Han / 13
		}
	}
	return 0
}

// tsumoHonbaPayer returns the seat that pays all the honba of a tsumo: the
// responsible seat when its pao covers the whole hand, else -1 (every other
// seat pays its share).
func tsumoHonbaPayer(res *Result) int {
	if len(res.Pao) == 0 {
		return -1
	}
	n := 0
	for _, pa := range res.Pao {
		if pa.Seat != res.Pao[0].Seat {
			return -1
		}
		n += yakumanOf(*res.Win, pa.Yaku)
	}
	if n != res.Points.Multiplier {
		return -1
	}
	return res.Pao[0].Seat
}

// finish adds the honba payments and the riichi sticks to the hand's
// payments (res.HandDeltas), sets every seat's points from its points at
// the start and ends the round.
func (r *Round) finish(res *Result) {
	res.Honba = r.honba
	if res.Winner >= 0 && r.honba > 0 {
		payer := -1
		if res.Kind == "tsumo" {
			payer = tsumoHonbaPayer(res)
		}
		for o := range r.players {
			switch {
			case o == res.Winner:
			case payer >= 0:
				if o == payer {
					res.HonbaDeltas[o] -= 3 * honbaTsumo * r.honba
					res.HonbaDeltas[res.Winner] += 3 * honbaTsumo * r.honba
				}
			case res.Kind == "ron" && o == res.From:
				res.HonbaDeltas[o] -= honbaRon * r.honba
				res.HonbaDeltas[res.Winner] += honbaRon * r.honba
			case res.Kind == "tsumo":
				res.HonbaDeltas[o] -= honbaTsumo * r.honba
				res.HonbaDeltas[res.Winner] += honbaTsumo * r.honba
			}
		}
	}
	for s := range r.players {
		if r.players[s].riichi {
			res.StickDeltas[s] -= RiichiStick
		}
	}
	if res.Winner >= 0 {
		res.StickDeltas[res.Winner] += r.deposit // carried sticks included
		r.deposit = 0
	}
	res.Deposit = r.deposit
	for s := range r.players {
		res.Deltas[s] = res.HandDeltas[s] + res.HonbaDeltas[s] + res.StickDeltas[s]
		r.players[s].points = r.start[s] + res.Deltas[s]
	}
	r.claims = nil
	r.result = res
	r.phase = PhaseEnded
}

// firstGoAround reports whether seat has not discarded yet and nobody has
// called, so the first go-around is uninterrupted for it.
func (r *Round) firstGoAround(seat int) bool {
	for s := range r.players {
		if len(r.players[s].melds) > 0 {
			return false
		}
	}
	return len(r.players[seat].river) == 0
}

// canCheat reports whether seat may redraw or summon, uses left aside: its
// own turn on a live-wall draw (not a kan replacement) after the first
// go-around, not in riichi, with a draw left to take.
func (r *Round) canCheat(seat int) bool {
	p := &r.players[seat]
	return seat == r.turn && r.phase == PhaseDiscard && p.drawn != nil && !p.rinshan && !p.riichi &&
		!r.firstGoAround(seat) && r.DrawsLeft() >= 1
}

// canRedraw reports whether seat may redraw: canCheat with a redraw left
// this round.
func (r *Round) canRedraw(seat int) bool {
	return r.canCheat(seat) && r.redraws[seat] < r.seats.RedrawsPerRound[seat]
}

// summonable returns the kinds seat may summon, in kind order: when
// canCheat with a summon left this round, the kinds left in the live wall
// after the next draw's position.
func (r *Round) summonable(seat int) []string {
	if !r.canCheat(seat) || r.summons[seat] >= r.seats.SummonsPerRound[seat] {
		return nil
	}
	var in [tile.NumKinds]bool
	for k := r.draws; k < wall.LiveDraws4-r.kans; k++ {
		t, _ := r.wall.Draw4(k)
		in[t.Kind] = true
	}
	var out []string
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if in[k] {
			out = append(out, k.String())
		}
	}
	return out
}

// summon swaps seat's drawn tile with the first tile of kind s in the live
// wall from the next draw on: the draws taken and left do not change.
func (r *Round) summon(seat int, s string) {
	k := r.draws
	for ; ; k++ {
		if t, _ := r.wall.Draw4(k); t.Kind.String() == s {
			break
		}
	}
	r.wall = r.wall.Swapped(r.draws-1, k)
	t, _ := r.wall.Draw4(r.draws - 1)
	r.players[seat].drawn = &t
	r.summons[seat]++
}

// Summons returns how many times seat has summoned this round.
func (r *Round) Summons(seat int) int { return r.summons[seat] }

// UraIndicators returns the ura-dora indicators under the revealed dora
// indicators, which only the dojo's ura peek shows before the round ends.
func (r *Round) UraIndicators() []tile.Tile { return r.uraIndicators() }

// WaitsOf returns the kinds that complete seat's hand, which only the dojo
// shows for another seat (in riichi) before the round ends.
func (r *Round) WaitsOf(seat int) []tile.Kind { return r.waits(seat) }

// NextDraws returns up to n of seat's next live-wall draws, assuming no
// calls or kans from now on: the next draw goes to the seat after the one
// whose turn it is.
func (r *Round) NextDraws(seat, n int) []tile.Tile {
	var out []tile.Tile
	if r.phase == PhaseEnded {
		return out
	}
	for k := r.draws + (seat-r.turn+3)%4; k < wall.LiveDraws4-r.kans && len(out) < n; k += 4 {
		t, _ := r.wall.Draw4(k)
		out = append(out, t)
	}
	return out
}

// redraw rotates the drawn tile to the end of the live wall and gives seat
// the next draw instead: the draws taken and left do not change.
func (r *Round) redraw(seat int) {
	r.wall = r.wall.Redrawn(r.draws-1, wall.LiveDraws4-r.kans-1)
	t, _ := r.wall.Draw4(r.draws - 1)
	r.players[seat].drawn = &t
	r.redraws[seat]++
}

// Redraws returns how many times seat has redrawn this round.
func (r *Round) Redraws(seat int) int { return r.redraws[seat] }

// Concealed returns a copy of seat's concealed tiles and drawn tile, which
// only the dojo's peek shows before the round ends.
func (r *Round) Concealed(seat int) (hand []tile.Tile, drawn *tile.Tile) {
	p := &r.players[seat]
	if p.drawn != nil {
		d := *p.drawn
		drawn = &d
	}
	return slices.Clone(p.hand), drawn
}

// canKyuushu reports whether seat may declare 九種九牌: its first
// uninterrupted turn, with nine or more different terminals and honors.
func (r *Round) canKyuushu(seat int) bool {
	p := &r.players[seat]
	if seat != r.turn || r.phase != PhaseDiscard || p.drawn == nil || !r.firstGoAround(seat) {
		return false
	}
	c := tile.CountsOf(p.concealed())
	kinds := 0
	for k := tile.Kind(0); k < tile.NumKinds; k++ {
		if k.IsYaochu() && c[k] > 0 {
			kinds++
		}
	}
	return kinds >= 9
}

// abortAfterDiscard returns the abortive draw a passed discard causes:
// 四風連打 (the first four discards are the same wind, no calls) or 四家立直
// (all four seats in riichi); "" if none.
func (r *Round) abortAfterDiscard() string {
	riichi, sameWind := 0, true
	first := r.players[0].river
	for s := range r.players {
		p := &r.players[s]
		if p.riichi {
			riichi++
		}
		sameWind = sameWind && len(p.melds) == 0 && len(p.river) == 1 && len(first) == 1 &&
			p.river[0].Tile.Kind == first[0].Tile.Kind && first[0].Tile.Kind >= tile.East && first[0].Tile.Kind <= tile.North
	}
	switch {
	case riichi == 4:
		return AbortSuucha
	case sameWind:
		return AbortSuufon
	case len(r.kanSeats) == wall.MaxKans && slices.ContainsFunc(r.kanSeats, func(s int) bool { return s != r.kanSeats[0] }):
		return AbortKans
	}
	return ""
}

func (r *Round) exhaustiveDraw() {
	res := &Result{Kind: "draw", Winner: -1, From: -1}
	for s := range r.players {
		res.Tenpai[s] = len(r.waits(s)) > 0
	}
	payNoten(res)
	r.finish(res)
}

// payNoten sets the noten penalty of an exhaustive draw from res.Tenpai:
// the noten seats pay 3000 in all, shared by the tenpai seats.
func payNoten(res *Result) {
	n := 0
	for _, t := range res.Tenpai {
		if t {
			n++
		}
	}
	if n > 0 && n < 4 {
		for s, t := range res.Tenpai {
			if t {
				res.HandDeltas[s] = notenPenalty / n
			} else {
				res.HandDeltas[s] = -notenPenalty / (4 - n)
			}
		}
	}
}
