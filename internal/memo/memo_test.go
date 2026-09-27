package memo

import "testing"

func TestBounded(t *testing.T) {
	m := New[int, int](10)
	for i := range 1000 {
		m.Put(i, i*i)
		if m.Len() > 20 {
			t.Fatalf("after %d puts: %d entries, want at most 20", i+1, m.Len())
		}
	}
	// The last generation's entries are kept; older ones are dropped.
	for i := 990; i < 1000; i++ {
		if v, ok := m.Get(i); !ok || v != i*i {
			t.Errorf("Get(%d) = %d, %v; want %d", i, v, ok, i*i)
		}
	}
	if _, ok := m.Get(0); ok {
		t.Error("Get(0) found an entry many generations old")
	}
}

// An entry in use survives turnovers: a hit in the old generation copies it
// into the current one.
func TestKeepsWhatIsUsed(t *testing.T) {
	m := New[int, string](4)
	m.Put(-1, "hot")
	for i := range 100 {
		m.Put(i, "cold")
		if v, ok := m.Get(-1); !ok || v != "hot" {
			t.Fatalf("after %d puts: Get(-1) = %q, %v", i+1, v, ok)
		}
	}
}
