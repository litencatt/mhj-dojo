package yaku

// KeySet is a set of yaku keys (e.g. "riichi", "ton"). A nil *KeySet allows
// every yaku, so the zero configuration is the standard rules.
type KeySet struct{ m map[string]struct{} }

// NewKeySet returns the set of the given keys.
func NewKeySet(keys ...string) *KeySet {
	s := &KeySet{m: make(map[string]struct{}, len(keys))}
	for _, k := range keys {
		s.m[k] = struct{}{}
	}
	return s
}

// Has reports whether the set allows key; a nil set allows every key.
func (s *KeySet) Has(key string) bool {
	if s == nil {
		return true
	}
	_, ok := s.m[key]
	return ok
}

// IsKey reports whether key names a yaku (a value wind included).
func IsKey(key string) bool {
	if _, ok := byKey[key]; ok {
		return true
	}
	for _, wk := range WindKeys {
		if wk == key {
			return true
		}
	}
	return false
}

// filter splits ys into the allowed and the excluded yaku. ダブル立直 not allowed
// falls back to 立直 when that is allowed.
func (s *KeySet) filter(ys []Yaku) (allowed, excluded []Yaku) {
	if s == nil {
		return ys, nil
	}
	for _, y := range ys {
		switch {
		case s.Has(y.Key):
			allowed = append(allowed, y)
		case y.Key == yDoubleRiichi.Key && s.Has(yRiichi.Key):
			allowed = append(allowed, yRiichi)
			excluded = append(excluded, y)
		default:
			excluded = append(excluded, y)
		}
	}
	return allowed, excluded
}
