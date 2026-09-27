// Package match runs games against CPU players for the HTTP API: a game.Game
// with seat 0 as the human, the human's per-yaku analysis, and the JSON
// state of docs/api.md.
package match

import (
	"errors"
	"fmt"
	"slices"
	"sync"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/store"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// ErrNotFound is returned for an unknown game id.
var ErrNotFound = errors.New("not found")

const (
	// MaxGames bounds memory; the least recently used game is evicted beyond it.
	MaxGames = 256
	// Human is the human player's seat.
	Human = 0
)

// Store holds games in memory.
type Store struct {
	games *store.Store[*Match]
	// DefaultSeed, when set, is used for games created without a seed.
	DefaultSeed *int64
}

// NewStore returns an empty store that keeps at most MaxGames games.
func NewStore() *Store { return NewStoreWithMax(MaxGames) }

// NewStoreWithMax returns an empty store that keeps at most max games,
// evicting the least recently used one beyond that. The wasm build
// (cmd/mhj-dojo-wasm) uses a much smaller max than MaxGames: it runs in a
// browser tab's memory (see docs/api.md "Memory").
func NewStoreWithMax(max int) *Store { return &Store{games: store.New[*Match](max)} }

// Lengths of a game.
const (
	Tonpuu  = "tonpuu"  // 東風戦: the East round only
	Hanchan = "hanchan" // 半荘戦: East and South
)

// Choices of the first dealer (起家).
const (
	DealerRandom = "random" // the master seed mod 4
	DealerYou    = "you"    // the human
)

// Options choose a game; "" picks the default (the first of each list).
type Options struct {
	Length      string // Tonpuu or Hanchan
	FirstDealer string // DealerRandom or DealerYou
	CPU         string // cpu.Normal or cpu.Weak
}

// Create deals a game with the given options. A nil seed picks the default
// or a random seed.
func (st *Store) Create(seed *int64, o Options) (*Match, error) {
	o, rules, err := o.normalize()
	if err != nil {
		return nil, err
	}
	// A random seed is hidden until the game ends: it rebuilds every wall.
	// 2^53 keeps it exact in JSON while making a search from the dealt tiles
	// impractical (2^32 would take minutes).
	s := wall.PickSeed(seed, st.DefaultSeed, 1<<53)
	m := newMatch(deal(s, rules, o), o, seed != nil || st.DefaultSeed != nil)
	m.id = st.games.Add(m)
	return m, nil
}

// normalize fills in the defaults of o and checks its values, returning the
// rules of its length.
func (o Options) normalize() (Options, game.Rules, error) {
	var rules game.Rules
	switch o.Length {
	case "", Tonpuu:
		o.Length, rules = Tonpuu, game.Tonpuu
	case Hanchan:
		rules = game.HanchanRule
	default:
		return o, rules, fmt.Errorf("%w: length must be %q or %q", game.ErrInvalid, Tonpuu, Hanchan)
	}
	switch o.FirstDealer {
	case "":
		o.FirstDealer = DealerRandom
	case DealerRandom, DealerYou:
	default:
		return o, rules, fmt.Errorf("%w: first_dealer must be %q or %q", game.ErrInvalid, DealerRandom, DealerYou)
	}
	switch o.CPU {
	case "":
		o.CPU = cpu.Normal
	case cpu.Normal, cpu.Weak:
	default:
		return o, rules, fmt.Errorf("%w: cpu must be %q or %q", game.ErrInvalid, cpu.Normal, cpu.Weak)
	}
	return o, rules, nil
}

// deal sets up the rounds of a game from its seed and filled-in options.
func deal(seed int64, rules game.Rules, o Options) *game.Hanchan {
	if o.FirstDealer == DealerYou {
		return game.NewHanchanFrom(seed, rules, Human)
	}
	return game.NewHanchan(seed, rules)
}

// newMatch starts a match and plays the CPUs up to the human's first
// decision. The options must be filled in (see Create).
func newMatch(h *game.Hanchan, o Options, seedKnown bool) *Match {
	m := &Match{opts: o, seedKnown: seedKnown}
	p := cpu.New()
	if o.CPU == cpu.Weak {
		p = cpu.NewWeak()
	}
	m.game = game.StartHanchan(h, p)
	m.game.OnHumanDiscard = m.recordHand
	m.startRound()
	return m
}

// startRound resets what is kept per round: the analyzer's rows (they
// follow the round's winds; its memo carries over, see ForWinds), the events
// and the history.
func (m *Match) startRound() {
	if m.replaying {
		return
	}
	if w := m.game.Round.Winds(Human); m.analyzer == nil {
		m.analyzer = yakushanten.NewAnalyzerFor(w)
	} else {
		m.analyzer = m.analyzer.ForWinds(w)
	}
	m.since, m.shownKanDora = 0, 0
	m.history = nil
	m.recordHand()
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
	// since is the number of round events before the human's last move:
	// the events reported are the moves after it.
	since int
	// shownKanDora counts the kan dora indicators turned over before the
	// human's last move, which the human has seen: the events reported
	// carry only those turned over since (reportEvents).
	shownKanDora int
	// history holds the human's per-yaku shanten at the start and after
	// each own discard, in order (entry i = after i discards).
	history []apiview.HistoryEntry
	// seedKnown is set when the player chose the seed. A random seed is
	// revealed only when the game ends: it rebuilds every wall.
	seedKnown bool
	opts      Options
	// rounds sums up the finished rounds.
	rounds []RoundSummary
	// actions are the human's moves and Nexts that succeeded, in order: with
	// the seed and options they replay the game (Save, Store.Restore).
	actions []SavedAction
	// replaying, set while Store.Restore replays the rounds before the
	// last one, has startRound leave out the analysis: those rounds'
	// history is dropped at the next anyway.
	replaying bool
	// checked is check's hash of the first checkedRounds rounds' logs
	// (none while checkedRounds is 0).
	checked       fnv1a
	checkedRounds int
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
	if err := m.act(a); err != nil {
		return State{}, err
	}
	return m.state(), nil
}

// act is Act without the state, which a replay (Store.Restore) needs only
// at its end. Callers hold m.mu.
func (m *Match) act(a game.Action) error {
	before, shown := len(m.game.Round.Events()), m.game.Round.KanDora()
	if err := m.game.Act(a); err != nil {
		return err
	}
	m.since, m.shownKanDora = before, shown
	m.actions = append(m.actions, SavedAction{Type: a.Type, Tile: a.Tile, Tiles: slices.Clone(a.Tiles)})
	return nil
}

// Next deals the next round once the current one has ended and plays the
// CPUs up to the human's first decision in it.
func (m *Match) Next() (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.next(); err != nil {
		return State{}, err
	}
	return m.state(), nil
}

// next is Next without the state. Callers hold m.mu.
func (m *Match) next() error {
	ended := m.summary()
	if err := m.game.Next(); err != nil {
		return err
	}
	m.rounds = append(m.rounds, *ended)
	m.actions = append(m.actions, SavedAction{Type: ActionNext})
	m.startRound()
	return nil
}

func (m *Match) analyze(c tile.Counts, melds []yaku.Meld) []yakushanten.Result {
	return m.analyzer.AnalyzeWith(c, melds)
}

// combos returns the yaku combos of the hand c with melds, whose rows are res.
func (m *Match) combos(c tile.Counts, melds []yaku.Meld, res []yakushanten.Result) []yakushanten.Combo {
	return m.analyzer.Combos(c, melds, res)
}

// hanFor returns the rows' han for the human's winds, lowered for an open
// hand (kuisagari).
func (m *Match) hanFor(melds []yaku.Meld) func(key string) int {
	w := m.game.Round.Winds(Human)
	open := slices.ContainsFunc(melds, func(x yaku.Meld) bool { return x.Open })
	return func(key string) int { return yaku.HanOpenFor(key, w, open) }
}
