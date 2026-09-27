// Package memo is a memo table of bounded size that keeps what is in use.
package memo

// Memo maps keys to computed values in two generations: new entries go to
// the current one, and once it holds max entries it becomes the old one
// (dropping the previous old one) and a new current one starts. A lookup
// that hits the old generation copies the entry into the current one, so
// whatever is still in use survives the next turnover. It holds at most
// 2*max entries, and a working set of up to max entries is never lost.
//
// Values are never changed or invalidated: a dropped entry is only
// recomputed if asked for again, so callers may keep what Get returned.
// It is not safe for concurrent use.
type Memo[K comparable, V any] struct {
	cur, old map[K]V
	max      int
}

// New returns an empty memo whose generations hold max entries each.
func New[K comparable, V any](max int) *Memo[K, V] {
	return &Memo[K, V]{cur: make(map[K]V), max: max}
}

// Get returns the value memoized for k.
func (m *Memo[K, V]) Get(k K) (V, bool) {
	if v, ok := m.cur[k]; ok {
		return v, true
	}
	v, ok := m.old[k]
	if ok {
		m.Put(k, v)
	}
	return v, ok
}

// Put memoizes v for k.
func (m *Memo[K, V]) Put(k K, v V) {
	if len(m.cur) >= m.max {
		m.old, m.cur = m.cur, make(map[K]V, m.max)
	}
	m.cur[k] = v
}

// Len returns the number of entries held, both generations counted (an
// entry copied from the old one counts twice).
func (m *Memo[K, V]) Len() int { return len(m.cur) + len(m.old) }
