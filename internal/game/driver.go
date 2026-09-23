package game

import (
	"fmt"
	"log"
	"slices"
)

// Decider chooses a CPU seat's move from what that seat can see.
type Decider interface {
	Decide(v View, legal Legal) Action
}

// Game is a round between one human seat and CPU seats. After every human
// move it plays the CPU seats until the human must decide again or the
// round ends. Methods are not safe for concurrent use.
type Game struct {
	Round *Round
	Human int
	cpu   Decider
	// OnHumanDiscard, when set, runs after each of the human's discards,
	// including the ones played for them in riichi.
	OnHumanDiscard func()
	// Fallbacks counts CPU moves that were illegal and replaced; it must
	// stay 0 (the self-play tests check it).
	Fallbacks int
}

// NewGame deals a round from seed with seat 0 as the human and plays the
// CPU seats up to the human's first decision.
func NewGame(seed int64, cpu Decider) *Game {
	return Start(New(seed), 0, cpu)
}

// Start wraps a dealt round (used by tests) and plays up to the human.
func Start(r *Round, human int, cpu Decider) *Game {
	g := &Game{Round: r, Human: human, cpu: cpu}
	g.run()
	return g
}

// Act applies the human's move, then plays the CPU seats.
func (g *Game) Act(a Action) error {
	a.Seat = g.Human
	if err := g.Round.Apply(a); err != nil {
		return err
	}
	if a.Type == Discard || a.Type == Riichi {
		g.humanDiscarded()
	}
	g.run()
	return nil
}

// Events returns the actions applied since index from (use the previous
// length to get only the new ones).
func (g *Game) Events(from int) []Action {
	log := g.Round.Log()
	if from < 0 || from > len(log) {
		from = len(log)
	}
	return log[from:]
}

// run plays until the human has a real choice or the round ends. The
// human's forced moves (tsumogiri in riichi without a tsumo) are played too.
func (g *Game) run() {
	r := g.Round
	for {
		seat := r.Actor()
		if seat < 0 {
			return
		}
		legal := r.LegalFor(seat)
		if seat == g.Human {
			if !r.players[seat].riichi || legal.Tsumo || r.phase != PhaseDiscard {
				return
			}
			g.mustApply(Action{Seat: seat, Type: Discard, Tile: legal.Discards[0]})
			g.humanDiscarded()
			continue
		}
		a := g.cpu.Decide(r.ViewFor(seat), legal)
		a.Seat = seat
		if err := r.Apply(a); err != nil {
			// An illegal CPU move must not stall a live game: replace it with
			// a legal one, count it and log it (a CPU bug, not a rule outcome).
			g.Fallbacks++
			log.Printf("game: seat %d illegal CPU move %+v (%v); replaced", seat, a, err)
			g.mustApply(fallback(seat, legal))
		}
	}
}

func (g *Game) humanDiscarded() {
	if g.OnHumanDiscard != nil {
		g.OnHumanDiscard()
	}
}

func fallback(seat int, l Legal) Action {
	if l.Skip {
		return Action{Seat: seat, Type: Skip}
	}
	return Action{Seat: seat, Type: Discard, Tile: l.Discards[len(l.Discards)-1]}
}

func (g *Game) mustApply(a Action) {
	if err := g.Round.Apply(a); err != nil {
		panic(fmt.Sprintf("game: forced move %+v failed: %v", a, err))
	}
}

// Tsumogiri is a trivial Decider: it wins whenever it can and otherwise
// discards the drawn tile. Used by tests and as the fallback CPU.
type Tsumogiri struct{}

// Decide implements Decider.
func (Tsumogiri) Decide(v View, l Legal) Action {
	switch {
	case l.Tsumo:
		return Action{Type: Tsumo}
	case l.Ron:
		return Action{Type: Ron}
	case l.Skip:
		return Action{Type: Skip}
	}
	d := v.Seats[v.Viewer].Drawn
	if d != nil && slices.Contains(l.Discards, d.String()) {
		return Action{Type: Discard, Tile: d.String()}
	}
	return Action{Type: Discard, Tile: l.Discards[0]}
}
