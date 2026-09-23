package match

import (
	"slices"

	"github.com/litencatt/mhj2/internal/game"
	"github.com/litencatt/mhj2/internal/score"
	"github.com/litencatt/mhj2/internal/session"
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yaku"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

// State is the JSON view of a game for the human (docs/api.md).
type State struct {
	GameID            string                       `json:"game_id"`
	Seed              int64                        `json:"seed"`
	You               int                          `json:"you"`
	Dealer            int                          `json:"dealer"`
	RoundWind         string                       `json:"round_wind"`
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
	Analysis          []session.YakuRow            `json:"analysis"`
	ByDiscard         map[string][]session.YakuRow `json:"by_discard"`
	History           []session.HistoryEntry       `json:"history"`
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
	HandCount int         `json:"hand_count"`
	Hand      []string    `json:"hand,omitempty"`
	Drawn     *string     `json:"drawn,omitempty"`
}

// RiverTile is a discard; riichi marks the declaration tile.
type RiverTile struct {
	Tile   string `json:"tile"`
	Riichi bool   `json:"riichi"`
}

// Event is one move since your previous move. Other seats' skips are not
// reported (they would reveal a wait).
type Event struct {
	Seat int             `json:"seat"`
	Type game.ActionType `json:"type"`
	Tile string          `json:"tile,omitempty"`
}

// Result is how the round ended.
type Result struct {
	Kind    string       `json:"kind"`   // tsumo, ron or draw
	Winner  int          `json:"winner"` // -1 on a draw
	From    int          `json:"from"`   // discarder on a ron, else -1
	WinTile *string      `json:"win_tile"`
	Yaku    []yaku.Yaku  `json:"yaku"`
	Han     int          `json:"han"`
	Fu      int          `json:"fu"`
	Dora    int          `json:"dora"`
	UraDora int          `json:"ura_dora"`
	Points  score.Points `json:"points"`
	Deltas  [4]int       `json:"deltas"`
	Tenpai  [4]bool      `json:"tenpai"`
	Deposit int          `json:"deposit"`
}

func (m *Match) state() State {
	r := m.game.Round
	v := r.ViewFor(Human)
	st := State{
		GameID:            m.id,
		Seed:              v.Seed,
		You:               Human,
		Dealer:            v.Dealer,
		RoundWind:         v.RoundWind.String(),
		Phase:             v.Phase,
		Actor:             v.Actor,
		WallRemaining:     v.DrawsLeft,
		Deposit:           v.Deposit,
		DoraIndicators:    tile.Strings(v.DoraIndicators),
		Dora:              doraKinds(v.DoraIndicators),
		UraDoraIndicators: []string{},
		UraDora:           []string{},
		Legal:             r.LegalFor(Human),
		Events:            []Event{},
		ByDiscard:         map[string][]session.YakuRow{},
	}
	if v.UraIndicators != nil {
		st.UraDoraIndicators = tile.Strings(v.UraIndicators)
		st.UraDora = doraKinds(v.UraIndicators)
	}
	if v.LastDiscard != nil && st.Legal.Ron {
		s := v.LastDiscard.String()
		st.LastDiscard = &s
	}
	for s, sv := range v.Seats {
		seat := Seat{
			Seat: s, Wind: sv.Wind.String(), Points: sv.Points, Riichi: sv.Riichi,
			River: make([]RiverTile, len(sv.River)), HandCount: sv.HandCount,
		}
		for i, rt := range sv.River {
			seat.River[i] = RiverTile{Tile: rt.Tile.String(), Riichi: rt.Riichi}
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
		if a.Type == game.Skip && a.Seat != Human {
			continue
		}
		st.Events = append(st.Events, Event(a))
	}

	me := v.Seats[Human]
	visible := r.Visible(Human)
	res := m.analyze(tile.CountsOf(me.Hand))
	st.Analysis = session.Rows(res, &visible, m.han)
	m.record(len(me.River), res)
	if me.Drawn != nil && v.Phase == game.PhaseDiscard && v.Actor == Human {
		all := append(slices.Clone(me.Hand), *me.Drawn)
		c := tile.CountsOf(all)
		for _, t := range all {
			key := t.String()
			if _, done := st.ByDiscard[key]; done {
				continue
			}
			c[t.Kind]--
			st.ByDiscard[key] = session.Rows(m.analyze(c), &visible, m.han)
			c[t.Kind]++
		}
	}
	st.History = m.historyList()
	st.Result = result(v.Result)
	return st
}

// record keeps the human's row shanten for the hand after turn discards.
func (m *Match) record(turn int, res []yakushanten.Result) {
	if _, ok := m.history[turn]; ok {
		return
	}
	h := session.HistoryEntry{NodeID: turn, Turn: turn, Shanten: map[string]*int{}}
	for _, r := range res {
		h.Shanten[r.Key] = session.ShantenOf(r)
	}
	m.history[turn] = h
}

func (m *Match) historyList() []session.HistoryEntry {
	out := make([]session.HistoryEntry, 0, len(m.history))
	for _, h := range m.history {
		out = append(out, h)
	}
	slices.SortFunc(out, func(a, b session.HistoryEntry) int { return a.Turn - b.Turn })
	return out
}

func result(res *game.Result) *Result {
	if res == nil {
		return nil
	}
	out := &Result{
		Kind: res.Kind, Winner: res.Winner, From: res.From, Yaku: []yaku.Yaku{},
		Points: res.Points, Deltas: res.Deltas, Tenpai: res.Tenpai, Deposit: res.Deposit,
	}
	if w := res.Win; w != nil {
		t := res.WinTile.String()
		out.WinTile = &t
		out.Yaku = w.Yaku
		out.Han, out.Fu, out.Dora, out.UraDora = w.HanTotal, w.Fu, w.Dora, w.UraDora
	}
	return out
}

func doraKinds(indicators []tile.Tile) []string {
	out := make([]string, len(indicators))
	for i, ind := range indicators {
		out[i] = tile.DoraFromIndicator(ind.Kind).String()
	}
	return out
}
