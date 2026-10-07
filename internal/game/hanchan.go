package game

import (
	"errors"
	"fmt"
	"slices"

	"github.com/litencatt/mhj-dojo/internal/sortx"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

// Rules set up a game of several rounds.
type Rules struct {
	// Winds is the number of round winds played: 1 for 東風戦, 2 for 半荘戦.
	Winds        int
	StartPoints  int
	ReturnPoints int    // the points the final score is measured from
	Uma          [4]int // added to the final score by rank, in thousands
}

// Tonpuu and Hanchan are the standard rules for an East-only game and an
// East-South game: 25000 points, 30000 returned, uma 10-20.
var (
	Tonpuu      = Rules{Winds: 1, StartPoints: 25000, ReturnPoints: 30000, Uma: [4]int{20, 10, -10, -20}}
	HanchanRule = Rules{Winds: 2, StartPoints: 25000, ReturnPoints: 30000, Uma: [4]int{20, 10, -10, -20}}
)

// ErrOver is returned by Next once the game has ended.
var ErrOver = errors.New("the game is over")

// Hanchan is a game of rounds: it deals each round from the master seed,
// rotates the dealer, counts honba, carries riichi sticks and ends the game
// on the last round or when someone drops below zero. It is not safe for
// concurrent use.
type Hanchan struct {
	rules       Rules
	seed        int64
	firstDealer int
	wind        int // 0 = East round, 1 = South round
	number      int // 0-3: the dealer is (firstDealer + number) % 4
	honba       int
	deposit     int
	index       int // rounds dealt so far, minus one: the wall seed index
	round       *Round
	logs        [][]Action // logs of the finished rounds
	seats       SeatConfig // carried to every round
}

// NewHanchan deals the first round. The first dealer is seed mod 4.
func NewHanchan(seed int64, rules Rules) *Hanchan {
	return NewHanchanFrom(seed, rules, DefaultFirstDealer(seed))
}

// DefaultFirstDealer is the first dealer New and NewHanchan pick: seed mod 4.
func DefaultFirstDealer(seed int64) int { return int(((seed % 4) + 4) % 4) }

// NewHanchanFrom deals the first round with seat firstDealer (0-3) as the
// first dealer; the walls are the same as NewHanchan's for the seed.
func NewHanchanFrom(seed int64, rules Rules, firstDealer int) *Hanchan {
	return NewHanchanWith(seed, rules, firstDealer, SeatConfig{})
}

// NewHanchanWith is NewHanchanFrom with per-seat house rules for every round,
// the first one included.
func NewHanchanWith(seed int64, rules Rules, firstDealer int, seats SeatConfig) *Hanchan {
	h := &Hanchan{rules: rules, seed: seed, firstDealer: firstDealer, seats: seats}
	h.deal([4]int{rules.StartPoints, rules.StartPoints, rules.StartPoints, rules.StartPoints})
	return h
}

func (h *Hanchan) deal(points [4]int) {
	h.round = NewRound(RoundConfig{
		Wall:       wall.New(wall.RoundSeed(h.seed, h.index)),
		Dealer:     h.Dealer(),
		RoundWind:  tile.East + tile.Kind(h.wind),
		Honba:      h.honba,
		Deposit:    h.deposit,
		Points:     points,
		SeatConfig: h.seats,
	})
}

// Seed returns the master seed.
func (h *Hanchan) Seed() int64 { return h.seed }

// Rules returns the game's rules.
func (h *Hanchan) Rules() Rules { return h.rules }

// Round returns the current round.
func (h *Hanchan) Round() *Round { return h.round }

// Dealer returns the current dealer's seat.
func (h *Hanchan) Dealer() int { return (h.firstDealer + h.number) % 4 }

// FirstDealer returns the seat of the first dealer (起家).
func (h *Hanchan) FirstDealer() int { return h.firstDealer }

// RoundWind returns the current round wind (tile.East or tile.South).
func (h *Hanchan) RoundWind() tile.Kind { return tile.East + tile.Kind(h.wind) }

// Number returns the round number within the wind, 1-4 (東1局 = 1).
func (h *Hanchan) Number() int { return h.number + 1 }

// Honba returns the current round's honba.
func (h *Hanchan) Honba() int { return h.honba }

// Logs returns the action logs of every round, the current one last.
func (h *Hanchan) Logs() [][]Action {
	return append(slices.Clone(h.logs), h.round.Log())
}

// next is what follows the current, ended round.
type next struct {
	over           bool
	wind, number   int
	honba, deposit int
}

// following decides what follows the current round, which must have ended.
func (h *Hanchan) following() next {
	res := h.round.Result()
	dealer := h.Dealer()
	var renchan bool
	switch res.Kind {
	case "tsumo", "ron":
		renchan = res.Winner == dealer
	case "draw":
		renchan = res.Tenpai[dealer]
	default: // an abortive draw repeats the round
		renchan = true
	}
	n := next{wind: h.wind, number: h.number, deposit: res.Deposit, honba: 0}
	if renchan || res.Winner < 0 {
		n.honba = h.honba + 1 // a repeat or a draw adds a honba
	}
	for s := range 4 {
		if h.round.players[s].points < 0 {
			n.over = true // someone dropped below zero (tobi)
		}
	}
	if !renchan {
		n.number++
		if n.number == 4 {
			n.wind, n.number = n.wind+1, 0
		}
		if n.wind == h.rules.Winds {
			n.over = true // the last round has passed
		}
	}
	return n
}

// Over reports whether the game has ended: the current round has ended and
// it was the last one.
func (h *Hanchan) Over() bool {
	return h.round.Phase() == PhaseEnded && h.following().over
}

// Next deals the round that follows the current one, which must have ended.
func (h *Hanchan) Next() error {
	if h.round.Phase() != PhaseEnded {
		return fmt.Errorf("%w: the round has not ended", ErrConflict)
	}
	n := h.following()
	if n.over {
		return fmt.Errorf("%w: %w", ErrConflict, ErrOver)
	}
	var points [4]int
	for s := range points {
		points[s] = h.round.players[s].points
	}
	h.logs = append(h.logs, h.round.Log())
	h.wind, h.number, h.honba, h.deposit = n.wind, n.number, n.honba, n.deposit
	h.index++
	h.deal(points)
	return nil
}

// Standing is one seat's place in the game.
type Standing struct {
	Seat   int
	Rank   int     // 1-4
	Points int     // current points; once the game is over, final points
	Score  float64 // (points - return) / 1000 + uma + oka, to 0.1
}

// Standings ranks the seats by points; ties go to the seat nearer the first
// dealer. Once the game is over, riichi sticks still on the table go to the
// first place (in Points and Score) and the scores are final.
func (h *Hanchan) Standings() [4]Standing {
	var out [4]Standing
	order := []int{0, 1, 2, 3}
	pts := func(s int) int { return h.round.players[s].points }
	near := func(s int) int { return (s - h.firstDealer + 4) % 4 }
	sortx.Func(order, func(a, b int) int {
		if pts(a) != pts(b) {
			return pts(b) - pts(a)
		}
		return near(a) - near(b)
	})
	oka := (h.rules.ReturnPoints - h.rules.StartPoints) * 4
	for rank, s := range order {
		p := pts(s)
		if rank == 0 && h.Over() {
			p += h.round.deposit
		}
		total := p - h.rules.ReturnPoints + h.rules.Uma[rank]*1000
		if rank == 0 {
			total += oka
		}
		out[s] = Standing{Seat: s, Rank: rank + 1, Points: p, Score: float64(total/100) / 10}
	}
	return out
}
