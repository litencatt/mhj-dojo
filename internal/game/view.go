package game

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/tile"
)

// SeatView is one seat as seen by a viewer. Hand and Drawn are set only for
// the viewer's own seat and, once the round has ended, for every seat.
type SeatView struct {
	Seat      int
	Wind      tile.Kind
	Points    int
	River     []RiverTile
	Melds     []Called // public
	HandCount int      // concealed tiles, drawn tile included
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
	FirstDealer    int // ties in the standings go to the seat nearer it
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
	// Robbing is set while a tile added to a kan waits to be robbed; it is
	// LastDiscard, shown to everyone but in no river or meld yet.
	Robbing bool
	Result  *Result
}

// ViewFor returns what viewer may see.
func (r *Round) ViewFor(viewer int) View {
	v := View{
		Viewer:         viewer,
		Seed:           r.wall.Seed(),
		Dealer:         r.dealer,
		FirstDealer:    r.firstDealer,
		RoundWind:      r.roundWind,
		Phase:          r.phase,
		Actor:          r.Actor(),
		DrawsLeft:      r.DrawsLeft(),
		Deposit:        r.deposit,
		DoraIndicators: r.doraIndicators(),
		Result:         r.result,
	}
	ended := r.phase == PhaseEnded
	if ended {
		v.UraIndicators = r.uraIndicators()
	}
	if r.phase == PhaseCall {
		d := r.lastDiscard
		v.LastDiscard = &d
		v.Robbing = r.robbing != nil
	}
	for s := range r.players {
		p := &r.players[s]
		sv := SeatView{
			Seat:      s,
			Wind:      r.SeatWind(s),
			Points:    p.points,
			River:     slices.Clone(p.river),
			Melds:     cloneMelds(p.melds),
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

// cloneMelds copies melds and their tiles, so a view never shares the
// round's data.
func cloneMelds(ms []Called) []Called {
	out := make([]Called, len(ms))
	for i, m := range ms {
		out[i] = m
		out[i].Tiles = slices.Clone(m.Tiles)
	}
	return out
}

// Legal lists what seat may do now.
type Legal struct {
	Discards []string `json:"discards"` // tiles that may be discarded
	Riichi   []string `json:"riichi"`   // tiles that may be discarded declaring riichi
	Tsumo    bool     `json:"tsumo"`
	Ron      bool     `json:"ron"`
	Skip     bool     `json:"skip"`
	Kyuushu  bool     `json:"kyuushu"` // may declare 九種九牌
	// Calls on the last discard (call phase): pon, an open kan, and the
	// concealed pairs a chii can use.
	Pon  bool       `json:"pon"`
	Chii [][]string `json:"chii"`
	// Kan lists the kinds of a kan: in the call phase the discard's kind
	// (open kan); on the seat's turn a concealed or added kan.
	Kan []string `json:"kan"`
	// Redraw: may send the drawn tile back and draw again (dojo only).
	Redraw bool `json:"redraw,omitempty"`
	// Summon lists the kinds a summon may fetch from the live wall (dojo only).
	Summon []string `json:"summon,omitempty"`
}

// Any reports whether seat has any move.
func (l Legal) Any() bool { return len(l.Discards) > 0 || l.Tsumo || l.Ron || l.Skip }

// LegalFor returns seat's legal moves; empty unless seat is the actor.
func (r *Round) LegalFor(seat int) Legal {
	l := Legal{Discards: []string{}, Riichi: []string{}, Chii: [][]string{}, Kan: []string{}}
	if seat != r.Actor() {
		return l
	}
	if r.phase == PhaseCall {
		c := r.claims[slices.IndexFunc(r.claims, func(c claim) bool { return c.seat == seat })]
		l.Ron, l.Pon, l.Skip = c.ron, c.pon, true
		for _, pair := range c.chii {
			l.Chii = append(l.Chii, tile.Strings(pair[:]))
		}
		if c.minkan {
			l.Kan = append(l.Kan, r.lastDiscard.Kind.String())
		}
		return l
	}
	p := &r.players[seat]
	if p.riichi {
		l.Discards = append(l.Discards, p.drawn.String())
	} else {
		for _, t := range p.concealed() {
			if !slices.Contains(l.Discards, t.String()) && !slices.Contains(p.kuikae, t.Kind) {
				l.Discards = append(l.Discards, t.String())
			}
		}
		l.Riichi = append(l.Riichi, r.riichiDiscards(seat)...)
	}
	_, l.Tsumo = r.tsumoWin(seat)
	l.Kyuushu = r.canKyuushu(seat)
	l.Redraw = r.canRedraw(seat)
	l.Summon = r.summonable(seat)
	l.Kan = append(l.Kan, r.selfKans(seat)...)
	return l
}

// Visible counts the tiles the viewer can see: its own hand and drawn tile,
// every river and called meld, and the dora indicators. Unseen copies = 4 -
// Visible. It is the one place that decides what is visible, for the CPU and
// the API.
func (v View) Visible() tile.Counts {
	me := v.Seats[v.Viewer]
	c := tile.CountsOf(me.Hand)
	if me.Drawn != nil {
		c[me.Drawn.Kind]++
	}
	for _, s := range v.Seats {
		for _, rt := range s.River {
			if !rt.Called { // a called tile is counted in the meld
				c[rt.Tile.Kind]++
			}
		}
		for _, m := range s.Melds {
			for _, t := range m.Tiles {
				c[t.Kind]++
			}
		}
	}
	for _, d := range v.DoraIndicators {
		c[d.Kind]++
	}
	if v.Robbing {
		c[v.LastDiscard.Kind]++
	}
	return c
}
