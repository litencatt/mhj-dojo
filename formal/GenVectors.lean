/-
Writes golden vectors from the Lean model into the Go packages' testdata,
for Go tests that compare the Go implementation against the model:

  lake exe gen-vectors <repo root>
-/
import MhjDojo

open MhjDojo

def jbool (b : Bool) : String := if b then "true" else "false"

def jarr (xs : List String) : String := "[" ++ ",".intercalate xs ++ "]"

def jobj (kvs : List (String × String)) : String :=
  "{" ++ ",".intercalate (kvs.map fun (k, v) => "\"" ++ k ++ "\":" ++ v) ++ "}"

def jstr (s : String) : String := "\"" ++ s ++ "\""

def jseats (f : Fin 4 → String) : String := jarr ((List.finRange 4).map f)

def jlines (xs : List String) : String := "[\n" ++ ",\n".intercalate xs ++ "\n]\n"

/-- Four bools from the low bits of `n` (seat 0 = bit 0). -/
def bits (n : Nat) : Fin 4 → Bool := fun s => (n >>> s.val) % 2 = 1

/-! ### Scoring -/

def fus : List Nat := [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]

def scoreVector (han fu yak : Nat) (dealer tsumo : Bool) : String :=
  let p := compute han fu yak dealer tsumo
  jobj [("han", toString han), ("fu", toString fu), ("yakuman", toString yak),
    ("dealer", jbool dealer), ("tsumo", jbool tsumo), ("limit", jstr p.limit.name),
    ("multiplier", toString p.mult), ("total", toString p.total), ("ron", toString p.ron),
    ("from_dealer", toString p.fromDealer), ("from_non_dealer", toString p.fromNonDealer)]

def scoreVectors : List String := Id.run do
  let mut out := []
  for dealer in [false, true] do
    for tsumo in [false, true] do
      for han in List.range 17 do
        for fu in fus do
          out := scoreVector han fu 0 dealer tsumo :: out
      for yak in [1, 2, 3, 4] do
        out := scoreVector (13 * yak) 0 yak dealer tsumo :: out
  return out.reverse

def halfVectors : List String :=
  (List.range 2001 ++ (List.range 49).map (· * 4000)).map fun v =>
    jobj [("v", toString v), ("half", toString (half v))]

/-! ### Settlement -/

def jpart (p : Part) : String :=
  jobj [("mult", toString p.mult), ("pao", match p.pao with | some s => toString s.val | none => "-1")]

def settleVector (x : Input) : String :=
  let o := x.settle
  let kind := match x.kind with
    | .tsumo => "tsumo" | .ron => "ron" | .draw => "draw" | .abort => "abort"
  jobj [("kind", jstr kind), ("dealer", toString x.dealer.val), ("winner", toString x.winner.val),
    ("from", toString x.discarder.val), ("honba", toString x.honba),
    ("deposit", toString x.deposit), ("riichi", jseats fun s => jbool (x.riichi s)),
    ("tenpai", jseats fun s => jbool (x.tenpai s)), ("han", toString x.han),
    ("fu", toString x.fu), ("yakuman", jarr (x.parts.map jpart)),
    ("hand", jseats fun s => toString (o.hand s)), ("honba_deltas", jseats fun s => toString (o.honba s)),
    ("stick", jseats fun s => toString (o.stick s)), ("deposit_out", toString o.deposit)]

/-- Winning hands: (han, fu, yakuman parts) with pao seats other than the
winner. -/
def hands (w : Fin 4) : List (Nat × Nat × List Part) :=
  let others := (List.finRange 4).filter (· ≠ w)
  let normal := [(1, 30), (2, 25), (3, 60), (4, 30), (4, 40), (6, 40), (7, 40), (9, 30), (13, 30)].map
    fun (h, f) => (h, f, [])
  let one := fun m p => Part.mk m p
  normal ++ [(13, 0, [one 1 none]), (26, 0, [one 2 none])] ++
    others.flatMap (fun p =>
      [(13, 0, [one 1 (some p)]), (26, 0, [one 2 (some p)]),
       (26, 0, [one 1 (some p), one 1 none]), (26, 0, [one 1 (some p), one 1 (some p)]),
       (39, 0, [one 2 (some p), one 1 none])] ++
      (others.filter (· ≠ p)).map fun q => (26, 0, [one 1 (some p), one 1 (some q)]))

def settleVectors : List String := Id.run do
  let mut out := []
  let none4 : Fin 4 → Bool := fun _ => false
  -- (honba, riichi, carried sticks); each dealer gets two of them
  let tables := [(0, 0, 0), (2, 5, 1000), (1, 10, 3000)]
  for dealer in List.finRange 4 do
    for winner in List.finRange 4 do
      for (honba, rmask, deposit) in [tables[dealer.val % 3]!, tables[(dealer.val + 1) % 3]!] do
        for (han, fu, parts) in hands winner do
          let base : Input :=
            { kind := .tsumo, dealer := dealer, winner := winner, discarder := winner,
              honba := honba, deposit := deposit, riichi := bits rmask, tenpai := none4,
              han := han, fu := fu, parts := parts }
          out := settleVector base :: out
          for d in (List.finRange 4).filter (· ≠ winner) do
            out := settleVector { base with kind := .ron, discarder := d } :: out
  for tmask in List.range 16 do
    for rmask in List.range 16 do
      for honba in [0, 1] do
        for deposit in [0, 3000] do
          let x : Input :=
            { kind := .draw, dealer := 0, winner := 0, discarder := 0, honba := honba,
              deposit := deposit, riichi := bits rmask, tenpai := bits tmask, han := 0,
              fu := 0, parts := [] }
          out := settleVector x :: out
  for rmask in List.range 16 do
    for deposit in [0, 2000] do
      let x : Input :=
        { kind := .abort, dealer := 1, winner := 0, discarder := 0, honba := 1,
          deposit := deposit, riichi := bits rmask, tenpai := none4, han := 0, fu := 0,
          parts := [] }
      out := settleVector x :: out
  return out.reverse

/-! ### Standings -/

def standingsVector (x : Standings.Input) : String :=
  jobj [("points", jseats fun s => toString (x.points s)),
    ("first_dealer", toString x.firstDealer.val), ("deposit", toString x.deposit),
    ("over", jbool x.over), ("rank", jseats fun s => toString (x.rankN s + 1)),
    ("final", jseats fun s => toString (x.final s)),
    ("score_tenths", jseats fun s => toString (x.scoreTenths s))]

def standingsVectors : List String :=
  let vals : List Int := [-1200, 20000, 25000, 30050]
  let quads := vals.flatMap fun a => vals.flatMap fun b => vals.flatMap fun c =>
    vals.map fun d => [a, b, c, d]
  quads.flatMap fun ps => (List.finRange 4).flatMap fun fd => [0, 2000].flatMap fun deposit =>
    -- a game with a seat below zero is over (tobi)
    ([true, false].filter fun over => over || ps.all (0 ≤ ·)).map fun over =>
      standingsVector
        { points := fun s => ps.getD s.val 0, firstDealer := fd, deposit := deposit,
          over := over }

def writeVectors (root path : String) (xs : List String) : IO Unit := do
  IO.FS.writeFile (root ++ "/" ++ path) (jlines xs)
  IO.println s!"{path}: {xs.length} vectors"

def main (args : List String) : IO Unit := do
  let root := args.headD "."
  writeVectors root "internal/score/testdata/lean_score.json" scoreVectors
  writeVectors root "internal/score/testdata/lean_half.json" halfVectors
  writeVectors root "internal/game/testdata/lean_settlement.json" settleVectors
  writeVectors root "internal/game/testdata/lean_standings.json" standingsVectors
