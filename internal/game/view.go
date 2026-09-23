package game

import (
	"slices"

	"github.com/litencatt/mhj2/internal/tile"
)

// SeatView is one seat as seen by a viewer. Hand and Drawn are set only for
// the viewer's own seat and, once the round has ended, for every seat.
type SeatView struct {
	Seat      int
	Wind      tile.Kind
	Points    int
	River     []RiverTile
	HandCount int
	Hand      []tile.Tile
	Drawn     *tile.Tile
	Riichi    bool
}

// View is the round as one seat may see it: its own hand, every river and
// the public state. Other seats' hands stay hidden until the round ends.
type View struct {
	Viewer         int
	Seed           int64
	Dealer         int
	RoundWind      tile.Kind
	Phase          Phase
	Actor          int
	DrawsLeft      int
	Deposit        int
	DoraIndicators []tile.Tile
	// UraIndicators are revealed once the round has ended.
	UraIndicators []tile.Tile
	Seats         [4]SeatView
	LastDiscard   *tile.Tile // set during PhaseCall
	Result        *Result
}

// ViewFor returns what viewer may see.
func (r *Round) ViewFor(viewer int) View {
	v := View{
		Viewer:         viewer,
		Seed:           r.wall.Seed(),
		Dealer:         r.dealer,
		RoundWind:      r.roundWind,
		Phase:          r.phase,
		Actor:          r.Actor(),
		DrawsLeft:      r.DrawsLeft(),
		Deposit:        r.deposit,
		DoraIndicators: r.wall.DoraIndicators(),
		Result:         r.result,
	}
	ended := r.phase == PhaseEnded
	if ended {
		v.UraIndicators = r.wall.UraDoraIndicators()
	}
	if r.phase == PhaseCall {
		d := r.lastDiscard
		v.LastDiscard = &d
	}
	for s := range r.players {
		p := &r.players[s]
		sv := SeatView{
			Seat:      s,
			Wind:      r.SeatWind(s),
			Points:    p.points,
			River:     slices.Clone(p.river),
			HandCount: len(p.hand),
			Riichi:    p.riichi,
		}
		if p.drawn != nil {
			sv.HandCount++
		}
		if s == viewer || ended {
			sv.Hand = slices.Clone(p.hand)
			if p.drawn != nil {
				d := *p.drawn
				sv.Drawn = &d
			}
		}
		v.Seats[s] = sv
	}
	return v
}

// Legal lists what seat may do now.
type Legal struct {
	Discards []string `json:"discards"` // tiles that may be discarded
	Riichi   []string `json:"riichi"`   // tiles that may be discarded declaring riichi
	Tsumo    bool     `json:"tsumo"`
	Ron      bool     `json:"ron"`
	Skip     bool     `json:"skip"`
}

// Any reports whether seat has any move.
func (l Legal) Any() bool { return len(l.Discards) > 0 || l.Tsumo || l.Ron || l.Skip }

// LegalFor returns seat's legal moves; empty unless seat is the actor.
func (r *Round) LegalFor(seat int) Legal {
	l := Legal{Discards: []string{}, Riichi: []string{}}
	if seat != r.Actor() {
		return l
	}
	if r.phase == PhaseCall {
		l.Ron, l.Skip = true, true
		return l
	}
	p := &r.players[seat]
	if p.riichi {
		l.Discards = append(l.Discards, p.drawn.String())
	} else {
		for _, t := range p.tiles14() {
			if !slices.Contains(l.Discards, t.String()) {
				l.Discards = append(l.Discards, t.String())
			}
		}
		l.Riichi = append(l.Riichi, r.riichiDiscards(seat)...)
	}
	_, l.Tsumo = r.tsumoWin(seat)
	return l
}

// Visible counts the tiles seat can see: its own hand and drawn tile, every
// river and the dora indicators. Unseen copies = 4 - Visible.
func (r *Round) Visible(seat int) tile.Counts {
	c := tile.CountsOf(r.players[seat].tiles14())
	for s := range r.players {
		for _, rt := range r.players[s].river {
			c[rt.Tile.Kind]++
		}
	}
	for _, d := range r.wall.DoraIndicators() {
		c[d.Kind]++
	}
	return c
}
