package yakushanten

import (
	"slices"
	"testing"

	"github.com/litencatt/mhj2/internal/tile"
)

// Shorthand ukeire sets.
const (
	// every kind that can join a terminal/honor group
	yaochuNeighbours = "123789m123789p123789s1234567z"
	allTanyao        = "2345678m2345678p2345678s"
	allNumbers       = "123456789m123456789p123456789s"
	allYaochu        = "19m19p19s1234567z"
	singlesAndEmpty  = "*" // chiitoitsu: every kind held at most once
)

type rowCase struct {
	hand    string
	shanten int
	ukeire  string
	approx  bool
}

var handCases = map[string][]rowCase{
	"normal": {
		{"123456789m1234p", 0, "14p", false},
		{"123456789m11p45s", 0, "36s", false},
		{"123456789m1112p", 0, "23p", false},
		{"1112345678999m", 0, "123456789m", false},
		{"123m456p789s1122z", 0, "12z", false},
		{"123m456p789s11z13s", 0, "2s", false},
		{"123m456p7899s115z", 1, "6789s15z", false}, // 5z: 111z + 55z replaces the 99s pair
		{"19m19p19s1234567z", 8, yaochuNeighbours, false},
		{"1111m2222m3333m4z", 0, "4z", false},
		{"123456789m1111p", 1, "123456789m23456789p123456789s1234567z", false},
		{"123m456p789s5556s", 0, "4679s", false}, // 9s: 555 678 99
	},
	"tanyao": {
		{"234m567p345s6788s", 0, "258s", false}, // 2s: 234 567 88
		{"234m567p345s6678s", 0, "36s", false},
		{"123m567p345s6788s", 1, "4m258s", false},
		{"22m456m345p678s77z", 2, allTanyao, false},
		{"234m234p234s5566s", 0, "56s", false},
		{"345m3456677p345s", 0, "67p", false},
		{"445566m234p56s77s", 0, "47s", false},
		{"222m333p444s5556s", 0, "4567s", false}, // 5s: 44 456 555
		{"345m666p2345578s", 0, "6s", false},
		{"1m234p567s345m678p", 1, allTanyao, false},
	},
	"pinfu": {
		{"234m567p345s6788s", 0, "258s", false},
		{"123m567p345s6788s", 0, "258s", false},
		{"234m567p345s88s13s", 1, "24s", true},  // kanchan only
		{"234m567p789s88s12s", 1, "3s", true},   // penchan only
		{"234m567p345s88s12s", 0, "36s", false}, // 12345s: 3s also completes 45s two-sided
		{"234m567p345s5688s", 0, "47s", false},
		{"123m456p789s1123s", 0, "14s", false},
		{"123m456p789s23s11z", 2, allNumbers + "234z", true}, // 東 pair is a value pair
		{"234m567p789s88s13s", 1, "24s", true},
		{"234m567p345s22z78s", 0, "69s", false},              // 南 pair is fine
		{"234m567p345s55z78s", 2, allNumbers + "234z", true}, // 白 pair unusable
	},
	"iipeikou": {
		{"223344m567p678s5s", 0, "58s", false},
		{"112233m456p789s1z", 0, "1z", false},
		{"12356m123p789s11z", 2, "123m123p789s", false},
		{"234m234m567p88s45s", 0, "36s", false},
		{"234m23m567p88s456s", 0, "4m", false},
		{"123m456m789m11p45s", 2, "123456789m", false},
		{"112233m112233p1z", 0, "1z", false},
		{"345m345m67788p99s", 0, "69p", false},
		{"11223m456p789s55z", 0, "3m", false},
		{"456m456m123p789p1s", 0, "1s", false},
		{"44556m123p789s11z", 0, "6m", false},
	},
	"sanshoku": {
		{"123m123p12s456s99m", 0, "3s", false},
		{"123m123p23s456s99m", 0, "1s", false},
		{"234m234p2345678s", 0, "58s", false},
		{"123m123p789s11z3s5z", 1, "12s", false},
		{"1456m4569p1456s7z", 2, "123m789p123s7z", false},
		{"123m123p123s11z22z", 0, "12z", false},
		{"789m789p78s11z456s", 0, "9s", false},
		{"123m234p345s11z55z", 2, "4m2s15z", false},
		{"456m456p45s99m123z", 2, "9m6s123z", false},
		{"123m123p12399s11z", 0, "9s1z", false},
		{"234m234p2234345s", 0, "25s", false},
	},
	"ittsu": {
		{"123456789m11p45s", 0, "36s", false},
		{"12345678m11p456s", 0, "9m", false},
		{"123456m789p11z45s", 2, "789m", false},
		{"12345678m11z99p5s", 1, "9m9p1z", false},
		{"123456789s1122z", 0, "12z", false},
		{"123456789p1234z", 2, "1234z", false},
		{"123456789m1235s", 0, "5s", false},
		{"12346789m111z55z", 0, "5m", false},
		{"123m456m789p789s1z", 3, "789m789p789s1z", false}, // pair from 1z or from the unused 789
		{"1123456789m99p1z", 1, "123m9p1z", false},         // 2m3m: a second 123m + 99p pair
		{"123789m456s11z33p", 2, "456m", false},
	},
	"chanta": {
		{"123m789p11z789s12m", 0, "3m", false},
		{"123m789p11z789s23m", 0, "1m", false},
		{"123m789p11z789s99m", 0, "9m1z", false},
		{"123m789p11z789s55m", 2, yaochuNeighbours, false},
		{"12m789p11z789s999m", 0, "3m", false},
		{"1239m1239p1239s1z", 2, "789m789p789s1z", false},
		{"111m999p11z123s78s", 0, "9s", false},
		{"139m79p11z123s789s", 1, "2m8p", false},
		{"123789m11z999p19s", 1, "123789s1z", false},
		{"123m456p789s11z99m", 3, yaochuNeighbours, false},
		{"19m19p19s1234567z", 8, yaochuNeighbours, false},
	},
	"junchan": {
		{"123m789p99s789s12m", 0, "3m", false},
		{"123m789p11z789s12m", 2, "139m19p19s", false},
		{"123789m123789p9s", 0, "9s", false},
		{"111m999m111p99p78p", 0, "9p", false},
		{"123m789m123s19p9s5z", 2, "123789p789s", false},
		{"1199m1199p1199s1z", 3, "19m19p19s", false},
		{"123m789m123p789p1s", 0, "1s", false},
		{"123m456p789s11m99s", 3, "123789m123789p123789s", false},
		{"12m12p112s99m99p99s", 3, "39m39p139s", false},
		{"111m123p999s789p1s", 0, "1s", false},
		{"11m99m123p789p789s", 0, "19m", false},
	},
	"honitsu": {
		{"123456m111z22z33z", 0, "23z", false},
		{"123456m789p11z22z", 3, "123456789m1234567z", false},
		{"2345678m1122z77z", 1, "127z", false},
		{"123456789m1234z", 2, "1234z", false},
		{"1112345678999p", 0, "123456789p", false},
		{"12345678m55z66z1s", 1, "369m56z", false}, // 3m: 123 345 678
		{"112233m445566z7z", 1, "456z", false},
		{"123499m555z6677z", 1, "9m67z", false},
		{"19m19p19s1234567z", 8, yaochuNeighbours, false},
		{"123456789p11s11z", 2, "123456789p1234567z", false},
		{"123456789m111z2z", 0, "2z", false},
	},
	"chinitsu": {
		{"1112345678999m", 0, "123456789m", false},
		{"1112223456789m", 0, "1234679m", false},
		{"123456789m123p5z", 4, "123456789m", false},
		{"1122334455667m", 0, "147m", false},
		{"123456789m11p23p", 4, "123456789m", false},
		{"2233445566778s", 0, "258s", false},
		{"1113335557779m", 0, "89m", false},
		{"1112223334445m", 0, "23456m", false}, // 2m: 22 111 234 234 345
		{"12123456789m99p", 2, "123456789m", false},
		{"1112345678999s", 0, "123456789s", false},
		{"1111223456789p", 0, "23p", false},
	},
	"toitoi": {
		{"111m222p333s44z55z", 0, "45z", false},
		{"111m222p33s44s55z6z", 1, "34s5z", false},
		{"123m456p789s11z22z", 6, "123m456p789s12z", false},
		{"11m22p33s445566z7z", 3, "1m2p3s456z", false},
		{"111m999m111p99p11z", 0, "9p1z", false},
		{"1111m222p333s44z5z", 1, "45z", false},
		{"222m333p444s5556s", 0, "6s", false},
		{"1122m3344p5566s7z", 3, "12m34p56s", false},
		{"111222333444z5z", 0, "5z", false},
		{"123m123p123s11z23z", 7, "123m123p123s123z", false},
	},
	"sanankou": {
		{"111m222p333s456m7z", 0, "7z", false},
		{"111m222p33s456m78s", 1, "378s", false},
		{"111m222p333s4455z", 0, "45z", false},
		{"123m456p789s1122z", 4, "123m456p789s12z", false},
		{"111222333m45p55z", 0, "36p", false},
		{"11m22p33s456789m1z", 3, "1456789m2p3s1z", false},
		{"555m666p777s89s11z", 0, "7s1z", false}, // 1z: 111z + 789s 77s
		{"111222333z4567z", 2, "4567z", false},
		{"123m123p123s1234z", 6, "123m123p123s1234z", false},
		{"1112223334445m", 0, "3456m", false},
		{"234m234p234s111z5z", 4, "234m234p234s5z", false},
	},
	"haku": {
		{"555z123m456p789s1s", 0, "1s", false},
		{"55z123m456p789s11z", 0, "5z", false},
		{"5z123m456p789s111z", 1, "5z", false},
		{"123m456p789s1234z", 3, "12345z", false},
		{"555z123m456p78s99s", 0, "69s", false},
		{"55z55m123p456p789p", 0, "5z", false},
		{"5z5m123p456p789p11s", 1, "5z", false},
		{"555z666z777z1234m", 0, "14m", false},
		{"19m19p19s1234567z", 8, yaochuNeighbours, false},
		{"555z1112223334m", 0, "12345m", false}, // 5m: 33 + 111 222 345
	},
	"hatsu": {
		{"666z123m456p789s1s", 0, "1s", false},
		{"66z123m456p789s11z", 0, "6z", false},
		{"6z123m456p789s111z", 1, "6z", false},
		{"123m456p789s1234z", 3, "12346z", false},
		{"666z123m456p78s99s", 0, "69s", false},
		{"66z66m123p456p789p", 0, "6z", false},
		{"666z112233m456p1s", 0, "1s", false},
		{"123m9m555z666z777z", 0, "9m", false},
		{"567z123456789m1p", 2, "1p567z", false},
		{"666z23456789m11p", 0, "147m", false},
	},
	"chun": {
		{"777z123m456p789s1s", 0, "1s", false},
		{"77z123m456p789s11z", 0, "7z", false},
		{"7z123m456p789s111z", 1, "7z", false},
		{"123m456p789s1234z", 3, "12347z", false},
		{"777z123m456p78s99s", 0, "69s", false},
		{"77z77m123p456p789p", 0, "7z", false},
		{"777z1112223334m", 0, "12345m", false},
		{"777z123m456p789p5s", 0, "5s", false},
		{"567z123456789m1p", 2, "1p567z", false},
		{"777z555z1122m33p1s", 1, "123m3p", false},
	},
	"ton": {
		{"111z123m456p789s9s", 0, "69s", false}, // 6s: 678s + 99s
		{"11z123m456p789s55z", 0, "1z", false},
		{"1z123m456p789s555z", 1, "1z", false},
		{"123m456p789s2345z", 3, "12345z", false},
		{"111z123m456p78s99s", 0, "69s", false},
		{"11z11m123p456p789p", 0, "1z", false},
		{"111z1112223334m", 0, "12345m", false},
		{"111z223344z56m78p", 2, "47m69p234z", false},
		{"1234567z123m456m", 4, "1234567z", false},
		{"111z234m567p88s45s", 0, "36s", false},
	},
	"chiitoitsu": {
		{"1122m3344p5566s7z", 0, "7z", false},
		{"1111m2233p4455s6z", 2, singlesAndEmpty, false}, // quad = one pair
		{"1111m2222m3333m4z", 6, singlesAndEmpty, false},
		{"19m19p19s1234567z", 6, allYaochu, false},
		{"1122m33p44s55667z", 0, "7z", false},
		{"119m22p33s4455z67z", 1, "9m67z", false},
		{"112233m445566p7s", 0, "7s", false},
		{"111m222p333s455z6z", 3, singlesAndEmpty, false},
		{"123456m123456p7s", 6, "123456m123456p7s", false},
		{"1122334m556677p", 0, "4m", false},
	},
	"kokushi": {
		{"19m19p19s1234567z", 0, allYaochu, false},
		{"119m19p19s123456z", 0, "7z", false},
		{"119m19p19s12345z5m", 1, "67z", false},
		{"19m19p19s1234z258m", 3, allYaochu, false},
		{"1199m19p19s12345z", 1, "67z", false},
		{"2345678m234567p", 13, allYaochu, false},
		{"111m999m111p999p1z", 7, "19s234567z", false},
		{"159m19p19s123456z", 1, allYaochu, false},
		{"1111m9999m12345z", 5, "19p19s67z", false},
		{"19m19p19s12345z55m", 2, allYaochu, false},
	},
}

func expectedUkeire(c tile.Counts, spec string) []tile.Kind {
	if spec == singlesAndEmpty {
		var out []tile.Kind
		for k := tile.Kind(0); k < tile.NumKinds; k++ {
			if c[k] <= 1 {
				out = append(out, k)
			}
		}
		return out
	}
	var set [tile.NumKinds]bool
	for _, t := range tile.MustParseHand(spec) {
		set[t.Kind] = true
	}
	return kindsOf(&set)
}

func TestHandWrittenCases(t *testing.T) {
	a := NewAnalyzer()
	for _, row := range Rows {
		cases := handCases[row.Key]
		if len(cases) < 10 {
			t.Errorf("%s: only %d hand-written cases", row.Key, len(cases))
		}
		for _, tc := range cases {
			c := tile.MustCounts(tc.hand)
			if c.Total() != 13 {
				t.Fatalf("%s fixture %s has %d tiles", row.Key, tc.hand, c.Total())
			}
			got := a.Row(c, row.Key)
			want := expectedUkeire(c, tc.ukeire)
			if !got.Possible || got.Shanten != tc.shanten || got.Approx != tc.approx || !slices.Equal(got.Ukeire, want) {
				t.Errorf("%s %s: got shanten=%d approx=%v ukeire=%v, want %d approx=%v %v",
					row.Key, tc.hand, got.Shanten, got.Approx, names(got.Ukeire), tc.shanten, tc.approx, names(want))
			}
			// Near-tenpai expectations are also confirmed by the brute-force definition.
			if row.Key != "pinfu" && tc.shanten <= 1 {
				d := tc.shanten + 1
				if bd := bruteDist(row.Key, c); bd != d {
					t.Errorf("%s %s: brute dist %d disagrees with expected shanten %d", row.Key, tc.hand, bd, tc.shanten)
				} else if bu := bruteUkeire(row.Key, c, d); !slices.Equal(bu, want) {
					t.Errorf("%s %s: brute ukeire %v disagrees with expected %v", row.Key, tc.hand, names(bu), names(want))
				}
			}
		}
	}
}

// TestPinfuWaitShapes uses expectations derived by hand from the standard
// rule (pinfu needs a two-sided wait in some reading), independent of the
// decomposition code shared by the implementation and the brute oracle.
func TestPinfuWaitShapes(t *testing.T) {
	cases := []struct {
		name, hand string
		shanten    int
		approx     bool
		waits      string // checked only at exact tenpai
	}{
		// 13s kanchan: waits only 2s in the middle.
		{"kanchan", "234m567p789s88s13s", 1, true, ""},
		// 12s penchan: 3s ends 123 on the far side.
		{"penchan", "234m567p789s88s12s", 1, true, ""},
		// four sequences + 5s: tanki.
		{"tanki", "234m567p789s123s5s", 1, true, ""},
		// 2345s nobetan: 2s and 5s both only complete the pair (tanki-type).
		{"nobetan", "234m567p789s2345s", 1, true, ""},
		// 12334s: 2s reads as 13+234 (kanchan) or 123+34 -> 234 (two-sided);
		// 5s completes 345 two-sided. Pinfu tenpai on both.
		{"kanchan-or-ryanmen", "567m789p55s12334s", 0, false, "25s"},
		// Plain ryanmen for comparison.
		{"ryanmen", "234m567p789s88s23s", 0, false, "14s"},
	}
	a := NewAnalyzer()
	for _, tc := range cases {
		c := tile.MustCounts(tc.hand)
		if c.Total() != 13 {
			t.Fatalf("%s fixture has %d tiles", tc.name, c.Total())
		}
		got := a.Row(c, "pinfu")
		if got.Shanten != tc.shanten || got.Approx != tc.approx {
			t.Errorf("%s %s: shanten=%d approx=%v, want %d approx=%v", tc.name, tc.hand, got.Shanten, got.Approx, tc.shanten, tc.approx)
		}
		if tc.waits != "" && !slices.Equal(got.Ukeire, expectedUkeire(c, tc.waits)) {
			t.Errorf("%s %s: waits %v, want %s", tc.name, tc.hand, names(got.Ukeire), tc.waits)
		}
		// every shape above is tenpai for the normal row
		if n := a.Row(c, "normal"); n.Shanten != 0 {
			t.Errorf("%s: normal shanten %d", tc.name, n.Shanten)
		}
	}
}
