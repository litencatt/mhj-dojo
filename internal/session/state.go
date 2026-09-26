package session

import (
	"github.com/litencatt/mhj2/internal/advice"
	"github.com/litencatt/mhj2/internal/apiview"
	"github.com/litencatt/mhj2/internal/yaku"
)

// State is the JSON view of a session at its current node (docs/api.md).
type State struct {
	SessionID         string                        `json:"session_id"`
	Seed              int64                         `json:"seed"`
	MaxTurns          int                           `json:"max_turns"`
	RoundWind         string                        `json:"round_wind"`
	SeatWind          string                        `json:"seat_wind"`
	NodeID            int                           `json:"node_id"`
	Turn              int                           `json:"turn"`
	Status            string                        `json:"status"`
	Hand              []string                      `json:"hand"`
	HandGroups        []apiview.HandGroup           `json:"hand_groups"` // blocks of hand (docs/api.md)
	Drawn             *string                       `json:"drawn"`
	Discards          []string                      `json:"discards"`
	DoraIndicators    []string                      `json:"dora_indicators"`
	Dora              []string                      `json:"dora"`                // dora kinds pointed to by dora_indicators
	UraDoraIndicators []string                      `json:"ura_dora_indicators"` // empty until the game ends (tsumo or exhausted)
	UraDora           []string                      `json:"ura_dora"`            // kinds pointed to by ura_dora_indicators
	WallRemaining     int                           `json:"wall_remaining"`
	CanTsumo          bool                          `json:"can_tsumo"`
	Analysis          []apiview.YakuRow             `json:"analysis"`
	ByDiscard         map[string][]apiview.YakuRow  `json:"by_discard"`
	Combos            []apiview.ComboRow            `json:"combos"`            // best yaku combinations of hand (docs/api.md)
	CombosByDiscard   map[string][]apiview.ComboRow `json:"combos_by_discard"` // combos after each discard
	History           []apiview.HistoryEntry        `json:"history"`
	Tree              []TreeNode                    `json:"tree"`
	Win               *Win                          `json:"win"`
	Advice            *advice.Advice                `json:"advice"`         // only when status == playing
	DiscardReview     *advice.Review                `json:"discard_review"` // the discard that led here, vs the best
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
