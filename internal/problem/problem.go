// Package problem makes practice problems from a seed and grades the
// answers with the engine's own ranking (docs/problems.md). A problem is
// fixed by its kind, level and seed, so it holds no state: grading an
// answer builds the problem again from its id.
package problem

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/litencatt/mhj-dojo/internal/advice"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// Errors returned by Generate, Parse and Grade; apicall maps them to HTTP
// status codes.
var (
	ErrInvalid = errors.New("invalid request")
	// ErrNoPosition is returned when no candidate seed within maxTries
	// gives a position that passes the level's filter.
	ErrNoPosition = errors.New("no problem for this seed")
)

// Kind is the kind of problem.
type Kind string

// Kinds of problems.
const (
	Nanikiru Kind = "nanikiru" // 何切る: discard one of 14 tiles
)

// maxTries bounds the candidate seeds Generate tries after the first.
const maxTries = 100

// Problem is one problem, without its answer in the JSON.
type Problem struct {
	ID       string   `json:"id"` // "nanikiru:1:12345": kind, level, seed
	Kind     Kind     `json:"kind"`
	Level    int      `json:"level"`
	Seed     int64    `json:"seed"`   // the seed asked for
	Source   int64    `json:"source"` // the candidate seed the position was made from
	Position Position `json:"position"`
	Choose   string   `json:"choose"` // "one" | "many": how many tiles an answer holds

	answer answer
}

// Position is what the page needs to draw the problem.
type Position struct {
	Hand           []string       `json:"hand"`  // 13 tiles, sorted
	Drawn          *string        `json:"drawn"` // the tile just drawn
	DoraIndicators []string       `json:"dora_indicators"`
	Junme          int            `json:"junme"` // the discard being chosen: turn + 1
	RoundWind      string         `json:"round_wind"`
	SeatWind       string         `json:"seat_wind"`
	Discards       []string       `json:"discards"`  // the player's own discards so far
	Remaining      map[string]int `json:"remaining"` // unseen copies of each kind, as a session's
}

// Result grades an answer.
type Result struct {
	ID      string   `json:"id"`
	Correct bool     `json:"correct"`
	Answer  []Eval   `json:"answer"`  // each tile of the answer, in order
	Best    []string `json:"best"`    // the correct tiles
	Ranking []Eval   `json:"ranking"` // every choice, best first
	Text    string   `json:"text"`    // the explanation, in Japanese
}

// Eval is one tile's place in the ranking.
type Eval struct {
	Tile    string   `json:"tile"`
	Rank    int      `json:"rank"` // 1 = correct (ties share a rank)
	Shanten int      `json:"shanten"`
	Ukeire  int      `json:"ukeire"`
	Wait    *float64 `json:"wait"` // expected tenpai wait; null above 1-shanten
}

// answer is what grading needs, per kind.
type answer struct {
	tiles  []tile.Tile    // the tiles an answer may name
	advice *advice.Advice // nanikiru: the ranking of the discards
}

// levels is the number of levels of each kind.
var levels = map[Kind]int{Nanikiru: len(nanikiruLevels)}

// analyzer is shared by every problem, so that its memo stays warm across
// requests; mu guards it (an analyzer is not safe for concurrent use).
var (
	mu       sync.Mutex
	analyzer = yakushanten.NewAnalyzer()
)

// Generate makes the problem of a kind and level from seed: the first
// candidate seed (seed, then wall.RoundSeed(seed, i) for i = 1…maxTries)
// whose position passes the level's filter.
func Generate(kind Kind, level int, seed int64) (*Problem, error) {
	if err := check(kind, level); err != nil {
		return nil, err
	}
	mu.Lock()
	defer mu.Unlock()
	for i := 0; i <= maxTries; i++ {
		src := seed
		if i > 0 {
			src = wall.RoundSeed(seed, i)
		}
		p := nanikiru(level, src)
		if p == nil {
			continue
		}
		p.ID, p.Kind, p.Level, p.Seed, p.Source = id(kind, level, seed), kind, level, seed, src
		return p, nil
	}
	return nil, fmt.Errorf("%w: %s", ErrNoPosition, id(kind, level, seed))
}

// Parse reads a problem id, "kind:level:seed".
func Parse(s string) (Kind, int, int64, error) {
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return "", 0, 0, fmt.Errorf("%w: id must be kind:level:seed", ErrInvalid)
	}
	kind := Kind(parts[0])
	level, err := strconv.Atoi(parts[1])
	if err != nil {
		return "", 0, 0, fmt.Errorf("%w: invalid level %q", ErrInvalid, parts[1])
	}
	seed, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		return "", 0, 0, fmt.Errorf("%w: invalid seed %q", ErrInvalid, parts[2])
	}
	if err := check(kind, level); err != nil {
		return "", 0, 0, err
	}
	return kind, level, seed, nil
}

// Grade grades an answer: the tiles chosen, exact tiles of the position.
func (p *Problem) Grade(ans []tile.Tile) (*Result, error) {
	for _, t := range ans {
		if !slices.Contains(p.answer.tiles, t) {
			return nil, fmt.Errorf("%w: tile %s is not in the hand", ErrInvalid, t)
		}
	}
	return p.gradeNanikiru(ans)
}

func check(kind Kind, level int) error {
	n, ok := levels[kind]
	if !ok {
		return fmt.Errorf("%w: kind must be nanikiru", ErrInvalid)
	}
	if level < 1 || level > n {
		return fmt.Errorf("%w: level must be between 1 and %d", ErrInvalid, n)
	}
	return nil
}

func id(kind Kind, level int, seed int64) string {
	return fmt.Sprintf("%s:%d:%d", kind, level, seed)
}
