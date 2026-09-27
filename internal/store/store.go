// Package store keeps a bounded set of in-memory objects by random id.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// Store holds up to max items; adding beyond that evicts the least recently
// used one (by Add or Get, whichever was more recent). It is safe for
// concurrent use.
type Store[T any] struct {
	mu    sync.Mutex
	items map[string]T
	order []string
	max   int
}

// New returns an empty store that keeps at most max items.
func New[T any](max int) *Store[T] {
	return &Store[T]{items: make(map[string]T), max: max}
}

// Add stores v under a new random id and returns the id.
func (s *Store[T]) Add(v T) string {
	id := NewID()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[id] = v
	s.order = append(s.order, id)
	for len(s.order) > s.max {
		delete(s.items, s.order[0])
		s.order = s.order[1:]
	}
	return id
}

// Delete removes the item stored under id, if any.
func (s *Store[T]) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.items[id]; !ok {
		return
	}
	delete(s.items, id)
	for i, x := range s.order {
		if x == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
}

// Get returns the item stored under id, marking it most recently used (so a
// session in active use isn't the one evicted just because it's old).
func (s *Store[T]) Get(id string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.items[id]
	if ok {
		s.touch(id)
	}
	return v, ok
}

// touch moves id to the most-recently-used end of the eviction order.
// Callers hold s.mu already.
func (s *Store[T]) touch(id string) {
	for i, x := range s.order {
		if x == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	s.order = append(s.order, id)
}

// NewID returns a random 12-hex-digit id.
func NewID() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
