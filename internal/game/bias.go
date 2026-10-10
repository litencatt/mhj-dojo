package game

import (
	"encoding/binary"
	"hash/fnv"

	"github.com/litencatt/mhj-dojo/internal/shanten"
	"github.com/litencatt/mhj-dojo/internal/tile"
	"github.com/litencatt/mhj-dojo/internal/wall"
)

// biasMemo bounds the shanten memo a round keeps for DrawBias.
const biasMemo = 1_000

// biasDraw applies SeatConfig.DrawBias to seat's live-wall draw just taken:
// when the seat is not in riichi, the draw does not lower its shanten and
// the chance hits, the drawn tile swaps places with the next live-wall tile
// that does, as a summon does. The chance is a hash of the wall's seed, the
// draw and the seat, so a round replays exactly; nothing of it is logged.
func (r *Round) biasDraw(seat int) {
	p := &r.players[seat]
	bias := r.seats.DrawBias[seat]
	if bias <= 0 || p.riichi || r.draws >= wall.LiveDraws4-r.kans {
		return
	}
	var b [24]byte
	binary.BigEndian.PutUint64(b[0:], uint64(r.wall.Seed()))
	binary.BigEndian.PutUint64(b[8:], uint64(r.draws))
	binary.BigEndian.PutUint64(b[16:], uint64(seat))
	h := fnv.New64a()
	h.Write(b[:])
	if int(h.Sum64()%100) >= bias {
		return
	}
	c := tile.CountsOf(p.hand)
	target := shanten.NormalTarget
	target.Melds -= len(p.melds)
	if r.biasEng == nil {
		r.biasEng = shanten.NewEngineGen(biasMemo)
	}
	ev := r.biasEng.Evaluate(&c, &target)
	var useful [tile.NumKinds]bool
	ev.Ukeire(&useful)
	if len(p.melds) == 0 {
		shanten.Lowest(&c, ev.Dist-1, &useful)
	}
	if useful[p.drawn.Kind] {
		return
	}
	for k := r.draws; k < wall.LiveDraws4-r.kans; k++ {
		if t, _ := r.wall.Draw4(k); useful[t.Kind] {
			r.wall = r.wall.Swapped(r.draws-1, k)
			t, _ = r.wall.Draw4(r.draws - 1)
			p.drawn = &t
			return
		}
	}
}
