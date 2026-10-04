package session

import "fmt"

// Move is one step of Replay: from node Parent, discard Tile, or declare
// tsumo when Tile is nil.
type Move struct {
	Parent int     `json:"parent"`
	Tile   *string `json:"tile,omitempty"`
}

// Replay applies moves in order, each as a Goto to its Parent followed by a
// Discard or Tsumo that must make the next node (ErrInvalid otherwise), then
// moves to node current and returns its state as v picks it, the
// same as making those calls one by one. It is much cheaper, for rebuilding
// a session from its moves (the WebAssembly build does after a page
// reload): it builds the state only once, at the end, and leaves each
// discard's review to be computed when its node is shown.
func (s *Session) Replay(moves []Move, current int, v View) (State, error) {
	for i, m := range moves {
		next := len(s.nodes)
		if err := s.goTo(m.Parent); err != nil {
			return State{}, err
		}
		var err error
		if m.Tile == nil {
			err = s.tsumo(nil)
		} else {
			err = s.discard(*m.Tile, nil, false)
		}
		if err != nil {
			return State{}, err
		}
		if len(s.nodes) != next+1 {
			// A move repeating an existing one: the moves are not a tree
			// as a session records it (tampered with, or out of order).
			return State{}, fmt.Errorf("%w: move %d does not make node %d", ErrInvalid, i, next)
		}
	}
	if err := s.goTo(current); err != nil {
		return State{}, err
	}
	return s.state(v), nil
}
