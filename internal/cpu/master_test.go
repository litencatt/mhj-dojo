package cpu

import (
	"reflect"
	"testing"

	"github.com/litencatt/mhj-dojo/internal/game"
	"github.com/litencatt/mhj-dojo/internal/testmode"
	"github.com/litencatt/mhj-dojo/internal/tile"
)

// The master keeps a dora where the normal player, by tile order alone,
// lets it go.
func TestMasterKeepsDora(t *testing.T) {
	v := view("123m456m789p57s23z", "1p")
	v.DoraIndicators = []tile.Tile{mustTile("1z")} // 2z is dora
	if a := New().Decide(v, legal(v)); a.Tile != "2z" {
		t.Fatalf("normal: got %+v, want 2z (this test needs it to drop the dora)", a)
	}
	if a := NewMaster().Decide(v, legal(v)); a.Tile == "2z" {
		t.Errorf("master: dropped the dora: %+v", a)
	}
}

// The master stays dama on a closed tenpai worth 4 han or more without
// riichi; the normal player declares.
func TestMasterDama(t *testing.T) {
	v := view("1112345678999m", "1z")
	l := legal(v)
	l.Riichi = []string{"1z"}
	if a := New().Decide(v, l); a.Type != game.Riichi {
		t.Fatalf("normal: got %+v, want riichi", a)
	}
	if a := NewMaster().Decide(v, l); a.Type != game.Discard || a.Tile != "1z" {
		t.Errorf("master: got %+v, want a dama discard of 1z", a)
	}
}

// Whole games with four masters: legal moves only, and the same seed
// plays out the same.
func TestMasterSelfPlay(t *testing.T) {
	for seed := range testmode.N(int64(8), 2, 1) {
		var logs [2][][]game.Action
		for i := range logs {
			h := game.NewHanchan(seed, game.HanchanRule)
			m := NewMaster()
			playHanchan(t, h, [4]*Player{m, m, m, m})
			logs[i] = h.Logs()
		}
		if !reflect.DeepEqual(logs[0], logs[1]) {
			t.Fatalf("seed %d: logs differ", seed)
		}
	}
}
