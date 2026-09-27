package store

import "testing"

func TestEvictsOldest(t *testing.T) {
	s := New[int](2)
	a := s.Add(1)
	b := s.Add(2)
	c := s.Add(3)
	if _, ok := s.Get(a); ok {
		t.Error("oldest item was not evicted")
	}
	for id, want := range map[string]int{b: 2, c: 3} {
		if v, ok := s.Get(id); !ok || v != want {
			t.Errorf("Get(%s) = %d, %v; want %d", id, v, ok, want)
		}
	}
}

func TestGetKeepsRecentlyUsedItem(t *testing.T) {
	s := New[int](2)
	a := s.Add(1)
	b := s.Add(2)
	// Touching a makes it the most recently used; b, untouched, is now the
	// least recently used and goes first instead.
	if _, ok := s.Get(a); !ok {
		t.Fatal("Get(a) missing")
	}
	c := s.Add(3)
	if _, ok := s.Get(b); ok {
		t.Error("least recently used item was not evicted")
	}
	for id, want := range map[string]int{a: 1, c: 3} {
		if v, ok := s.Get(id); !ok || v != want {
			t.Errorf("Get(%s) = %d, %v; want %d", id, v, ok, want)
		}
	}
}

func TestDelete(t *testing.T) {
	s := New[int](2)
	a := s.Add(1)
	b := s.Add(2)
	s.Delete(a)
	s.Delete("missing")
	if _, ok := s.Get(a); ok {
		t.Error("deleted item is still there")
	}
	// The deleted item no longer takes a place: adding one more keeps b.
	s.Add(3)
	if v, ok := s.Get(b); !ok || v != 2 {
		t.Errorf("Get(b) = %d, %v; want 2", v, ok)
	}
}
