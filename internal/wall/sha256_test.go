package wall

import (
	"crypto/sha256"
	"encoding/binary"
	"math/rand/v2"
	"testing"
)

func TestSHA256BlockMatchesCrypto(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	check := func(m [16]byte) {
		t.Helper()
		if got, want := sha256Block(m), sha256.Sum256(m[:]); got != want {
			t.Fatalf("sha256Block(%x) = %x, want %x", m, got, want)
		}
	}
	check([16]byte{})
	check([16]byte{0: 0xff, 15: 0xff})
	for range 1000 {
		var m [16]byte
		binary.BigEndian.PutUint64(m[:8], r.Uint64())
		binary.BigEndian.PutUint64(m[8:], r.Uint64())
		check(m)
	}
}
