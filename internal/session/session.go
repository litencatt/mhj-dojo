// Package session runs solo practice games: a seeded wall, a tree of discard
// choices that can be revisited and branched, and the per-node analysis.
package session

import (
	"errors"
	"fmt"
	"sync"

	"github.com/litencatt/mhj2/internal/apiview"
	"github.com/litencatt/mhj2/internal/store"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
	"github.com/litencatt/mhj2/internal/yaku"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

// Errors returned by sessions; the server maps them to HTTP statuses.
var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid request")
	ErrConflict = errors.New("not allowed in the current state")
	// ErrTreeFull is returned instead of ErrConflict when a session's tree
	// is already at MaxNodes: the current node itself is fine to act on, so
	// this isn't a state conflict the client could resolve by re-fetching
	// (the server maps it to 422, not 409; docs/api.md).
	ErrTreeFull = errors.New("tree full")
)

// Node statuses.
const (
	StatusPlaying   = "playing"
	StatusTsumo     = "tsumo"
	StatusExhausted = "exhausted"
)

const (
	// DefaultMaxTurns is the default number of discards before the game ends.
	DefaultMaxTurns = 18
	// MaxSessions bounds memory; the oldest session is evicted beyond it.
	MaxSessions = 256
	// MaxNodes bounds a session's tree (every state carries the whole tree).
	MaxNodes = 2000
	// memoLimit resets an analyzer's memo when it grows past this many tables.
	memoLimit = 200_000
)

// maxNodes is MaxNodes, lowered by tests.
var maxNodes = MaxNodes

// Practice plays East round, East seat.
var winds = yaku.EastEast

// Store holds sessions in memory.
type Store struct {
	sessions *store.Store[*Session]
	// DefaultSeed, when set, is used for sessions created without a seed.
	DefaultSeed *int64
}

// NewStore returns an empty store.
func NewStore() *Store { return &Store{sessions: store.New[*Session](MaxSessions)} }

// Create starts a session. A nil seed picks the default or a random seed;
// maxTurns 0 means DefaultMaxTurns.
func (st *Store) Create(seed *int64, maxTurns int) (*Session, error) {
	// Practice seeds are always shown, so a small range is fine.
	return st.CreateWithWall(wall.New(wall.PickSeed(seed, st.DefaultSeed, 1<<32)), maxTurns)
}

// CreateWithWall starts a session on a given wall (used by tests).
func (st *Store) CreateWithWall(w *wall.Wall, maxTurns int) (*Session, error) {
	if maxTurns == 0 {
		maxTurns = DefaultMaxTurns
	}
	if maxTurns < 1 || maxTurns > wall.LiveDraws {
		return nil, fmt.Errorf("%w: max_turns must be between 1 and %d", ErrInvalid, wall.LiveDraws)
	}
	s := &Session{
		wall:     w,
		maxTurns: maxTurns,
		analyzer: yakushanten.NewAnalyzer(),
	}
	s.addNode(&node{parent: -1, hand: w.Hand()})
	s.id = st.sessions.Add(s)
	return s, nil
}

// Get returns a session by id.
func (st *Store) Get(id string) (*Session, error) {
	s, ok := st.sessions.Get(id)
	if !ok {
		return nil, fmt.Errorf("%w: session %q", ErrNotFound, id)
	}
	return s, nil
}

// Session is one solo game with its branch tree. Methods are safe for
// concurrent use.
type Session struct {
	mu       sync.Mutex
	id       string
	wall     *wall.Wall
	maxTurns int
	nodes    []*node
	current  int
	analyzer *yakushanten.Analyzer
	// pathCache holds the ids of the nodes currently holding a full
	// per-yaku analysis (the current node and its history path from the
	// last state() call); see pruneAnalysisCache.
	pathCache []int
}

type node struct {
	id, parent int
	turn       int
	hand       []tile.Tile // 13 tiles, sorted
	draw       *tile.Tile  // tile drawn right before this node
	discard    *tile.Tile  // tile discarded to reach this node
	status     string
	children   map[string]int // discard string (or "tsumo") -> node id

	// analysis and byDiscard are the full per-yaku analysis (all rows,
	// with ukeire) and per-discard preview. They are only ever needed for
	// the current node (both) and its history path (analysis only), so
	// pruneAnalysisCache clears them once a node falls off that path.
	analysis  []yakushanten.Result
	byDiscard map[tile.Kind][]yakushanten.Result
	// normalShanten is just the normal-form row, needed for every node in
	// the tree view (state()'s Tree field). Unlike analysis/byDiscard
	// above it is tiny (one int) and cheap to recompute, so it is cached
	// forever instead of being pruned with them.
	normalShanten     *int
	normalShantenDone bool
	winRows           map[string]int // tsumo nodes: row shanten on the 14 winning tiles
	win               *Win
}

// ID returns the session id.
func (s *Session) ID() string { return s.id }

func (s *Session) addNode(n *node) *node {
	n.id = len(s.nodes)
	n.children = map[string]int{}
	if n.status == "" {
		n.status = StatusPlaying
		if n.turn >= s.maxTurns {
			n.status = StatusExhausted
		}
	}
	s.nodes = append(s.nodes, n)
	s.current = n.id
	return n
}

// roomForNode fails once the tree has reached maxNodes.
func (s *Session) roomForNode() error {
	if len(s.nodes) >= maxNodes {
		return fmt.Errorf("%w: the session has %d nodes; start a new session", ErrTreeFull, maxNodes)
	}
	return nil
}

// drawn returns the pending draw at a playing node.
func (s *Session) drawn(n *node) (tile.Tile, bool) {
	if n.status != StatusPlaying {
		return tile.Tile{}, false
	}
	return s.wall.Draw(n.turn)
}

// State returns the view of the current node.
func (s *Session) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state()
}

// Discard discards an exact tile (red distinguished) from hand+drawn.
func (s *Session) Discard(t string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.nodes[s.current]
	d, ok := s.drawn(cur)
	if !ok {
		return State{}, fmt.Errorf("%w: node %d is %s", ErrConflict, cur.id, cur.status)
	}
	tiles := append(append([]tile.Tile{}, cur.hand...), d)
	idx := -1
	for i, x := range tiles {
		if x.String() == t {
			idx = i
			break
		}
	}
	if idx < 0 {
		return State{}, fmt.Errorf("%w: tile %q is not in hand or drawn", ErrInvalid, t)
	}
	if id, ok := cur.children[t]; ok {
		s.current = id
		return s.state(), nil
	}
	if err := s.roomForNode(); err != nil {
		return State{}, err
	}
	disc := tiles[idx]
	hand := append(tiles[:idx:idx], tiles[idx+1:]...)
	tile.Sort(hand)
	child := s.addNode(&node{parent: cur.id, turn: cur.turn + 1, hand: hand, draw: &d, discard: &disc})
	cur.children[t] = child.id
	return s.state(), nil
}

// Tsumo declares a win with the pending draw.
func (s *Session) Tsumo() (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur := s.nodes[s.current]
	if id, ok := cur.children[StatusTsumo]; ok {
		s.current = id
		return s.state(), nil
	}
	d, ok := s.drawn(cur)
	if !ok {
		return State{}, fmt.Errorf("%w: node %d is %s", ErrConflict, cur.id, cur.status)
	}
	if err := s.roomForNode(); err != nil {
		return State{}, err
	}
	tiles := append(append([]tile.Tile{}, cur.hand...), d)
	tile.Sort(tiles)
	res, ok := yaku.Evaluate(tiles, yaku.Context{
		WinTile: d.Kind, Winds: winds, DoraIndicators: s.wall.DoraIndicators(),
	})
	if !ok {
		return State{}, fmt.Errorf("%w: hand is not complete", ErrConflict)
	}
	child := s.addNode(&node{
		parent: cur.id, turn: cur.turn, hand: cur.hand, draw: &d, status: StatusTsumo,
		win: &Win{Tiles: tile.Strings(tiles), Yaku: res.Yaku, Dora: res.Dora, HanTotal: res.HanTotal},
	})
	child.winRows = s.winRows(tile.CountsOf(tiles), res)
	cur.children[StatusTsumo] = child.id
	return s.state(), nil
}

// Goto moves the current node.
func (s *Session) Goto(id int) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id < 0 || id >= len(s.nodes) {
		return State{}, fmt.Errorf("%w: node %d", ErrNotFound, id)
	}
	s.current = id
	return s.state(), nil
}

// resetAnalyzerIfFull recycles the shared analyzer once its suit-table memo
// has grown past memoLimit.
func (s *Session) resetAnalyzerIfFull() {
	if s.analyzer.MemoSize() > memoLimit {
		s.analyzer = yakushanten.NewAnalyzer()
	}
}

func (s *Session) analyze(c tile.Counts) []yakushanten.Result {
	s.resetAnalyzerIfFull()
	return s.analyzer.Analyze(c)
}

func (s *Session) nodeAnalysis(n *node) []yakushanten.Result {
	if n.analysis == nil {
		n.analysis = s.analyze(tile.CountsOf(n.hand))
	}
	return n.analysis
}

// nodeNormalShanten returns just the normal-form shanten (nil = complete
// hand impossible), for the tree view. It is cached on the node forever
// (unlike analysis/byDiscard) since it is tiny.
func (s *Session) nodeNormalShanten(n *node) *int {
	if !n.normalShantenDone {
		s.resetAnalyzerIfFull()
		n.normalShanten = apiview.ShantenOf(s.analyzer.NormalShanten(tile.CountsOf(n.hand)))
		n.normalShantenDone = true
	}
	return n.normalShanten
}

// pruneAnalysisCache frees the full per-yaku analysis of any node that held
// one after the previous state() call but is not on the given (new) path,
// and the per-discard preview of any such node other than cur — state()
// only ever reads a node's analysis if it's on the current path, and its
// byDiscard if it's the current node. Nodes newly added to the path just
// keep whatever nodeAnalysis/byDiscard already cached for them this call.
func (s *Session) pruneAnalysisCache(path []*node, cur *node) {
	keep := make(map[int]bool, len(path))
	next := make([]int, len(path))
	for i, n := range path {
		keep[n.id] = true
		next[i] = n.id
	}
	for _, id := range s.pathCache {
		n := s.nodes[id]
		if !keep[id] {
			n.analysis = nil
		}
		if id != cur.id {
			n.byDiscard = nil
		}
	}
	s.pathCache = next
}

// winRows computes each row's shanten on the 14 winning tiles: -1 when the
// win satisfies the row. Pinfu counts as satisfied only if the win scored it.
func (s *Session) winRows(c tile.Counts, res yaku.Win) map[string]int {
	rows := s.analyze(c)
	scored := map[string]bool{}
	for _, y := range res.Yaku {
		scored[y.Key] = true
	}
	out := map[string]int{}
	for _, r := range rows {
		v := r.Shanten
		if r.Key == "pinfu" {
			v = max(v, 0)
			if scored["pinfu"] {
				v = -1
			}
		}
		out[r.Key] = v
	}
	return out
}
