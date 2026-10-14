package problem

import (
	"fmt"
	"slices"
	"strings"

	"github.com/litencatt/mhj-dojo/internal/apiview"
	"github.com/litencatt/mhj-dojo/internal/cpu"
	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/yaku"
)

// oshihikiLevel is the filter of one oshihiki level (docs/problems.md).
type oshihikiLevel struct {
	riichi    int // the fewest other seats in riichi
	maxRiichi int // the most
	genbutsu  genbutsu
}

// genbutsu is whether a level's hand holds a tile safe against every
// riichi (summed Danger 0): a genbutsu, or a tile passed after the riichi.
type genbutsu int

const (
	anyGenbutsu  genbutsu = iota
	withGenbutsu          // the answer is a safe tile, found in the rivers
	noGenbutsu            // read from suji, kabe or the honors seen
)

var oshihikiLevels = []oshihikiLevel{
	{riichi: 1, maxRiichi: 1, genbutsu: withGenbutsu},
	{riichi: 1, maxRiichi: 1, genbutsu: noGenbutsu},
	{riichi: 2, maxRiichi: 3, genbutsu: anyGenbutsu},
}

// maxSafest bounds the kinds tied safest: a hand of many safe kinds asks
// nothing.
const maxSafest = 2

// SeatPosition is one seat at the table of an oshihiki problem, as a game's
// seat (docs/api.md "Games"): its wind, riichi, river and melds.
type SeatPosition struct {
	Seat   int             `json:"seat"`
	Wind   string          `json:"wind"`
	Riichi bool            `json:"riichi"`
	River  []RiverPosition `json:"river"`
	Melds  []MeldPosition  `json:"melds"`
}

// RiverPosition is a discard: riichi marks the declaration tile, called a
// tile another seat took into a meld.
type RiverPosition struct {
	Tile   string `json:"tile"`
	Riichi bool   `json:"riichi"`
	Called bool   `json:"called"`
}

// MeldPosition is a called meld or a concealed kan, as a game's.
type MeldPosition struct {
	Type  string   `json:"type"`
	Tiles []string `json:"tiles"`
	From  int      `json:"from"`
	Added bool     `json:"added"`
}

// player plays every seat of the oshihiki rounds, built on first use. One
// player serves every problem so that its shanten memo stays warm: the memo
// is a cache, so the moves do not depend on it. The caller holds mu.
var player *cpu.Player

func oshihikiPlayer() *cpu.Player {
	if player == nil {
		player = cpu.New()
	}
	return player
}

// oshihiki plays the round of src with the CPU in every seat (seat 0 as
// the normal CPU too), and returns the first of seat 0's discards, with
// another seat in riichi, that passes the level's filter; nil if the round
// ends first. The caller holds mu.
func oshihiki(level int, src int64) *Problem {
	lv := oshihikiLevels[level-1]
	player := oshihikiPlayer()
	g := game.NewGame(src, player)
	for g.Round.Phase() != game.PhaseEnded {
		r := g.Round
		v := r.ViewFor(g.Human)
		legal := r.LegalFor(g.Human)
		if p := oshihikiAt(lv, v, legal); p != nil {
			return p
		}
		if err := g.Act(player.Decide(v, legal)); err != nil {
			return nil
		}
	}
	return nil
}

// oshihikiAt is the problem of seat 0's decision v, or nil if it is not
// one: a discard (not a call or a win), seat 0 closed and not in riichi,
// lv.riichi other seats in riichi, and the safest kinds (summed Danger over
// them) few and as lv asks.
func oshihikiAt(lv oshihikiLevel, v game.View, legal game.Legal) *Problem {
	me := v.Seats[v.Viewer]
	if v.Phase != game.PhaseDiscard || v.Actor != v.Viewer || me.Riichi || len(me.Melds) > 0 || me.Drawn == nil || legal.Tsumo {
		return nil
	}
	var riichi []int
	for _, s := range v.Seats {
		if s.Seat != v.Viewer && s.Riichi {
			riichi = append(riichi, s.Seat)
		}
	}
	if len(riichi) < lv.riichi || len(riichi) > lv.maxRiichi {
		return nil
	}
	ranking := dangerRanking(v, riichi, append(slices.Clone(me.Hand), *me.Drawn))
	best := *ranking[0].Danger
	safest := 0
	for _, e := range ranking {
		if *e.Danger == best {
			safest++
		}
	}
	if safest > maxSafest || safest == len(ranking) || lv.genbutsu == withGenbutsu && best > 0 || lv.genbutsu == noGenbutsu && best == 0 {
		return nil
	}
	visible := v.Visible()
	pos := Position{
		Hand:           tile.Strings(me.Hand),
		Drawn:          new(me.Drawn.String()),
		DoraIndicators: tile.Strings(v.DoraIndicators),
		Junme:          len(me.River) + 1,
		RoundWind:      v.RoundWind.String(),
		SeatWind:       me.Wind.String(),
		Discards:       riverTiles(me.River),
		Remaining:      apiview.Remaining(&visible),
		Seats:          seatPositions(v),
	}
	tiles := append(slices.Clone(me.Hand), *me.Drawn)
	return &Problem{Position: pos, Choose: "one", answer: answer{tiles: tiles, view: &v, riichi: riichi}}
}

// dangerRanking ranks the kinds of tiles by the danger of discarding them,
// summed over the riichi seats (cpu.Danger, 0 to cpu.MaxDanger each),
// safest first; ties keep kind order. Each holds its tile (the hand's first
// of the kind, a plain five before a red one), its rank, its danger and
// its reasons against each riichi.
func dangerRanking(v game.View, riichi []int, tiles []tile.Tile) []Eval {
	tiles = slices.Clone(tiles)
	slices.SortFunc(tiles, func(a, b tile.Tile) int { return tileOrder(a) - tileOrder(b) })
	var out []Eval
	seen := map[tile.Kind]bool{}
	for _, t := range tiles {
		if seen[t.Kind] {
			continue
		}
		seen[t.Kind] = true
		d := 0
		var why []string
		for _, s := range riichi {
			d += cpu.Danger(v, s, t.Kind)
			r := reason(v, s, t.Kind)
			if len(riichi) > 1 {
				r = seatName(v.Viewer, s) + "に" + r
			}
			why = append(why, r)
		}
		out = append(out, Eval{Tile: t.String(), Danger: new(d), Reason: strings.Join(why, "、")})
	}
	slices.SortStableFunc(out, func(a, b Eval) int { return *a.Danger - *b.Danger })
	for i := range out {
		out[i].Rank = 1
		if i > 0 {
			out[i].Rank = out[i-1].Rank
			if *out[i].Danger != *out[i-1].Danger {
				out[i].Rank = i + 1
			}
		}
	}
	return out
}

// tileOrder sorts tiles by kind, a plain five before a red one.
func tileOrder(t tile.Tile) int {
	o := int(t.Kind) * 2
	if t.Red {
		o++
	}
	return o
}

// reason says why k is as safe as cpu.Danger scores it against seat, the
// way a player reads it: 現物, 筋, ノーチャンス (a wall of 4 in sight), an
// honor's copies in sight, 片筋 or 無筋.
func reason(v game.View, seat int, k tile.Kind) string {
	safe := safeAgainst(v, seat)
	visible := v.Visible()
	if safe[k] {
		if inRiver(v.Seats[seat].River, k) {
			return "現物"
		}
		return "リーチ後に通った牌"
	}
	if k.IsHonor() {
		switch visible[k] {
		case 4:
			return "4枚見えている字牌"
		case 3:
			return "3枚見えている字牌（単騎だけ）"
		case 2:
			return "2枚見えている字牌"
		}
		return "見えていない字牌"
	}
	n := k.Num()
	var low, high side
	if n >= 4 {
		low = sideOf(safe[k-3], visible[k-1] == 4 || visible[k-2] == 4)
	}
	if n <= 6 {
		high = sideOf(safe[k+3], visible[k+1] == 4 || visible[k+2] == 4)
	}
	sides := []side{}
	if n >= 4 {
		sides = append(sides, low)
	}
	if n <= 6 {
		sides = append(sides, high)
	}
	open, suji, wall := 0, 0, 0
	for _, s := range sides {
		switch s {
		case sideOpen:
			open++
		case sideSuji:
			suji++
		case sideWall:
			wall++
		}
	}
	switch {
	case open == 0 && wall == 0:
		return "筋"
	case open == 0 && suji == 0:
		return "ノーチャンス（壁）"
	case open == 0:
		return "筋とノーチャンス"
	case open < len(sides):
		return "片筋"
	case n == 1 || n == 9:
		return "無筋の端牌"
	case n == 2 || n == 8:
		return "無筋の2・8牌"
	}
	return "無筋の中張牌"
}

// side is how one two-sided wait on a number tile stands: still open, ruled
// out by suji (its other tile safe) or by a wall (one of its two tiles all
// in sight).
type side int

const (
	sideOpen side = iota
	sideSuji
	sideWall
)

func sideOf(suji, wall bool) side {
	switch {
	case suji:
		return sideSuji
	case wall:
		return sideWall
	}
	return sideOpen
}

// safeAgainst is cpu's safe kinds against seat in riichi: its river and
// every tile discarded after its declaration.
func safeAgainst(v game.View, seat int) [tile.NumKinds]bool {
	var safe [tile.NumKinds]bool
	declared := -1
	for _, rt := range v.Seats[seat].River {
		safe[rt.Tile.Kind] = true
		if rt.Riichi {
			declared = rt.Order
		}
	}
	if declared < 0 {
		return safe
	}
	for _, o := range v.Seats {
		for _, rt := range o.River {
			if rt.Order > declared {
				safe[rt.Tile.Kind] = true
			}
		}
	}
	return safe
}

func inRiver(river []game.RiverTile, k tile.Kind) bool {
	return slices.ContainsFunc(river, func(rt game.RiverTile) bool { return rt.Tile.Kind == k })
}

// seatName names seat as viewer sees it: 下家, 対面 or 上家.
func seatName(viewer, seat int) string {
	return [...]string{"自分", "下家", "対面", "上家"}[(seat-viewer+4)%4]
}

// gradeOshihiki grades a discard: correct when no tile of the hand is
// safer (summed Danger over the riichi seats).
func (p *Problem) gradeOshihiki(ans []tile.Tile) (*Result, error) {
	if len(ans) != 1 {
		return nil, fmt.Errorf("%w: answer must be one tile", ErrInvalid)
	}
	a := p.answer
	ranking := dangerRanking(*a.view, a.riichi, a.tiles)
	var mine Eval
	var best []string
	for _, e := range ranking {
		if e.Rank == 1 {
			best = append(best, e.Tile)
		}
		if kindOf(e.Tile) == ans[0].Kind {
			mine = e
		}
	}
	mine.Tile = ans[0].String()
	correct := mine.Rank == 1
	return &Result{
		ID:      p.ID,
		Correct: correct,
		Answer:  []Eval{mine},
		Best:    best,
		Ranking: ranking,
		Text:    oshihikiText(correct, mine, ranking, a.riichi, *a.view),
	}, nil
}

// oshihikiText explains the grading: the verdict, the safest tiles and
// why, and, for a wrong answer, why it was more dangerous.
func oshihikiText(correct bool, mine Eval, ranking []Eval, riichi []int, v game.View) string {
	var b strings.Builder
	if correct {
		b.WriteString("正解。")
	} else {
		fmt.Fprintf(&b, "%s は%s（危険度 %d）。", tileName(kindOf(mine.Tile)), mine.Reason, *mine.Danger)
	}
	var safest []string
	for _, e := range ranking {
		if e.Rank == 1 {
			safest = append(safest, fmt.Sprintf("%s（%s）", tileName(kindOf(e.Tile)), e.Reason))
		}
	}
	fmt.Fprintf(&b, "最も安全なのは %s。", strings.Join(safest, "・"))
	names := make([]string, len(riichi))
	for i, s := range riichi {
		names[i] = seatName(v.Viewer, s)
	}
	fmt.Fprintf(&b, "この問題は、%sのリーチへの放銃の危険度だけで比べています（押すか降りるかと、自分の手は考えません）。", strings.Join(names, "と"))
	return b.String()
}

func seatPositions(v game.View) []SeatPosition {
	out := make([]SeatPosition, len(v.Seats))
	for i, s := range v.Seats {
		sp := SeatPosition{Seat: s.Seat, Wind: s.Wind.String(), Riichi: s.Riichi, River: []RiverPosition{}, Melds: []MeldPosition{}}
		for _, rt := range s.River {
			sp.River = append(sp.River, RiverPosition{Tile: rt.Tile.String(), Riichi: rt.Riichi, Called: rt.Called})
		}
		for _, m := range s.Melds {
			sp.Melds = append(sp.Melds, MeldPosition{Type: meldType(m), Tiles: tile.Strings(m.Tiles), From: m.From, Added: m.Added})
		}
		out[i] = sp
	}
	return out
}

func riverTiles(river []game.RiverTile) []string {
	out := make([]string, len(river))
	for i, rt := range river {
		out[i] = rt.Tile.String()
	}
	return out
}

// kindOf is the kind of a tile written by the engine.
func kindOf(s string) tile.Kind {
	t, _ := tile.Parse(s)
	return t.Kind
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
