// Package apiview holds the JSON pieces shared by the practice and game APIs
// (docs/api.md): per-yaku analysis rows, the shanten history and dora kinds.
package apiview

import (
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

// YakuRow is one row of the per-yaku analysis.
type YakuRow struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Yakuman     bool     `json:"yakuman"`
	Han         int      `json:"han"` // han for the hand, open or closed (13 for yakuman); 0 for the normal row
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

// HistoryEntry is one point of the shanten history: a practice node on the
// path from the root, or a game turn (node_id = turn, no draw or discard).
type HistoryEntry struct {
	NodeID  int             `json:"node_id"`
	Turn    int             `json:"turn"`
	Draw    *string         `json:"draw"`
	Discard *string         `json:"discard"`
	Shanten map[string]*int `json:"shanten"`
}

// Rows converts analysis results to API rows: han comes from han(key) and
// each accepting tile's remaining count is 4 minus the visible copies.
func Rows(res []yakushanten.Result, visible *tile.Counts, han func(key string) int) []YakuRow {
	out := make([]YakuRow, len(res))
	for i, r := range res {
		row := YakuRow{Key: r.Key, Name: r.Name, Yakuman: r.Yakuman, Han: han(r.Key), Shanten: ShantenOf(r), Approx: r.Approx, Ukeire: []Ukeire{}}
		for _, k := range r.Ukeire {
			rem := max(4-visible[k], 0)
			row.Ukeire = append(row.Ukeire, Ukeire{Tile: k.String(), Remaining: rem})
			row.UkeireTotal += rem
		}
		out[i] = row
	}
	return out
}

// ShantenOf returns a row's shanten, or nil when the yaku is impossible.
func ShantenOf(r yakushanten.Result) *int {
	if !r.Possible {
		return nil
	}
	v := r.Shanten
	return &v
}

// ShantenMap returns each row's shanten by key, for a history entry.
func ShantenMap(res []yakushanten.Result) map[string]*int {
	m := make(map[string]*int, len(res))
	for _, r := range res {
		m[r.Key] = ShantenOf(r)
	}
	return m
}

// DoraKinds returns the dora kind each indicator points to (next tile,
// wrapping within the suit or wind/dragon group), without red notation.
func DoraKinds(indicators []tile.Tile) []string {
	out := make([]string, len(indicators))
	for i, ind := range indicators {
		out[i] = tile.DoraFromIndicator(ind.Kind).String()
	}
	return out
}
