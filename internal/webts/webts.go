// Package webts reads the web front end's TypeScript for the Go tests, so a
// rule the front end and the tests both hold (the dojo's yaku lists, say) is
// written once, in the TypeScript, and cannot drift.
package webts

import (
	"os"
	"regexp"
	"testing"
)

// Read returns a file under web/, given relative to it, from a test of a
// package under internal/.
func Read(t testing.TB, file string) string {
	t.Helper()
	b, err := os.ReadFile("../../web/" + file)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

var item = regexp.MustCompile(`'([^']*)'|\.\.\.(\w+)`)

// Strings reads the array `NAME ... = [...]` from a file under web/: its
// quoted strings in order, with a `...OTHER` spread from the array OTHER of
// the same file.
func Strings(t testing.TB, file, name string) []string {
	t.Helper()
	return stringsIn(t, file, Read(t, file), name)
}

func stringsIn(t testing.TB, file, src, name string) []string {
	t.Helper()
	m := regexp.MustCompile(`\b` + name + `\b[^=\n]*= \[([^\]]*)\]`).FindStringSubmatch(src)
	if m == nil {
		t.Fatalf("%s: no `%s = [...]` found", file, name)
	}
	var out []string
	for _, it := range item.FindAllStringSubmatch(m[1], -1) {
		if it[2] != "" {
			out = append(out, stringsIn(t, file, src, it[2])...)
		} else {
			out = append(out, it[1])
		}
	}
	return out
}
