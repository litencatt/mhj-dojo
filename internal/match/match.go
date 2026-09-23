// Package match runs games against CPU players for the HTTP API: a game.Game
// with seat 0 as the human, the human's per-yaku analysis, and the JSON
// state of docs/api.md.
package match

import (
	"errors"
	"fmt"
	"log"
	mrand "math/rand/v2"
	"sync"

	"github.com/litencatt/mhj2/internal/cpu"
	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/session"
	"github.com/litencatt/mhj2/internal/store"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

// ErrNotFound is returned for an unknown game id.
var ErrNotFound = errors.New("not found")

const (
	// MaxGames bounds memory; the oldest game is evicted beyond it.
	MaxGames = 256
	// Human is the human player's seat.
	Human = 0
	// memoLimit resets the analyzer's memo when it grows past this many tables.
	memoLimit = 200_000
)

// Store holds games in memory.
type Store struct {
	games *store.Store[*Match]
	// DefaultSeed, when set, is used for games created without a seed.
	DefaultSeed *int64
}

// NewStore returns an empty store.
func NewStore() *Store { return &Store{games: store.New[*Match](MaxGames)} }

// Create deals a game. A nil seed picks the default or a random seed.
func (st *Store) Create(seed *int64) *Match {
	var s int64
	switch {
	case seed != nil:
		s = *seed
	case st.DefaultSeed != nil:
		s = *st.DefaultSeed
	default:
		// Hidden until the end; 2^53 keeps it exact in JSON while making a
		// search from the dealt tiles impractical (2^32 takes minutes).
		s = mrand.Int64N(1 << 53)
	}
	r := game.New(s)
	m := &Match{
		analyzer:  yakushanten.NewAnalyzerFor(yakushanten.Winds{Round: tile.East, Seat: r.SeatWind(Human)}),
		history:   map[int]session.HistoryEntry{},
		seedKnown: seed != nil || st.DefaultSeed != nil,
	}
	m.game = game.Start(r, Human, cpu.New())
	m.game.OnHumanDiscard = m.recordHand
	m.recordHand()
	m.id = st.games.Add(m)
	return m
}

// Get returns a game by id.
func (st *Store) Get(id string) (*Match, error) {
	m, ok := st.games.Get(id)
	if !ok {
		return nil, fmt.Errorf("%w: game %q", ErrNotFound, id)
	}
	return m, nil
}

// Match is one game. Methods are safe for concurrent use.
type Match struct {
	mu       sync.Mutex
	id       string
	game     *game.Game
	analyzer *yakushanten.Analyzer
	// since is the log length before the human's last move: the events
	// reported are the moves after it.
	since int
	// history holds the human's per-yaku shanten after each own discard,
	// keyed by the number of discards so far.
	history map[int]session.HistoryEntry
	// seedKnown is set when the player chose the seed. A random seed is
	// revealed only at the end: it rebuilds the whole wall.
	seedKnown bool
}

// ID returns the game id.
func (m *Match) ID() string { return m.id }

// State returns the human's view of the game.
func (m *Match) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state()
}

// Act applies the human's move and plays the CPUs up to the human's next
// decision. Errors wrap game.ErrInvalid or game.ErrConflict.
func (m *Match) Act(a game.Action) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	before := len(m.game.Round.Log())
	fallbacks := m.game.Fallbacks
	if err := m.game.Act(a); err != nil {
		return State{}, err
	}
	if m.game.Fallbacks > fallbacks {
		// A CPU bug, not a rule outcome: make it visible in the server log.
		log.Printf("match %s: %d illegal CPU move(s) replaced", m.id, m.game.Fallbacks-fallbacks)
	}
	m.since = before
	return m.state(), nil
}

func (m *Match) analyze(c tile.Counts) []yakushanten.Result {
	if m.analyzer.MemoSize() > memoLimit {
		m.analyzer = yakushanten.NewAnalyzerFor(yakushanten.Winds{Round: tile.East, Seat: m.game.Round.SeatWind(Human)})
	}
	return m.analyzer.Analyze(c)
}

// han returns a row's closed-hand han for the human's winds.
func (m *Match) han(key string) int {
	return yaku.HanFor(key, tile.East, m.game.Round.SeatWind(Human))
}
