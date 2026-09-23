// Package tile defines mahjong tiles: 34 kinds plus a red-five flag.
package tile

import (
	"fmt"
	"slices"
	"strings"
)

// NumKinds is the number of distinct tile kinds.
const NumKinds = 34

// Kind is a tile kind index: 0-8 manzu, 9-17 pinzu, 18-26 souzu, 27-33 honors
// (東 南 西 北 白 發 中).
type Kind uint8

// Honor kinds.
const (
	East  Kind = 27
	South Kind = 28
	West  Kind = 29
	North Kind = 30
	Haku  Kind = 31
	Hatsu Kind = 32
	Chun  Kind = 33
)

// Suit indexes.
const (
	Man = iota
	Pin
	Sou
	Honor
)

const suitChars = "mpsz"

// Counts is a histogram of tile kinds.
type Counts [NumKinds]int

// Suit returns 0 (m), 1 (p), 2 (s) or 3 (z).
func (k Kind) Suit() int { return int(k) / 9 }

// Num returns the 1-based number within the suit (1-9, or 1-7 for honors).
func (k Kind) Num() int { return int(k)%9 + 1 }

// IsHonor reports whether k is a wind or dragon.
func (k Kind) IsHonor() bool { return k >= East }

// IsTerminal reports whether k is a 1 or 9 of a number suit.
func (k Kind) IsTerminal() bool { return !k.IsHonor() && (k.Num() == 1 || k.Num() == 9) }

// IsYaochu reports whether k is a terminal or honor.
func (k Kind) IsYaochu() bool { return k.IsHonor() || k.IsTerminal() }

// String formats a kind without red notation, e.g. "5m".
func (k Kind) String() string {
	if k >= NumKinds {
		return "??"
	}
	return fmt.Sprintf("%d%c", k.Num(), suitChars[k.Suit()])
}

// MakeKind builds a kind from a suit index and 1-based number.
func MakeKind(suit, num int) Kind { return Kind(suit*9 + num - 1) }

// Tile is a physical tile: its kind and whether it is a red five.
type Tile struct {
	Kind Kind
	Red  bool
}

// String formats a tile, using "0" for red fives (e.g. "0p").
func (t Tile) String() string {
	if t.Red {
		return fmt.Sprintf("0%c", suitChars[t.Kind.Suit()])
	}
	return t.Kind.String()
}

// Parse parses a single tile such as "5m", "0p" or "7z".
func Parse(s string) (Tile, error) {
	if len(s) != 2 {
		return Tile{}, fmt.Errorf("invalid tile %q", s)
	}
	ts, err := ParseHand(s)
	if err != nil {
		return Tile{}, err
	}
	return ts[0], nil
}

// ParseHand parses compact notation like "123m0p77z" into tiles (in input order).
func ParseHand(s string) ([]Tile, error) {
	var out []Tile
	var digits []byte
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case ch >= '0' && ch <= '9':
			digits = append(digits, ch)
		case strings.IndexByte(suitChars, ch) >= 0:
			if len(digits) == 0 {
				return nil, fmt.Errorf("suit %q without numbers in %q", ch, s)
			}
			suit := strings.IndexByte(suitChars, ch)
			for _, d := range digits {
				n := int(d - '0')
				red := false
				if n == 0 {
					if suit == Honor {
						return nil, fmt.Errorf("honors have no red five in %q", s)
					}
					n, red = 5, true
				}
				if suit == Honor && n > 7 {
					return nil, fmt.Errorf("invalid honor %d in %q", n, s)
				}
				out = append(out, Tile{Kind: MakeKind(suit, n), Red: red})
			}
			digits = digits[:0]
		default:
			return nil, fmt.Errorf("unexpected character %q in %q", ch, s)
		}
	}
	if len(digits) > 0 {
		return nil, fmt.Errorf("numbers without suit in %q", s)
	}
	return out, nil
}

// MustParseHand is ParseHand that panics on error (for tests and fixtures).
func MustParseHand(s string) []Tile {
	ts, err := ParseHand(s)
	if err != nil {
		panic(err)
	}
	return ts
}

// MustCounts parses compact notation straight into counts.
func MustCounts(s string) Counts { return CountsOf(MustParseHand(s)) }

// Compare orders tiles by kind; a red five sorts after the plain five.
func Compare(a, b Tile) int {
	if a.Kind != b.Kind {
		return int(a.Kind) - int(b.Kind)
	}
	switch {
	case a.Red == b.Red:
		return 0
	case b.Red:
		return -1
	default:
		return 1
	}
}

// Sort sorts tiles in place (m, p, s, z).
func Sort(ts []Tile) { slices.SortFunc(ts, Compare) }

// CountsOf returns the kind histogram of ts.
func CountsOf(ts []Tile) Counts {
	var c Counts
	for _, t := range ts {
		c[t.Kind]++
	}
	return c
}

// Strings formats each tile.
func Strings(ts []Tile) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = t.String()
	}
	return out
}

// Total returns the number of tiles in c.
func (c *Counts) Total() int {
	n := 0
	for _, v := range c {
		n += v
	}
	return n
}

// String formats counts in compact notation, e.g. "123m55p77z".
func (c Counts) String() string {
	var b strings.Builder
	for suit := 0; suit < 4; suit++ {
		wrote := false
		for k := Kind(suit * 9); k < Kind(min(suit*9+9, NumKinds)); k++ {
			for range c[k] {
				b.WriteByte(byte('0' + k.Num()))
				wrote = true
			}
		}
		if wrote {
			b.WriteByte(suitChars[suit])
		}
	}
	return b.String()
}

// DoraFromIndicator returns the dora kind indicated by ind
// (9→1 within a suit, 北→東, 中→白).
func DoraFromIndicator(ind Kind) Kind {
	switch {
	case ind < East:
		if ind.Num() == 9 {
			return ind - 8
		}
		return ind + 1
	case ind <= North:
		if ind == North {
			return East
		}
		return ind + 1
	default:
		if ind == Chun {
			return Haku
		}
		return ind + 1
	}
}
