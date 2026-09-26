package session

// Move is one step of Replay: from node Parent, discard Tile, or declare
// tsumo when Tile is nil.
type Move struct {
	Parent int     `json:"parent"`
	Tile   *string `json:"tile,omitempty"`
}

// Replay applies moves in order, each as a Goto to its Parent followed by a
// Discard or Tsumo, then moves to node current and returns the state, the
// same as making those calls one by one. It is much cheaper, for rebuilding
// a session from its moves (the WebAssembly build does after a page
// reload): it builds the state only once, at the end, and leaves each
// discard's review to be computed when its node is shown.
func (s *Session) Replay(moves []Move, current int) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range moves {
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
	}
	if err := s.goTo(current); err != nil {
		return State{}, err
	}
	return s.state(), nil
}
