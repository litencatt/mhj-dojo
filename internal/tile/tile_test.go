package tile

import "testing"

func TestParseFormatRoundTrip(t *testing.T) {
	ts, err := ParseHand("123m0p55p789s1234567z")
	if err != nil {
		t.Fatal(err)
	}
	if len(ts) != 16 {
		t.Fatalf("got %d tiles", len(ts))
	}
	if !ts[3].Red || ts[3].Kind != MakeKind(Pin, 5) {
		t.Fatalf("red five parsed as %+v", ts[3])
	}
	Sort(ts)
	got := ""
	for _, s := range Strings(ts) {
		got += s + " "
	}
	want := "1m 2m 3m 5p 5p 0p 7s 8s 9s 1z 2z 3z 4z 5z 6z 7z "
	if got != want {
		t.Fatalf("sorted = %q, want %q", got, want)
	}
}

func TestParseErrors(t *testing.T) {
	for _, s := range []string{"", "5", "m", "8z", "0z", "1x", "123"} {
		if s == "" {
			if _, err := Parse(s); err == nil {
				t.Errorf("Parse(%q) should fail", s)
			}
			continue
		}
		if _, err := ParseHand(s); err == nil {
			t.Errorf("ParseHand(%q) should fail", s)
		}
	}
	if _, err := Parse("12m"); err == nil {
		t.Error("Parse of two tiles should fail")
	}
}

func TestKindPredicates(t *testing.T) {
	cases := []struct {
		s                  string
		honor, term, yaoch bool
	}{
		{"1m", false, true, true},
		{"9s", false, true, true},
		{"5p", false, false, false},
		{"1z", true, false, true},
		{"7z", true, false, true},
	}
	for _, c := range cases {
		tl, err := Parse(c.s)
		if err != nil {
			t.Fatal(err)
		}
		k := tl.Kind
		if k.IsHonor() != c.honor || k.IsTerminal() != c.term || k.IsYaochu() != c.yaoch {
			t.Errorf("%s: honor=%v term=%v yaochu=%v", c.s, k.IsHonor(), k.IsTerminal(), k.IsYaochu())
		}
		if k.String() != c.s {
			t.Errorf("String() = %s, want %s", k, c.s)
		}
	}
}

func TestDoraFromIndicator(t *testing.T) {
	cases := map[string]string{
		"1m": "2m", "9m": "1m", "9p": "1p", "0s": "6s",
		"1z": "2z", "4z": "1z", "5z": "6z", "7z": "5z",
	}
	for in, want := range cases {
		tl, _ := Parse(in)
		if got := DoraFromIndicator(tl.Kind).String(); got != want {
			t.Errorf("dora(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestCountsString(t *testing.T) {
	c := MustCounts("3m21m0p5p77z")
	if got := c.String(); got != "123m55p77z" {
		t.Fatalf("got %s", got)
	}
	if c.Total() != 7 {
		t.Fatalf("total %d", c.Total())
	}
}
