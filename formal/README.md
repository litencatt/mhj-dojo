# Formal model (Lean 4 + mathlib)

A Lean 4 model of the app's scoring and settlement rules (docs/api.md), with
proofs of their invariants and a generator of golden vectors that Go tests
compare the Go implementation against. Go's tests read the committed vectors,
so CI and `go test ./...` never need Lean.

| File | Models | Proved |
|---|---|---|
| `MhjDojo/Score.lean` | `internal/score`: `Compute`, `Half` | `compute_dvd` (every payment is a multiple of 100), `half_dvd`, `half_bounds`, `tsumo_total_bounds` (ron ≤ tsumo total ≤ ron + 200), `basePts_mono` / `compute_mono` (more han never pays less, for a fixed fu), `limit_below_mangan`, `basePts_limits`, `basePts_below`, `yakuman_payments` |
| `MhjDojo/Settle.lean` | `internal/game` round settlement: tsumo / ron (with pao), honba, noten penalty, riichi sticks | `sum4_deltasOf` (payments sum to 0), `noten_sum`, `settle_conserves` (Σ deltas + sticks left on the table = sticks carried in, for every input), `settle_dvd` (every delta is a multiple of 100) |
| `MhjDojo/Rules.lean` | the rules the settlement must satisfy, stated with the rule's own numbers (32000 / 48000 per yakuman, 300 per honba), not in terms of how `Settle.lean` computes them | `tsumo_pao` (under pao the winner still gets the full hand; a responsible seat pays its yakuman in full plus its normal share of the rest, any other seat just its normal share), `ron_pao` (winner gets the full hand; a responsible seat other than the discarder pays half its yakuman, the discarder the rest), `ron_pao_le` (never more than the full value), `honba_winner` (the winner always receives 300 per honba) |
| `MhjDojo/Standings.lean` | `internal/game` `Hanchan.Standings` | `rank_injective` / `rank_bijective`, `rank_points`, `rank_tie` (ties to the seat nearer the first dealer), `sum_uma`, `sum_first`, `sum_total`, `sum_score` (the final scores add up to exactly 0) |
| `MhjDojo/Fu.lean` | `internal/yaku`: the readings of a hand (`DecomposeWith`, `ReadingsWith`), their wait (`waitOf`) and fu (`Fu`, `IsPinfu`). Only the fu rules are stated in the rule's own terms (the standard per-meld table; a double wind pair is 4 fu, docs/api.md); the readings and waits follow Go's approach, guarded by the lemmas | `meldFu_rule` (the table is the doubling rule: terminal/honor ×2, concealed ×2, kan ×4), `fu_dvd` (every fu is a multiple of 10), `fu_ge`, `fu_eq_20` (20 fu is exactly a pinfu tsumo), `fu_open` / `fu_ron` (an open hand or a ron scores at least 30), `fu_le` (at most 170), `fu_le_nokan` (at most 70 without kans), `pairFu_le_winds`, `decompositions_nodup` / `readings_nodup` (each reading once), `readings_win` (the winning tile is the pair or in the group it completed) |
| `GenVectors.lean` | `lake exe gen-vectors` | writes `internal/score/testdata/lean_*.json`, `internal/game/testdata/lean_*.json` and `internal/yaku/testdata/lean_fu.json` (every reading, wait and fu of edge-case and random hands, with and without called melds) |

## Running

Everything runs in Docker; nothing is installed on the host. The toolchain,
mathlib and the build live in named volumes, so no large files land in the
repository or your home directory.

```sh
formal/run.sh build     # build the image, fetch mathlib's cache, check every proof
formal/run.sh vectors   # also regenerate the Go golden vectors
formal/run.sh shell     # a shell in the container
```

The container runs as root, which owns the volumes. It writes into the
repository only the vector files, which `run.sh vectors` hands back to your
user (on Linux, a bind mount keeps the container's owner; Docker Desktop on
macOS maps it to you anyway). The build output stays on the volumes.

`run.sh` fetches from mathlib's cache only the modules the model imports (and
their imports), not all of mathlib. The first `build` downloads the Lean
toolchain (about 3 GB unpacked) and about 1000 mathlib files, and compiles
the imported mathlib modules for the `gen-vectors` executable (a few minutes
on a 2-CPU Docker VM); later builds take seconds. The volumes need about
5 GB of the Docker VM's disk.

After changing the model, run `formal/run.sh vectors` and then `go test
./internal/score ./internal/game ./internal/yaku`.

## CI

The pull request CI (`.github/workflows/ci.yml`) never runs Lean: it only
runs the Go tests, which read the committed vectors. A separate workflow,
`.github/workflows/formal.yml`, checks the model on a GitHub runner (no
Docker):

- on pull requests and pushes to main that touch `formal/`,
  `internal/score/`, `internal/game/round.go`, `internal/game/hanchan.go`,
  `internal/yaku/`, the `lean_*.json` vectors or the workflow itself; every Monday at 04:17
  UTC; and by hand (workflow_dispatch);
- it installs the toolchain with `leanprover/lean-action`, fetches from
  mathlib's cache only the modules the model imports (as `run.sh` does),
  runs `lake build` (every proof must check), fails on any `sorry` or
  `admit`, regenerates the vectors and fails if they differ from the
  committed ones, then runs `go test ./internal/score ./internal/game
  ./internal/yaku -run Lean`;
- it caches nothing, so every run takes about the same time: roughly 5-8
  minutes, most of it fetching mathlib and compiling the imported mathlib
  modules for `gen-vectors`.

## Removing everything

```sh
formal/run.sh clean
# which runs:
docker image rm -f mhj-dojo-lean
docker volume rm mhj-dojo-lean-elan mhj-dojo-lean-lake mhj-dojo-lean-cache
```

`docker builder prune` also drops the image's build cache. The empty
`formal/.lake` directory left as a mount point is ignored by git.
