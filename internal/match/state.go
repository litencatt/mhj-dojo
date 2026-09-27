package match

import (
	"slices"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/score"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
	"github.com/litencatt/mhj-dojo/internal/yakushanten"
)

// State is the JSON view of a game for the human (docs/api.md).
type State struct {
	GameID            string                          `json:"game_id"`
	Seed              *int64                          `json:"seed"` // null until the game ends unless you chose it
	Length            string                          `json:"length"`
	FirstDealerMode   string                          `json:"first_dealer_mode"` // the first_dealer asked for: random or you
	CPU               string                          `json:"cpu"`               // weak or normal
	You               int                             `json:"you"`
	FirstDealer       int                             `json:"first_dealer"` // the seat
	Dealer            int                             `json:"dealer"`
	RoundWind         string                          `json:"round_wind"`
	RoundNumber       int                             `json:"round_number"` // 1-4: 東1局 = round_wind 1z, round_number 1
	Honba             int                             `json:"honba"`
	CanNext           bool                            `json:"can_next"`  // the round has ended and another follows
	GameOver          bool                            `json:"game_over"` // the last round has ended
	Standings         [4]Standing                     `json:"standings"`
	Rounds            []RoundSummary                  `json:"rounds"` // finished rounds, the current one last once it ends
	Phase             game.Phase                      `json:"phase"`
	Actor             int                             `json:"actor"` // -1 once ended
	WallRemaining     int                             `json:"wall_remaining"`
	Deposit           int                             `json:"deposit"`
	DoraIndicators    []string                        `json:"dora_indicators"`
	Dora              []string                        `json:"dora"`
	UraDoraIndicators []string                        `json:"ura_dora_indicators"` // empty until the end
	UraDora           []string                        `json:"ura_dora"`
	Seats             [4]Seat                         `json:"seats"`
	LastDiscard       *string                         `json:"last_discard"` // the tile you may ron
	Legal             game.Legal                      `json:"legal"`
	Events            []Event                         `json:"events"`
	EventsFrom        int                             `json:"events_from"`           // the round's index of events[0]
	EventsWall        int                             `json:"events_wall_remaining"` // the wall just before events[0]; wall_remaining with none
	Analysis          []apiview.YakuRow               `json:"analysis"`
	ByDiscard         map[string][]apiview.DiscardRow `json:"by_discard"` // name, yakuman and han as in analysis
	Combos            []apiview.ComboRow              `json:"combos"`
	CombosByDiscard   map[string][]apiview.ComboRow   `json:"combos_by_discard"`
	Remaining         map[string]int                  `json:"remaining"` // unseen copies of each tile kind, for the ukeire lists
	History           []apiview.HistoryEntry          `json:"history"`
	Result            *Result                         `json:"result"`
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
	// HandGroups are the blocks of hand, for your seat only (docs/api.md).
	HandGroups []apiview.HandGroup `json:"hand_groups,omitempty"`
	Drawn      *string             `json:"drawn,omitempty"`
}

// Meld is a called meld or a concealed kan.
type Meld struct {
	Type  string   `json:"type"`  // "chii", "pon", "kan" (open) or "ankan"
	Tiles []string `json:"tiles"` // the called tile last; a kakan's added tile just before it
	From  int      `json:"from"`  // the seat the tile came from; -1 for an ankan
	Added bool     `json:"added"` // a kan made by adding a tile to a pon (kakan)
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
// reported. WallRemaining and NewDoraIndicators are the table right after
// the move (game.EventMark), so a client can replay the moves one by one.
// The marks never change once sent, so a round's NewDoraIndicators add up
// to its kan dora indicators.
type Event struct {
	Seat              int             `json:"seat"`
	Type              game.ActionType `json:"type"`
	Tile              string          `json:"tile,omitempty"`
	Tiles             []string        `json:"tiles,omitempty"`
	WallRemaining     int             `json:"wall_remaining"`
	NewDoraIndicators []string        `json:"new_dora_indicators,omitempty"` // kan dora turned over by the move
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
	Reason  string       `json:"reason,omitempty"` // abort: kyuushu, suufon, suucha or suukaikan
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
	// Pao are the seats responsible (包) for yakuman of the win.
	Pao []game.Pao `json:"pao"`
}

func (m *Match) state() State {
	r, h := m.game.Round, m.game.H
	v := r.ViewFor(Human)
	st := State{
		GameID:            m.id,
		Length:            m.opts.Length,
		FirstDealerMode:   m.opts.FirstDealer,
		CPU:               m.opts.CPU,
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
		ByDiscard:         map[string][]apiview.DiscardRow{},
		Combos:            []apiview.ComboRow{},
		CombosByDiscard:   map[string][]apiview.ComboRow{},
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
			seat.Melds[i] = Meld{Type: meldType(m), Tiles: tile.Strings(m.Tiles), From: m.From, Added: m.Added}
		}
		if sv.Hand != nil {
			seat.Hand = tile.Strings(sv.Hand)
			if s == Human {
				seat.HandGroups = apiview.HandGroups(sv.Hand, len(sv.Melds))
			}
		}
		if sv.Drawn != nil {
			d := sv.Drawn.String()
			seat.Drawn = &d
		}
		st.Seats[s] = seat
	}
	events, marks := m.game.Events(m.since), m.game.Round.EventMarks()
	from := len(marks) - len(events)
	st.EventsFrom, st.EventsWall = from, st.WallRemaining
	if len(events) > 0 {
		st.EventsWall = marks[from].DrawsBefore
	}
	st.Events = reportEvents(events, marks[from:], m.shownKanDora, st.DoraIndicators)

	me := v.Seats[Human]
	visible := v.Visible()
	st.Remaining = apiview.Remaining(&visible)
	melds := fixedMelds(me.Melds)
	han := m.hanFor(melds)
	yourTurn := v.Phase == game.PhaseDiscard && v.Actor == Human
	if !yourTurn || me.Drawn != nil {
		c := tile.CountsOf(me.Hand)
		res := m.analyze(c, melds)
		st.Analysis = apiview.Rows(res, &visible, han)
		st.Combos = apiview.Combos(m.combos(c, melds, res), &visible)
	}
	if yourTurn {
		all := slices.Clone(me.Hand)
		if me.Drawn != nil { // no drawn tile right after a call
			all = append(all, *me.Drawn)
		}
		c := tile.CountsOf(all)
		byDiscard := map[string][]apiview.YakuRow{}
		// A red five and a plain one leave the same hand: the first key of
		// each kind is computed, any other shares its rows.
		var first [tile.NumKinds]string
		for _, t := range all {
			key := t.String()
			if _, done := byDiscard[key]; done || !slices.Contains(st.Legal.Discards, key) {
				continue
			}
			if k := first[t.Kind]; k != "" {
				byDiscard[key], st.ByDiscard[key], st.CombosByDiscard[key] = byDiscard[k], st.ByDiscard[k], st.CombosByDiscard[k]
				continue
			}
			first[t.Kind] = key
			c[t.Kind]--
			res := m.analyze(c, melds)
			byDiscard[key] = apiview.Rows(res, &visible, han)
			st.ByDiscard[key] = apiview.DiscardRows(byDiscard[key])
			st.CombosByDiscard[key] = apiview.Combos(m.combos(c, melds, res), &visible)
			c[t.Kind]++
		}
		if me.Drawn == nil { // right after a call: the hand must still discard
			st.Analysis = bestRows(byDiscard, st.Legal.Discards)
			st.Combos = bestCombos(st.CombosByDiscard, st.Legal.Discards)
		}
	}
	st.History = slices.Clone(m.history)
	st.Result = result(v.Result)
	return st
}

// reportEvents turns events and their marks into the response's events.
// Each carries the kan dora indicators turned over with it beyond the
// first `shown`, which the human has already seen. Any turned over after
// the last mark (an added kan completing once the other seats decline to
// rob it) go on the last event: the response's new_dora_indicators add up
// to indicators[1+shown:], and none is reported twice.
func reportEvents(events []game.Action, marks []game.EventMark, shown int, indicators []string) []Event {
	out := []Event{}
	for i, a := range events {
		mark := marks[i]
		e := Event{Seat: a.Seat, Type: a.Type, Tile: a.Tile, Tiles: a.Tiles, WallRemaining: mark.DrawsLeft}
		if mark.KanDora > shown {
			e.NewDoraIndicators = slices.Clone(indicators[1+shown : 1+mark.KanDora])
			shown = mark.KanDora
		}
		out = append(out, e)
	}
	if n := len(out); n > 0 && len(indicators)-1 > shown {
		last := &out[n-1]
		last.NewDoraIndicators = append(last.NewDoraIndicators, indicators[1+shown:]...)
	}
	return out
}

// bestRows is the analysis of a hand that must discard before it can win
// (right after a pon or chii): each row is the row of the legal discard
// with the lowest shanten, then the most ukeire, then the first in
// discards order; impossible rows lose to any possible one.
func bestRows(byDiscard map[string][]apiview.YakuRow, discards []string) []apiview.YakuRow {
	var out []apiview.YakuRow
	for _, d := range discards {
		rows := byDiscard[d]
		if out == nil {
			out = slices.Clone(rows)
			continue
		}
		for i, r := range rows {
			if better(r, out[i]) {
				out[i] = r
			}
		}
	}
	if out == nil {
		out = []apiview.YakuRow{}
	}
	return out
}

// bestCombos is the combos of a hand that must discard before it can win:
// those of the legal discard whose first combo ranks best (lowest
// yakushanten.ComboRank, then more han, then the highest ukeire_total, then
// the first in discards order).
func bestCombos(byDiscard map[string][]apiview.ComboRow, discards []string) []apiview.ComboRow {
	var best []apiview.ComboRow
	for _, d := range discards {
		cs := byDiscard[d]
		if len(cs) == 0 {
			continue
		}
		if len(best) == 0 {
			best = cs
			continue
		}
		a, b := cs[0], best[0]
		ra, rb := yakushanten.ComboRank(a.Han, a.Shanten), yakushanten.ComboRank(b.Han, b.Shanten)
		if ra < rb || (ra == rb && (a.Han > b.Han || (a.Han == b.Han && a.UkeireTotal > b.UkeireTotal))) {
			best = cs
		}
	}
	if best == nil {
		best = []apiview.ComboRow{}
	}
	return best
}

func better(a, b apiview.YakuRow) bool {
	switch {
	case a.Shanten == nil:
		return false
	case b.Shanten == nil || *a.Shanten != *b.Shanten:
		return b.Shanten == nil || *a.Shanten < *b.Shanten
	}
	return a.UkeireTotal > b.UkeireTotal
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
		Pao: append([]game.Pao{}, res.Pao...),
	}
	if w := res.Win; w != nil {
		t := res.WinTile.String()
		out.WinTile = &t
		out.Yaku = w.Yaku
		out.Han, out.Fu, out.Dora, out.UraDora = w.HanTotal, w.Fu, w.Dora, w.UraDora
	}
	return out
}
