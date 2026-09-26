package session

import (
	"github.com/litencatt/mhj2/internal/advice"
	"github.com/litencatt/mhj2/internal/apiview"
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

	visible := s.visibleAt(cur, path)
	var discards []string
	for _, n := range path {
		if n.discard != nil {
			discards = append(discards, n.discard.String())
		}
	}
	st := State{
		SessionID:      s.id,
		Seed:           s.wall.Seed(),
		MaxTurns:       s.maxTurns,
		RoundWind:      winds.Round.String(),
		SeatWind:       winds.Seat.String(),
		NodeID:         cur.id,
		Turn:           cur.turn,
		Status:         cur.status,
		Hand:           tile.Strings(cur.hand),
		HandGroups:     apiview.HandGroups(cur.hand, 0),
		Discards:       append([]string{}, discards...),
		DoraIndicators: tile.Strings(dora),
		Dora:           apiview.DoraKinds(dora),
		// Ura dora are revealed only once the game has ended.
		UraDoraIndicators: []string{},
		UraDora:           []string{},
		ByDiscard:         map[string][]apiview.YakuRow{},
		CombosByDiscard:   map[string][]apiview.ComboRow{},
		Win:               cur.win,
	}
	if cur.status != StatusPlaying {
		ura := s.wall.UraDoraIndicators()
		st.UraDoraIndicators = tile.Strings(ura)
		st.UraDora = apiview.DoraKinds(ura)
	}
	drawsTaken := cur.turn
	if d, ok := s.drawn(cur); ok {
		st.Drawn = strPtr(&d)
		drawsTaken++
	} else if cur.status == StatusTsumo {
		drawsTaken++
	}
	st.WallRemaining = wall.LiveDraws - drawsTaken

	st.Analysis = rows(s.nodeAnalysis(cur), &visible)
	st.Combos = apiview.Combos(s.nodeCombos(cur), &visible)
	if d, ok := s.drawn(cur); ok {
		all := append(append([]tile.Tile{}, cur.hand...), d)
		c := tile.CountsOf(all)
		st.CanTsumo = yaku.IsComplete(c)
		if cur.byDiscard == nil {
			cur.byDiscard = map[tile.Kind][]yakushanten.Result{}
		}
		if cur.combosByDiscard == nil {
			cur.combosByDiscard = map[tile.Kind][]yakushanten.Combo{}
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
			combos, ok := cur.combosByDiscard[t.Kind]
			if !ok {
				c[t.Kind]--
				combos = s.combos(c, res)
				c[t.Kind]++
				cur.combosByDiscard[t.Kind] = combos
			}
			st.CombosByDiscard[key] = apiview.Combos(combos, &visible)
		}
		st.Advice = s.nodeAdvice(cur, path)
	}
	st.DiscardReview = s.nodeReview(cur, path)

	for _, n := range path {
		h := apiview.HistoryEntry{NodeID: n.id, Turn: n.turn, Draw: strPtr(n.draw), Discard: strPtr(n.discard), Shanten: map[string]*int{}}
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
			tn.NormalShanten = s.nodeNormalShanten(n)
		}
		st.Tree = append(st.Tree, tn)
	}

	// The full per-yaku analysis (and, for the old current node, the
	// per-discard preview) is only needed above for the current node and
	// its history path; free it from every other node that held it after
	// the previous call (see docs/api.md "Memory").
	s.pruneAnalysisCache(path, cur)
	return st
}

// visibleAt returns the tiles visible at a node: hand, pending draw (or
// winning tile), path discards and dora indicators. path is the node's path
// from the root.
func (s *Session) visibleAt(n *node, path []*node) tile.Counts {
	visible := tile.CountsOf(n.hand)
	for _, p := range path {
		if p.discard != nil {
			visible[p.discard.Kind]++
		}
	}
	for _, d := range s.wall.DoraIndicators() {
		visible[d.Kind]++
	}
	if d, ok := s.drawn(n); ok {
		visible[d.Kind]++
	} else if n.status == StatusTsumo {
		visible[n.draw.Kind]++
	}
	return visible
}

// nodeReview returns the review of the discard that led to n, the last node
// of path, computing it from the parent's advice if Replay left it pending.
func (s *Session) nodeReview(n *node, path []*node) *advice.Review {
	if n.reviewPending {
		parent := path[len(path)-2]
		n.review = s.nodeAdvice(parent, path[:len(path)-1]).Review(*n.discard)
		n.reviewPending = false
	}
	return n.review
}

// nodeAdvice returns the advice for a playing node's discard (nil at other
// nodes), filling in its per-discard analysis as needed. Both stay cached on
// the node until pruneAnalysisCache drops them. path is the node's path from
// the root.
func (s *Session) nodeAdvice(n *node, path []*node) *advice.Advice {
	if n.advice != nil {
		return n.advice
	}
	d, ok := s.drawn(n)
	if !ok {
		return nil
	}
	tiles := append(append([]tile.Tile{}, n.hand...), d)
	c := tile.CountsOf(tiles)
	if n.byDiscard == nil {
		n.byDiscard = map[tile.Kind][]yakushanten.Result{}
	}
	for _, t := range tiles {
		if _, ok := n.byDiscard[t.Kind]; !ok {
			c[t.Kind]--
			n.byDiscard[t.Kind] = s.analyze(c)
			c[t.Kind]++
		}
	}
	var dora []tile.Kind
	for _, ind := range s.wall.DoraIndicators() {
		dora = append(dora, tile.DoraFromIndicator(ind.Kind))
	}
	s.resetAnalyzerIfFull()
	n.advice = advice.Compute(advice.Input{
		Tiles: tiles, Visible: s.visibleAt(n, path), Dora: dora, Turn: n.turn, MaxTurns: s.maxTurns,
		ByDiscard: n.byDiscard, Han: func(key string) int { return yaku.HanFor(key, winds) }, Analyzer: s.analyzer,
	})
	return n.advice
}

func shantenPtr(r yakushanten.Result) *int { return apiview.ShantenOf(r) }

func rows(res []yakushanten.Result, visible *tile.Counts) []apiview.YakuRow {
	return apiview.Rows(res, visible, func(key string) int { return yaku.HanFor(key, winds) })
}
