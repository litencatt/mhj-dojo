package session

import "github.com/litencatt/mhj2/internal/yaku"

// State is the JSON view of a session at its current node (docs/api.md).
type State struct {
	SessionID      string               `json:"session_id"`
	Seed           int64                `json:"seed"`
	MaxTurns       int                  `json:"max_turns"`
	RoundWind      string               `json:"round_wind"`
	SeatWind       string               `json:"seat_wind"`
	NodeID         int                  `json:"node_id"`
	Turn           int                  `json:"turn"`
	Status         string               `json:"status"`
	Hand           []string             `json:"hand"`
	Drawn          *string              `json:"drawn"`
	Discards       []string             `json:"discards"`
	DoraIndicators []string             `json:"dora_indicators"`
	WallRemaining  int                  `json:"wall_remaining"`
	CanTsumo       bool                 `json:"can_tsumo"`
	Analysis       []YakuRow            `json:"analysis"`
	ByDiscard      map[string][]YakuRow `json:"by_discard"`
	History        []HistoryEntry       `json:"history"`
	Tree           []TreeNode           `json:"tree"`
	Win            *Win                 `json:"win"`
}

// YakuRow is one row of the per-yaku analysis.
type YakuRow struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Shanten     *int     `json:"shanten"`
	Approx      bool     `json:"approx"`
	Ukeire      []Ukeire `json:"ukeire"`
	UkeireTotal int      `json:"ukeire_total"`
}

// Ukeire is an accepting tile type and how many copies remain unseen.
type Ukeire struct {
	Tile      string `json:"tile"`
	Remaining int    `json:"remaining"`
}

// HistoryEntry is one node on the path from the root to the current node.
type HistoryEntry struct {
	NodeID  int             `json:"node_id"`
	Turn    int             `json:"turn"`
	Draw    *string         `json:"draw"`
	Discard *string         `json:"discard"`
	Shanten map[string]*int `json:"shanten"`
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
