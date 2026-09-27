package session

import (
	"github.com/litencatt/mhj-dojo/internal/advice"
	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// State is the JSON view of a session at its current node (docs/api.md).
type State struct {
	SessionID         string                          `json:"session_id"`
	Seed              int64                           `json:"seed"`
	MaxTurns          int                             `json:"max_turns"`
	RoundWind         string                          `json:"round_wind"`
	SeatWind          string                          `json:"seat_wind"`
	NodeID            int                             `json:"node_id"`
	Turn              int                             `json:"turn"`
	Status            string                          `json:"status"`
	Hand              []string                        `json:"hand"`
	HandGroups        []apiview.HandGroup             `json:"hand_groups"` // blocks of hand (docs/api.md)
	Drawn             *string                         `json:"drawn"`
	Discards          []string                        `json:"discards"`
	DoraIndicators    []string                        `json:"dora_indicators"`
	Dora              []string                        `json:"dora"`                // dora kinds pointed to by dora_indicators
	UraDoraIndicators []string                        `json:"ura_dora_indicators"` // empty until the game ends (tsumo or exhausted)
	UraDora           []string                        `json:"ura_dora"`            // kinds pointed to by ura_dora_indicators
	WallRemaining     int                             `json:"wall_remaining"`
	CanTsumo          bool                            `json:"can_tsumo"`
	Analysis          []apiview.YakuRow               `json:"analysis"`
	ByDiscard         map[string][]apiview.DiscardRow `json:"by_discard"`        // name, yakuman and han as in analysis
	Combos            []apiview.ComboRow              `json:"combos"`            // best yaku combinations of hand (docs/api.md)
	CombosByDiscard   map[string][]apiview.ComboRow   `json:"combos_by_discard"` // combos after each discard
	Remaining         map[string]int                  `json:"remaining"`         // unseen copies of each tile kind, for the ukeire lists
	History           []apiview.HistoryEntry          `json:"history"`
	NodeCount         int                             `json:"node_count"` // nodes in the whole tree
	Tree              []TreeNode                      `json:"tree"`       // the tree's nodes from View.TreeFrom on
	Win               *Win                            `json:"win"`
	Advice            *advice.Advice                  `json:"advice"`         // only when status == playing
	DiscardReview     *advice.Review                  `json:"discard_review"` // the discard that led here, vs the best
}

// View picks the optional parts of a State (docs/api.md "View options").
// The zero View is the whole state.
type View struct {
	// NoAdvice leaves advice and discard_review out (null). A discard made
	// with it leaves its review to be computed the next time its node is
	// shown with advice, as Replay does.
	NoAdvice bool
	// TreeFrom leaves out the tree's nodes with a lower id: a client
	// holding the first TreeFrom nodes (a node never changes once made)
	// asks for the rest only.
	TreeFrom int
}

// TreeNode is one node of the whole branch tree.
type TreeNode struct {
	NodeID        int     `json:"node_id"`
	ParentID      *int    `json:"parent_id"`
	Turn          int     `json:"turn"`
	Draw          *string `json:"draw"`
	Discard       *string `json:"discard"`
	Status        string  `json:"status"`
	NormalShanten *int    `json:"normal_shanten"`
}

// Win describes a tsumo win.
type Win struct {
	Tiles    []string    `json:"tiles"`
	Yaku     []yaku.Yaku `json:"yaku"`
	Dora     int         `json:"dora"`
	HanTotal int         `json:"han_total"`
}
