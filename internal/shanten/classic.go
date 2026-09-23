package shanten

import "github.com/litencatt/mhj2/internal/tile"

// ClassicNormal computes the normal shanten with the classic block
// decomposition formula 8 - 2*melds - min(taatsu, 4-melds) - head.
//
// It is independent from the target-distance engine and serves as its oracle.
// Blocks are enumerated per suit; a partial block whose every completing kind
// is already held four times is dead and not counted, and a headless hand needs
// a live leftover tile for its tanki pair (4-copy awareness).
func ClassicNormal(c tile.Counts) int {
	var opts [4][]classicOpt
	for s := 0; s < 4; s++ {
		opts[s] = classicSuit(&c, s)
	}
	best := 8
	for _, a := range opts[0] {
		for _, b := range opts[1] {
			for _, d := range opts[2] {
				for _, e := range opts[3] {
					head := a.head + b.head + d.head + e.head
					if head > 1 {
						continue
					}
					m := a.m + b.m + d.m + e.m
					t := a.t + b.t + d.t + e.t
					if m > 4 {
						continue
					}
					tt := min(t, 4-m)
					s := 8 - 2*m - tt - head
					if head == 0 && !(a.live || b.live || d.live || e.live) && t <= 4-m {
						// No leftover can become the pair: it must come from scratch.
						s++
					}
					best = min(best, s)
				}
			}
		}
	}
	return best
}

type classicOpt struct {
	m, t, head int
	live       bool // some leftover tile kind is held fewer than 4 times
}

func classicSuit(c *tile.Counts, s int) []classicOpt {
	v, n := SuitCounts(c, s)
	orig := v
	honor := s == tile.Honor
	var found []classicOpt
	var rec func(i, m, t, head int, live bool)
	rec = func(i, m, t, head int, live bool) {
		for i < n && v[i] == 0 {
			i++
		}
		if i == n {
			found = append(found, classicOpt{m, t, head, live})
			return
		}
		held4 := func(j int) bool { return j < 0 || j >= n || orig[j] >= 4 }
		if v[i] >= 3 {
			v[i] -= 3
			rec(i, m+1, t, head, live)
			v[i] += 3
		}
		if !honor && i+2 < n && v[i+1] > 0 && v[i+2] > 0 {
			v[i]--
			v[i+1]--
			v[i+2]--
			rec(i, m+1, t, head, live)
			v[i]++
			v[i+1]++
			v[i+2]++
		}
		if v[i] >= 2 {
			v[i] -= 2
			if head == 0 {
				rec(i, m, t, 1, live)
			}
			if !held4(i) {
				rec(i, m, t+1, head, live)
			}
			v[i] += 2
		}
		if !honor && i+1 < n && v[i+1] > 0 && (!held4(i-1) || !held4(i+2)) {
			v[i]--
			v[i+1]--
			rec(i, m, t+1, head, live)
			v[i]++
			v[i+1]++
		}
		if !honor && i+2 < n && v[i+2] > 0 && !held4(i+1) {
			v[i]--
			v[i+2]--
			rec(i, m, t+1, head, live)
			v[i]++
			v[i+2]++
		}
		v[i]--
		rec(i, m, t, head, live || orig[i] < 4)
		v[i]++
	}
	rec(0, 0, 0, 0, false)
	return paretoClassic(found)
}

// paretoClassic drops options dominated in (m, t) for the same head/live.
func paretoClassic(in []classicOpt) []classicOpt {
	var out []classicOpt
	for i, a := range in {
		dominated := false
		for j, b := range in {
			if i == j || a.head != b.head || (a.live && !b.live) {
				continue
			}
			if b.m >= a.m && b.t >= a.t && (b.m > a.m || b.t > a.t || b.live != a.live || j < i) {
				dominated = true
				break
			}
		}
		if !dominated {
			out = append(out, a)
		}
	}
	return out
}
