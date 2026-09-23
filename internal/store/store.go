// Package store keeps a bounded set of in-memory objects by random id.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// Store holds up to max items; adding beyond that evicts the oldest. It is
// safe for concurrent use.
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

// Get returns the item stored under id.
func (s *Store[T]) Get(id string) (T, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.items[id]
	return v, ok
}

// NewID returns a random 12-hex-digit id.
func NewID() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
