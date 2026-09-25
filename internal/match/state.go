package match

import (
	"slices"

	"github.com/litencatt/mhj2/internal/apiview"
	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/score"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
)

// State is the JSON view of a game for the human (docs/api.md).
type State struct {
	GameID            string                       `json:"game_id"`
	Seed              *int64                       `json:"seed"` // null until the game ends unless you chose it
	Length            string                       `json:"length"`
	You               int                          `json:"you"`
	FirstDealer       int                          `json:"first_dealer"`
	Dealer            int                          `json:"dealer"`
	RoundWind         string                       `json:"round_wind"`
	RoundNumber       int                          `json:"round_number"` // 1-4: 東1局 = round_wind 1z, round_number 1
	Honba             int                          `json:"honba"`
	CanNext           bool                         `json:"can_next"`  // the round has ended and another follows
	GameOver          bool                         `json:"game_over"` // the last round has ended
	Standings         [4]Standing                  `json:"standings"`
	Rounds            []RoundSummary               `json:"rounds"` // finished rounds, the current one last once it ends
	Phase             game.Phase                   `json:"phase"`
	Actor             int                          `json:"actor"` // -1 once ended
	WallRemaining     int                          `json:"wall_remaining"`
	Deposit           int                          `json:"deposit"`
	DoraIndicators    []string                     `json:"dora_indicators"`
	Dora              []string                     `json:"dora"`
	UraDoraIndicators []string                     `json:"ura_dora_indicators"` // empty until the end
	UraDora           []string                     `json:"ura_dora"`
	Seats             [4]Seat                      `json:"seats"`
	LastDiscard       *string                      `json:"last_discard"` // the tile you may ron
	Legal             game.Legal                   `json:"legal"`
	Events            []Event                      `json:"events"`
	Analysis          []apiview.YakuRow            `json:"analysis"`
	ByDiscard         map[string][]apiview.YakuRow `json:"by_discard"`
	History           []apiview.HistoryEntry       `json:"history"`
	Result            *Result                      `json:"result"`
}

// Seat is one player. Hand and drawn are present only for you, and for
// every seat once the round has ended.
type Seat struct {
	Seat      int         `json:"seat"`
	Wind      string      `json:"wind"`
	Points    int         `json:"points"`
	Riichi    bool        `json:"riichi"`
	River     []RiverTile `json:"river"`
	Melds     []Meld      `json:"melds"`
	HandCount int         `json:"hand_count"` // concealed tiles, drawn tile included
	Hand      []string    `json:"hand,omitempty"`
	Drawn     *string     `json:"drawn,omitempty"`
}

// Meld is a called meld or a concealed kan.
type Meld struct {
	Type  string   `json:"type"`  // "chii", "pon", "kan" (open) or "ankan"
	Tiles []string `json:"tiles"` // the called tile last
	From  int      `json:"from"`  // the seat the tile came from; -1 for an ankan
}

// RiverTile is a discard; riichi marks the declaration tile, called a tile
// another seat took into a meld.
type RiverTile struct {
	Tile   string `json:"tile"`
	Riichi bool   `json:"riichi"`
	Called bool   `json:"called"`
}

// Event is one move since your previous move: discards, riichi, calls
// (tile = the claimed tile, tiles = the seat's own tiles in the meld), kans,
// wins and declarations. Skips and claims that lost to a higher one are not
// reported.
type Event struct {
	Seat  int             `json:"seat"`
	Type  game.ActionType `json:"type"`
	Tile  string          `json:"tile,omitempty"`
	Tiles []string        `json:"tiles,omitempty"`
}

// Standing is a seat's place in the game.
type Standing struct {
	Seat   int     `json:"seat"`
	Rank   int     `json:"rank"`
	Points int     `json:"points"`
	Score  float64 `json:"score"` // final once game_over
}

// RoundSummary is one finished round.
type RoundSummary struct {
	RoundWind   string `json:"round_wind"`
	RoundNumber int    `json:"round_number"`
	Honba       int    `json:"honba"`
	Kind        string `json:"kind"`
	Reason      string `json:"reason,omitempty"`
	Winner      int    `json:"winner"`
	From        int    `json:"from"`
	Deltas      [4]int `json:"deltas"`
}

// Result is how the round ended.
type Result struct {
	Kind    string       `json:"kind"`             // tsumo, ron, draw or abort
	Reason  string       `json:"reason,omitempty"` // abort: kyuushu, suufon or suucha
	Winner  int          `json:"winner"`           // -1 on a draw
	From    int          `json:"from"`             // discarder on a ron, else -1
	WinTile *string      `json:"win_tile"`
	Yaku    []yaku.Yaku  `json:"yaku"`
	Han     int          `json:"han"`
	Fu      int          `json:"fu"`
	Dora    int          `json:"dora"`
	UraDora int          `json:"ura_dora"`
	Points  score.Points `json:"points"`
	Deltas  [4]int       `json:"deltas"`
	// The deltas split into the hand's payments, honba and riichi sticks.
	HandDeltas  [4]int  `json:"hand_deltas"`
	HonbaDeltas [4]int  `json:"honba_deltas"`
	StickDeltas [4]int  `json:"stick_deltas"`
	Honba       int     `json:"honba"`
	Tenpai      [4]bool `json:"tenpai"`
	Deposit     int     `json:"deposit"`
}

func (m *Match) state() State {
	r, h := m.game.Round, m.game.H
	v := r.ViewFor(Human)
	st := State{
		GameID:            m.id,
		Length:            m.length,
		You:               Human,
		FirstDealer:       h.FirstDealer(),
		Dealer:            v.Dealer,
		RoundWind:         v.RoundWind.String(),
		RoundNumber:       h.Number(),
		Honba:             h.Honba(),
		GameOver:          h.Over(),
		Rounds:            slices.Clone(m.rounds),
		Phase:             v.Phase,
		Actor:             v.Actor,
		WallRemaining:     v.DrawsLeft,
		Deposit:           v.Deposit,
		DoraIndicators:    tile.Strings(v.DoraIndicators),
		Dora:              apiview.DoraKinds(v.DoraIndicators),
		UraDoraIndicators: []string{},
		UraDora:           []string{},
		Legal:             r.LegalFor(Human),
		Events:            []Event{},
		ByDiscard:         map[string][]apiview.YakuRow{},
	}
	st.CanNext = v.Phase == game.PhaseEnded && !st.GameOver
	if m.seedKnown || st.GameOver {
		seed := h.Seed()
		st.Seed = &seed
	}
	if st.Rounds == nil {
		st.Rounds = []RoundSummary{}
	}
	if s := m.summary(); s != nil {
		st.Rounds = append(st.Rounds, *s)
	}
	for s, sd := range h.Standings() {
		st.Standings[s] = Standing{Seat: sd.Seat, Rank: sd.Rank, Points: sd.Points, Score: sd.Score}
	}
	if v.UraIndicators != nil {
		st.UraDoraIndicators = tile.Strings(v.UraIndicators)
		st.UraDora = apiview.DoraKinds(v.UraIndicators)
	}
	l := st.Legal
	if v.LastDiscard != nil && (l.Ron || l.Pon || len(l.Chii) > 0 || len(l.Kan) > 0) {
		s := v.LastDiscard.String()
		st.LastDiscard = &s
	}
	for s, sv := range v.Seats {
		seat := Seat{
			Seat: s, Wind: sv.Wind.String(), Points: sv.Points, Riichi: sv.Riichi,
			River: make([]RiverTile, len(sv.River)), Melds: make([]Meld, len(sv.Melds)), HandCount: sv.HandCount,
		}
		for i, rt := range sv.River {
			seat.River[i] = RiverTile{Tile: rt.Tile.String(), Riichi: rt.Riichi, Called: rt.Called}
		}
		for i, m := range sv.Melds {
			seat.Melds[i] = Meld{Type: meldType(m), Tiles: tile.Strings(m.Tiles), From: m.From}
		}
		if sv.Hand != nil {
			seat.Hand = tile.Strings(sv.Hand)
		}
		if sv.Drawn != nil {
			d := sv.Drawn.String()
			seat.Drawn = &d
		}
		st.Seats[s] = seat
	}
	for _, a := range m.game.Events(m.since) {
		st.Events = append(st.Events, Event(a))
	}

	me := v.Seats[Human]
	visible := v.Visible()
	melds := fixedMelds(me.Melds)
	han := m.hanFor(melds)
	st.Analysis = apiview.Rows(m.analyze(tile.CountsOf(me.Hand), melds), &visible, han)
	if v.Phase == game.PhaseDiscard && v.Actor == Human {
		all := slices.Clone(me.Hand)
		if me.Drawn != nil { // no drawn tile right after a call
			all = append(all, *me.Drawn)
		}
		c := tile.CountsOf(all)
		for _, t := range all {
			key := t.String()
			if _, done := st.ByDiscard[key]; done || !slices.Contains(st.Legal.Discards, key) {
				continue
			}
			c[t.Kind]--
			st.ByDiscard[key] = apiview.Rows(m.analyze(c, melds), &visible, han)
			c[t.Kind]++
		}
	}
	st.History = slices.Clone(m.history)
	st.Result = result(v.Result)
	return st
}

// recordHand appends the human's row shanten for the current hand: once at
// the start of the round and after each of the human's discards. The turn is
// the number of those discards, not the river length, which calls will
// change.
func (m *Match) recordHand() {
	me := m.game.Round.ViewFor(Human).Seats[Human]
	turn := len(m.history)
	m.history = append(m.history, apiview.HistoryEntry{
		NodeID: turn, Turn: turn, Shanten: apiview.ShantenMap(m.analyze(tile.CountsOf(me.Hand), fixedMelds(me.Melds))),
	})
}

// fixedMelds returns the melds the analysis holds fixed: calls and ankans.
func fixedMelds(called []game.Called) []yaku.Meld {
	out := make([]yaku.Meld, len(called))
	for i, c := range called {
		out[i] = c.Meld
	}
	return out
}

func meldType(m game.Called) string {
	switch {
	case m.Meld.Type == yaku.Seq:
		return "chii"
	case !m.Meld.Kan:
		return "pon"
	case m.From < 0:
		return "ankan"
	}
	return "kan"
}

// summary sums up the current round once it has ended, else nil.
func (m *Match) summary() *RoundSummary {
	res, h := m.game.Round.Result(), m.game.H
	if res == nil {
		return nil
	}
	return &RoundSummary{
		RoundWind: h.RoundWind().String(), RoundNumber: h.Number(), Honba: h.Honba(),
		Kind: res.Kind, Reason: res.Reason, Winner: res.Winner, From: res.From, Deltas: res.Deltas,
	}
}

func result(res *game.Result) *Result {
	if res == nil {
		return nil
	}
	out := &Result{
		Kind: res.Kind, Reason: res.Reason, Winner: res.Winner, From: res.From, Yaku: []yaku.Yaku{},
		Points: res.Points, Deltas: res.Deltas, Tenpai: res.Tenpai, Deposit: res.Deposit,
		HandDeltas: res.HandDeltas, HonbaDeltas: res.HonbaDeltas, StickDeltas: res.StickDeltas, Honba: res.Honba,
	}
	if w := res.Win; w != nil {
		t := res.WinTile.String()
		out.WinTile = &t
		out.Yaku = w.Yaku
		out.Han, out.Fu, out.Dora, out.UraDora = w.HanTotal, w.Fu, w.Dora, w.UraDora
	}
	return out
}
