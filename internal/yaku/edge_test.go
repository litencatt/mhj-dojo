package yaku

import "testing"

// Standard-rule corner cases that sit between two readings of one hand.
func TestEvaluateReadingChoices(t *testing.T) {
	cases := []struct {
		name, hand, win string
		ctx             Context
		keys            string
		han             int
	}{
		// 22 33 44m 55 66 77p 88s is also seven pairs (tanyao + 2 han): ryanpeikou scores more.
		{"ryanpeikou beats seven pairs", "223344m556677p88s", "8s", Context{Ron: true}, "tanyao,ryanpeikou", 4},
		// 1112345 5678999m won on 1m: nine gates, not the pure form
		{"chuuren", "11123455678999m", "1m", Context{Ron: true}, "chuuren", 13},
		// the 13 tiles before the 5m were exactly 1112345678999m
		{"junsei chuuren", "11123455678999m", "5m", Context{Ron: true}, "chuuren", 26},
		// thirteen orphans: a win on the paired kind is the 13-sided wait
		{"kokushi 13-sided", "119m19p19s1234567z", "1m", Context{Ron: true}, "kokushi", 26},
		{"kokushi single wait", "119m19p19s1234567z", "7z", Context{Ron: true}, "kokushi", 13},
		// a value pair blocks pinfu even on a two-sided wait
		{"value pair is not pinfu", "234m567m345p678s55z", "4m", Context{Ron: true}, "", 0},
	}
	for _, tc := range cases {
		w := eval(t, tc.hand, tc.ctx, tc.win)
		if keys(w) != tc.keys || w.HanTotal != tc.han {
			t.Errorf("%s: got [%s] han=%d, want [%s] han=%d", tc.name, keys(w), w.HanTotal, tc.keys, tc.han)
		}
	}
}

func TestQuadIsNotTwoPairs(t *testing.T) {
	// 1111m is one kind, so this is not seven pairs; it is 11 + 123 123 456 456 ryanpeikou.
	c := "11112233445566m"
	w := eval(t, c, Context{Ron: true}, "6m")
	if keys(w) != "pinfu,ryanpeikou,chinitsu" || w.HanTotal != 10 {
		t.Fatalf("got [%s] han=%d, want [pinfu,ryanpeikou,chinitsu] han=10", keys(w), w.HanTotal)
	}
}
