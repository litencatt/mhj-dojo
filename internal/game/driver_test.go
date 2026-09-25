package game

import "testing"

// The driver stops only when the human must decide, and plays the human's
// forced tsumogiri in riichi.
func TestGameStopsForHuman(t *testing.T) {
	for seed := int64(0); seed < 50; seed++ {
		g := NewGame(seed, Tsumogiri{})
		for steps := 0; g.Round.Actor() >= 0; steps++ {
			if steps > 200 {
				t.Fatalf("seed %d: game does not end", seed)
			}
			if a := g.Round.Actor(); a != g.Human {
				t.Fatalf("seed %d: control returned while seat %d must act", seed, a)
			}
			l := g.Round.LegalFor(g.Human)
			var a Action
			switch {
			case l.Ron:
				a = Action{Type: Ron}
			case l.Tsumo:
				a = Action{Type: Tsumo}
			case l.Skip: // a pon or chii offer
				a = Action{Type: Skip}
			case len(l.Riichi) > 0:
				a = Action{Type: Riichi, Tile: l.Riichi[0]}
			default:
				a = Action{Type: Discard, Tile: l.Discards[len(l.Discards)-1]}
			}
			before := len(g.Round.Events())
			if err := g.Act(a); err != nil {
				t.Fatalf("seed %d: %v", seed, err)
			}
			if a.Type != Skip && len(g.Events(before)) == 0 {
				t.Fatalf("seed %d: no events after a move", seed)
			}
		}
		if g.Fallbacks != 0 {
			t.Fatalf("seed %d: %d CPU fallbacks", seed, g.Fallbacks)
		}
	}
}

func TestHumanRiichiIsAutoTsumogiri(t *testing.T) {
	r := tenpai0(t)
	g := &Game{Round: r, Human: 0, cpu: Tsumogiri{}}
	if err := g.Act(Action{Type: Riichi, Tile: "9s"}); err != nil {
		t.Fatal(err)
	}
	// The CPUs discard; seat 0 then draws. Unless it can win, its draws are
	// discarded for it, so control returns only on a win chance or the end.
	if g.Round.Actor() == 0 {
		if l := g.Round.LegalFor(0); !l.Tsumo && !l.Ron {
			t.Fatalf("control returned in riichi without a win: %+v", l)
		}
	}
	for _, rt := range r.players[0].river[1:] {
		if rt.Riichi {
			t.Fatal("riichi marked twice")
		}
	}
}
