package match

import (
	"fmt"
	"hash/fnv"
	"slices"
	"strconv"

	"github.com/litencatt/mhj-dojo/internal/game"
)

// ActionNext deals the next round of a game; it is not a round move.
const ActionNext game.ActionType = "next"

// Save is what rebuilds a game (Store.Restore): the CPU players decide
// deterministically, so the seed, the options and the human's moves replay
// it exactly. The WebAssembly build hands it to the page, which keeps it
// across a reload (docs/api.md).
type Save struct {
	// Seed is the game's seed, also while the state still hides it.
	Seed        int64         `json:"seed"`
	SeedKnown   bool          `json:"seed_known"`
	Length      string        `json:"length"`
	FirstDealer string        `json:"first_dealer"`
	CPU         string        `json:"cpu"`
	Actions     []SavedAction `json:"actions"`
	// Check is a digest of every round's moves once the actions are played
	// (Match.check): a save replayed by an engine whose CPU plays another
	// way does not match it. A save without one is not checked.
	Check string `json:"check,omitempty"`
}

// SavedAction is one of the human's moves (the body of POST
// /api/games/{id}/action), or ActionNext.
type SavedAction struct {
	Type  game.ActionType `json:"type"`
	Tile  string          `json:"tile,omitempty"`
	Tiles []string        `json:"tiles,omitempty"`
}

// Save returns what rebuilds the game as it is now.
func (m *Match) Save() Save {
	m.mu.Lock()
	defer m.mu.Unlock()
	actions := slices.Clone(m.actions)
	if actions == nil {
		actions = []SavedAction{}
	}
	return Save{
		Seed:        m.game.H.Seed(),
		SeedKnown:   m.seedKnown,
		Length:      m.opts.Length,
		FirstDealer: m.opts.FirstDealer,
		CPU:         m.opts.CPU,
		Actions:     actions,
		Check:       m.check(),
	}
}

// check returns an FNV-1a digest, in hex, of the action logs of every round
// so far, CPU moves and skips included. Callers hold m.mu.
func (m *Match) check() string {
	h := fnv.New64a()
	for _, log := range m.game.H.Logs() {
		for _, a := range log {
			fmt.Fprintf(h, "%d %s %s %v;", a.Seat, a.Type, a.Tile, a.Tiles)
		}
		h.Write([]byte{'|'})
	}
	return strconv.FormatUint(h.Sum64(), 16)
}

// Restore rebuilds a saved game under a new id by replaying its moves. The
// seed stays hidden in its state as in the original unless s.SeedKnown.
// Errors wrap game.ErrInvalid or game.ErrConflict; nothing is stored then.
func (st *Store) Restore(s Save) (*Match, error) {
	o, rules, err := Options{Length: s.Length, FirstDealer: s.FirstDealer, CPU: s.CPU}.normalize()
	if err != nil {
		return nil, err
	}
	m := newMatch(deal(s.Seed, rules, o), o, s.SeedKnown)
	// Nobody else can see m yet; the lock is for act and next's contract.
	m.mu.Lock()
	defer m.mu.Unlock()
	// Only the last round's history shows in the state: up to the last
	// next, the rounds skip its analysis, and that next's round then starts
	// over with it.
	lastNext := -1
	for i, a := range s.Actions {
		if a.Type == ActionNext {
			lastNext = i
		}
	}
	if lastNext >= 0 {
		m.game.OnHumanDiscard, m.replaying = nil, true
	}
	for i, a := range s.Actions {
		if a.Type == ActionNext {
			err = m.next()
		} else {
			err = m.act(game.Action{Type: a.Type, Tile: a.Tile, Tiles: a.Tiles})
		}
		if err != nil {
			return nil, fmt.Errorf("action %d (%s): %w", i, a.Type, err)
		}
		if i == lastNext {
			m.game.OnHumanDiscard, m.replaying = m.recordHand, false
			m.startRound()
		}
	}
	if s.Check != "" && s.Check != m.check() {
		return nil, fmt.Errorf("%w: save does not match this engine", game.ErrConflict)
	}
	m.id = st.games.Add(m)
	return m, nil
}
