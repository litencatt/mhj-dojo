// Package session runs solo practice games: a seeded wall, a tree of discard
// choices that can be revisited and branched, and the per-node analysis.
package session

import (
	"errors"
	"fmt"
	"math"

	"github.com/litencatt/mhj-dojo/internal/advice"
	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/store"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// Errors returned by sessions; apicall maps them to HTTP status codes.
var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid request")
	ErrConflict = errors.New("not allowed in the current state")
	// ErrTreeFull is returned instead of ErrConflict when a session's tree
	// is already at MaxNodes: the current node itself is fine to act on, so
	// this isn't a state conflict (apicall maps it to 422, not 409;
	// docs/api.md).
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
	// MaxNodes bounds a session's tree.
	MaxNodes = 2000
)

// maxNodes is MaxNodes, lowered by tests.
var maxNodes = MaxNodes

// Practice plays East round, East seat.
var winds = yaku.EastEast

// Store holds sessions in memory.
type Store struct {
	sessions *store.Store[*Session]
}

// NewStore returns an empty store that keeps at most max sessions, evicting
// the least recently used one beyond that. The wasm build runs in a browser
// tab's memory, so max is small (see docs/api.md "Memory"). Stores and
// sessions are not safe for concurrent use: wasm is single-threaded.
func NewStore(max int) *Store { return &Store{sessions: store.New[*Session](max)} }

// Create starts a session. A nil seed picks a random seed;
// maxTurns 0 means DefaultMaxTurns.
func (st *Store) Create(seed *int64, maxTurns int) (*Session, error) {
	// Practice seeds are always shown, so a small range is fine.
	return st.CreateWithWall(wall.New(wall.PickSeed(seed, 1<<32)), maxTurns)
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

// Delete removes a session, if it exists.
func (st *Store) Delete(id string) { st.sessions.Delete(id) }

// Get returns a session by id.
func (st *Store) Get(id string) (*Session, error) {
	s, ok := st.sessions.Get(id)
	if !ok {
		return nil, fmt.Errorf("%w: session %q", ErrNotFound, id)
	}
	return s, nil
}

// Session is one solo game with its branch tree.
type Session struct {
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
	// combos and combosByDiscard are the yaku combos of the hand and of
	// each discard; like byDiscard they are kept for the current node only.
	combos          []yakushanten.Combo
	combosByDiscard map[tile.Kind][]yakushanten.Combo
	// advice is the current node's discard advice, pruned with byDiscard;
	// review compares the discard that led to this node with the best one
	// at its parent and, being small, is kept forever. Replay, and a
	// discard made without the advice (View.NoAdvice), leave it to be
	// computed when the node is shown with the advice (reviewPending; see
	// nodeReview).
	advice        *advice.Advice
	review        *advice.Review
	reviewPending bool
	// normalShanten is just the normal-form row, needed for every node in
	// the tree view (state()'s Tree field). Unlike analysis/byDiscard
	// above it is tiny (one int) and cheap to recompute, so it is cached
	// forever instead of being pruned with them.
	normalShanten     *int
	normalShantenDone bool
	// rowShanten is each row's shanten (noShanten: impossible), in the
	// analyzer's row order, for the history of every path the node is on.
	// Like normalShanten it is small and kept forever, so a path whose
	// nodes' analysis was pruned does not recompute it.
	rowShanten []int8
	winRows    map[string]int // tsumo nodes: row shanten on the 14 winning tiles
	win        *Win
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
func (s *Session) State(v View) State {
	return s.state(v)
}

// Discard discards an exact tile (red distinguished) from hand+drawn.
// expectedNode, when non-nil, must match the current node: it lets a client
// detect that another tab moved the session on first (ErrConflict) instead
// of silently acting on whatever node happens to be current. A new node's
// review of the discard is computed now unless v leaves the advice out.
func (s *Session) Discard(t string, expectedNode *int, v View) (State, error) {
	if err := s.discard(t, expectedNode, !v.NoAdvice); err != nil {
		return State{}, err
	}
	return s.state(v), nil
}

// discard is Discard without the state. Unless review
// is set, the new node's review is left for nodeReview to compute.
func (s *Session) discard(t string, expectedNode *int, review bool) error {
	if err := s.checkExpectedNode(expectedNode); err != nil {
		return err
	}
	cur := s.nodes[s.current]
	d, ok := s.drawn(cur)
	if !ok {
		return fmt.Errorf("%w: node %d is %s", ErrConflict, cur.id, cur.status)
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
		return fmt.Errorf("%w: tile %q is not in hand or drawn", ErrInvalid, t)
	}
	if id, ok := cur.children[t]; ok {
		s.current = id
		s.seedAnalysis(s.nodes[id], cur)
		return nil
	}
	if err := s.roomForNode(); err != nil {
		return err
	}
	disc := tiles[idx]
	n := &node{parent: cur.id, turn: cur.turn + 1, draw: &d, discard: &disc, reviewPending: !review}
	if review {
		n.review = s.nodeAdvice(cur, s.path(cur)).Review(disc)
	}
	hand := append(tiles[:idx:idx], tiles[idx+1:]...)
	tile.Sort(hand)
	n.hand = hand
	child := s.addNode(n)
	cur.children[t] = child.id
	s.seedAnalysis(child, cur)
	return nil
}

// seedAnalysis gives n, reached from its parent cur by a discard, the
// analysis and combos of its hand that cur's per-discard preview already
// holds, if n has none. n is then in pathCache for pruneAnalysisCache.
func (s *Session) seedAnalysis(n, cur *node) {
	k := n.discard.Kind
	res, ok := cur.byDiscard[k]
	if !ok || n.analysis != nil {
		return
	}
	n.analysis = res
	if n.rowShanten == nil {
		n.rowShanten = compactShanten(res)
	}
	if combos, ok := cur.combosByDiscard[k]; ok && n.combos == nil {
		n.combos = append([]yakushanten.Combo{}, combos...)
	}
	s.pathCache = append(s.pathCache, n.id)
}

// Tsumo declares a win with the pending draw. expectedNode is as in Discard.
func (s *Session) Tsumo(expectedNode *int, v View) (State, error) {
	if err := s.tsumo(expectedNode); err != nil {
		return State{}, err
	}
	return s.state(v), nil
}

// tsumo is Tsumo without the state.
func (s *Session) tsumo(expectedNode *int) error {
	if err := s.checkExpectedNode(expectedNode); err != nil {
		return err
	}
	cur := s.nodes[s.current]
	if id, ok := cur.children[StatusTsumo]; ok {
		s.current = id
		return nil
	}
	d, ok := s.drawn(cur)
	if !ok {
		return fmt.Errorf("%w: node %d is %s", ErrConflict, cur.id, cur.status)
	}
	if err := s.roomForNode(); err != nil {
		return err
	}
	tiles := append(append([]tile.Tile{}, cur.hand...), d)
	tile.Sort(tiles)
	res, ok := yaku.Evaluate(tiles, yaku.Context{
		WinTile: d.Kind, Winds: winds, DoraIndicators: s.wall.DoraIndicators(),
	})
	if !ok {
		return fmt.Errorf("%w: hand is not complete", ErrConflict)
	}
	child := s.addNode(&node{
		parent: cur.id, turn: cur.turn, hand: cur.hand, draw: &d, status: StatusTsumo,
		win: &Win{Tiles: tile.Strings(tiles), Yaku: res.Yaku, Dora: res.Dora, HanTotal: res.HanTotal},
	})
	child.winRows = s.winRows(tile.CountsOf(tiles), res)
	cur.children[StatusTsumo] = child.id
	return nil
}

// checkExpectedNode returns ErrConflict if expectedNode is non-nil and does
// not match the current node (another tab moved it on first).
// a nil expectedNode always passes (older or same-tab clients
// that don't send one keep today's behaviour).
func (s *Session) checkExpectedNode(expectedNode *int) error {
	if expectedNode != nil && *expectedNode != s.current {
		return fmt.Errorf("%w: stale node_id %d: the current node is %d", ErrConflict, *expectedNode, s.current)
	}
	return nil
}

// Goto moves the current node. Unlike Discard/Tsumo it names its target node
// explicitly rather than acting on "whatever is current", so another tab
// moving the session on first doesn't make it ambiguous: it either still
// exists (it does; the tree only grows) or doesn't (ErrNotFound already).
// It has no expectedNode guard.
func (s *Session) Goto(id int, v View) (State, error) {
	if err := s.goTo(id); err != nil {
		return State{}, err
	}
	return s.state(v), nil
}

// goTo is Goto without the state.
func (s *Session) goTo(id int) error {
	if id < 0 || id >= len(s.nodes) {
		return fmt.Errorf("%w: node %d", ErrNotFound, id)
	}
	s.current = id
	return nil
}

func (s *Session) analyze(c tile.Counts) []yakushanten.Result {
	return s.analyzer.Analyze(c)
}

// combos returns the yaku combos of the 13 tiles c, whose rows are res.
func (s *Session) combos(c tile.Counts, res []yakushanten.Result) []yakushanten.Combo {
	return s.analyzer.Combos(c, nil, res)
}

// nodeCombos returns the yaku combos of a node's hand, cached on the node
// until pruneAnalysisCache drops them.
func (s *Session) nodeCombos(n *node) []yakushanten.Combo {
	if n.combos == nil {
		// non-nil even when empty, so an empty result is not recomputed
		n.combos = append([]yakushanten.Combo{}, s.combos(tile.CountsOf(n.hand), s.nodeAnalysis(n))...)
	}
	return n.combos
}

func (s *Session) nodeAnalysis(n *node) []yakushanten.Result {
	if n.analysis == nil {
		n.analysis = s.analyze(tile.CountsOf(n.hand))
	}
	if n.rowShanten == nil {
		n.rowShanten = compactShanten(n.analysis)
	}
	return n.analysis
}

// noShanten is rowShanten's value for an impossible row.
const noShanten = math.MinInt8

func compactShanten(res []yakushanten.Result) []int8 {
	out := make([]int8, len(res))
	for i, r := range res {
		out[i] = noShanten
		if r.Possible {
			out[i] = int8(r.Shanten)
		}
	}
	return out
}

// nodeRowShanten returns each row's shanten at a node that is not a win,
// analyzing its hand only if no analysis has recorded them yet.
func (s *Session) nodeRowShanten(n *node) []int8 {
	if n.rowShanten == nil {
		res := n.analysis
		if res == nil {
			res = s.analyze(tile.CountsOf(n.hand))
		}
		n.rowShanten = compactShanten(res)
	}
	return n.rowShanten
}

// nodeNormalShanten returns just the normal-form shanten (nil = complete
// hand impossible), for the tree view. It is cached on the node forever
// (unlike analysis/byDiscard) since it is tiny. A node whose rows are known
// already (rowShanten) reads it from the normal row, the first.
func (s *Session) nodeNormalShanten(n *node) *int {
	if !n.normalShantenDone {
		if n.rowShanten != nil {
			if v := n.rowShanten[0]; v != noShanten {
				n.normalShanten = intPtr(int(v))
			}
		} else {
			n.normalShanten = apiview.ShantenOf(s.analyzer.NormalShanten(tile.CountsOf(n.hand)))
		}
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
			n.advice = nil
			n.combos = nil
			n.combosByDiscard = nil
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
