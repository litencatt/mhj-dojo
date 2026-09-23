//go:build race

package yakushanten

import "time"

// The race detector slows this CPU-bound code roughly 5-10x.
const p95Limit = 1000 * time.Millisecond
