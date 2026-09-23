//go:build !race

package yakushanten

import "time"

const p95Limit = 100 * time.Millisecond
