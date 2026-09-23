package session

import (
	"github.com/litencatt/mhj2/internal/tile"
	"github.com/litencatt/mhj2/internal/wall"
	"github.com/litencatt/mhj2/internal/yaku"
	"github.com/litencatt/mhj2/internal/yakushanten"
)

func (s *Session) path(n *node) []*node {
	var p []*node
	for ; n != nil; n = s.parentOf(n) {
		p = append(p, n)
	}
	for i, j := 0, len(p)-1; i < j; i, j = i+1, j-1 {
		p[i], p[j] = p[j], p[i]
	}
	return p
}

func (s *Session) parentOf(n *node) *node {
	if n.parent < 0 {
		return nil
	}
	return s.nodes[n.parent]
}

func strPtr(t *tile.Tile) *string {
	if t == nil {
		return nil
	}
	v := t.String()
	return &v
}

func intPtr(v int) *int { return &v }

func (s *Session) state() State {
	cur := s.nodes[s.current]
	path := s.path(cur)
	dora := s.wall.DoraIndicators()

	// Visible tiles: hand, pending draw (or winning tile), path discards, dora indicators.
	visible := tile.CountsOf(cur.hand)
	var discards []string
	for _, n := range path {
		if n.discard != nil {
			discards = append(discards, n.discard.String())
			visible[n.discard.Kind]++
		}
	}
	for _, d := range dora {
		visible[d.Kind]++
	}
	st := State{
		SessionID:      s.id,
		Seed:           s.wall.Seed(),
		MaxTurns:       s.maxTurns,
		RoundWind:      roundWind.String(),
		SeatWind:       seatWind.String(),
		NodeID:         cur.id,
		Turn:           cur.turn,
		Status:         cur.status,
		Hand:           tile.Strings(cur.hand),
		Discards:       append([]string{}, discards...),
		DoraIndicators: tile.Strings(dora),
		ByDiscard:      map[string][]YakuRow{},
		Win:            cur.win,
	}
	drawsTaken := cur.turn
	if d, ok := s.drawn(cur); ok {
		st.Drawn = strPtr(&d)
		visible[d.Kind]++
		drawsTaken++
	} else if cur.status == StatusTsumo {
		visible[cur.draw.Kind]++
		drawsTaken++
	}
	st.WallRemaining = wall.LiveDraws - drawsTaken

	st.Analysis = rows(s.nodeAnalysis(cur), &visible)
	if d, ok := s.drawn(cur); ok {
		all := append(append([]tile.Tile{}, cur.hand...), d)
		c := tile.CountsOf(all)
		st.CanTsumo = yaku.IsComplete(c)
		if cur.byDiscard == nil {
			cur.byDiscard = map[tile.Kind][]yakushanten.Result{}
		}
		for _, t := range all {
			key := t.String()
			if _, done := st.ByDiscard[key]; done {
				continue
			}
			res, ok := cur.byDiscard[t.Kind]
			if !ok {
				c[t.Kind]--
				res = s.analyze(c)
				c[t.Kind]++
				cur.byDiscard[t.Kind] = res
			}
			st.ByDiscard[key] = rows(res, &visible)
		}
	}

	for _, n := range path {
		h := HistoryEntry{NodeID: n.id, Turn: n.turn, Draw: strPtr(n.draw), Discard: strPtr(n.discard), Shanten: map[string]*int{}}
		if n.status == StatusTsumo {
			for k, v := range n.winRows {
				h.Shanten[k] = intPtr(v)
			}
		} else {
			for _, r := range s.nodeAnalysis(n) {
				h.Shanten[r.Key] = shantenPtr(r)
			}
		}
		st.History = append(st.History, h)
	}

	for _, n := range s.nodes {
		tn := TreeNode{NodeID: n.id, Turn: n.turn, Draw: strPtr(n.draw), Discard: strPtr(n.discard), Status: n.status}
		if n.parent >= 0 {
			tn.ParentID = intPtr(n.parent)
		}
		if n.status == StatusTsumo {
			tn.NormalShanten = intPtr(-1) // complete hand, whatever its shape
		} else {
			tn.NormalShanten = shantenPtr(s.nodeAnalysis(n)[0])
		}
		st.Tree = append(st.Tree, tn)
	}
	return st
}

func shantenPtr(r yakushanten.Result) *int {
	if !r.Possible {
		return nil
	}
	return intPtr(r.Shanten)
}

func rows(res []yakushanten.Result, visible *tile.Counts) []YakuRow {
	out := make([]YakuRow, len(res))
	for i, r := range res {
		row := YakuRow{Key: r.Key, Name: r.Name, Yakuman: r.Yakuman, Han: yaku.ClosedHan(r.Key), Shanten: shantenPtr(r), Approx: r.Approx, Ukeire: []Ukeire{}}
		for _, k := range r.Ukeire {
			rem := max(4-visible[k], 0)
			row.Ukeire = append(row.Ukeire, Ukeire{Tile: k.String(), Remaining: rem})
			row.UkeireTotal += rem
		}
		out[i] = row
	}
	return out
}
