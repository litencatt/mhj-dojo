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

/-! ### Fu -/

section FuVectors
open MhjDojo.Fu

/-- Concealed tiles in the Go notation ("123m55z"). -/
def handString (c : Counts) : String := Id.run do
  let mut out := ""
  for (s, suf) in [(0, "m"), (1, "p"), (2, "s"), (3, "z")] do
    let mut ds := ""
    for n in List.range (if s = 3 then 7 else 9) do
      for _ in List.range (cnt c (9 * s + n)) do
        ds := ds ++ toString (n + 1)
    if ds ≠ "" then out := out ++ ds ++ suf
  return out

/-- Counts from the Go notation. -/
def parseHand (s : String) : Counts := Id.run do
  let mut c := List.replicate 34 0
  let mut ds : List Nat := []
  for ch in s.toList do
    if ch.isDigit then ds := ds ++ [ch.toNat - '0'.toNat]
    else
      let base := match ch with | 'm' => 0 | 'p' => 9 | 's' => 18 | _ => 27
      for d in ds do c := c.mapIdx fun i v => if i = base + d - 1 then v + 1 else v
      ds := []
  return c

def groupKey (g : Group) : Nat := (if g.shape = .trip then 100 else 0) + g.kind

def groupToken (g : Group) : String := (if g.shape = .trip then "t" else "s") ++ toString g.kind

/-- One reading as the Go test prints it: the concealed groups (sorted), the
group the winning tile completed, the wait and the fu. -/
def readingString (r : Reading) : String :=
  let conc := r.groups.filter fun g => !g.called && !g.kan
  let toks := ((conc.map groupKey).mergeSort (· ≤ ·)).map fun k =>
    groupToken { shape := if k ≥ 100 then .trip else .seq, kind := k % 100 }
  let win := match r.groups.find? (·.won) with
    | some g => groupToken g
    | none => "pair"
  s!"pair={r.pair} groups={" ".intercalate toks} win={win} wait={r.wait.name} fu={r.fu}"

def jmeld (g : Group) : String :=
  jobj [("type", jstr (if g.shape = .trip then "trip" else "seq")), ("kind", toString g.kind),
    ("open", jbool g.called), ("kan", jbool g.kan)]

/-- The vectors of one hand: every winning tile, by tsumo and by ron. -/
def fuVectorsOf (c : Counts) (called : List Group) (round seat : Nat) : List String :=
  ((List.range 34).filter (0 < cnt c ·)).flatMap fun w => [false, true].map fun ron =>
    let rs := readings c called w ron round seat
    jobj [("hand", jstr (handString c)), ("melds", jarr (called.map jmeld)), ("win", toString w),
      ("ron", jbool ron), ("round", toString round), ("seat", toString seat),
      ("readings", jarr (rs.map fun r => jstr (readingString r)))]

def lcg (s : Nat) : Nat := (s * 1103515245 + 12345) % 2147483648

/-- A random group: a triplet or a sequence, mostly in the manzu so that
hands have several readings. -/
def randGroup (s : Nat) : Nat × Group :=
  let s1 := lcg s; let s2 := lcg s1; let s3 := lcg s2
  let suit := if (s2 / 7) % 3 = 0 then (s2 / 11) % 3 else 0
  if (s1 / 5) % 2 = 0 then
    let k := if (s3 / 3) % 4 = 0 then (s3 / 13) % 34 else 9 * suit + (s3 / 13) % 9
    (s3, { shape := .trip, kind := k })
  else (s3, { shape := .seq, kind := 9 * suit + (s3 / 13) % 7 })

def tilesOf (g : Group) : List Nat :=
  match g.shape with
  | .seq => [g.kind, g.kind + 1, g.kind + 2]
  | .trip => List.replicate (if g.kan then 4 else 3) g.kind

def bump (c : Counts) (k : Nat) : Counts := c.mapIdx fun i v => if i = k then v + 1 else v

def windsOf (s : Nat) : Nat × Nat :=
  [(27, 27), (27, 28), (28, 30), (27, 29), (28, 28)].getD (s % 5) (27, 27)

/-- `n` random hands (concealed tiles, called melds, winds); called melds are
chii, pon, open kan and ankan. -/
def randHands (n : Nat) : List (Counts × List Group × Nat × Nat) := Id.run do
  let mut s := 20261004
  let mut out := []
  while out.length < n do
    s := lcg s
    let ncalled := [0, 0, 0, 0, 1, 1, 2, 3].getD ((s / 17) % 8) 0
    let mut called := []
    let mut conc := []
    for i in List.range 4 do
      let (s', g) := randGroup s
      s := s'
      if i < ncalled then
        let flavor := (s / 19) % 4
        let g := if g.shape = .seq then { g with called := true }
          else match flavor with
            | 0 => { g with called := true }
            | 1 => { g with called := true, kan := true }
            | 2 => { g with kan := true }
            | _ => { g with called := true }
        called := called ++ [g]
      else conc := conc ++ [g]
    s := lcg s
    let pair := if (s / 23) % 3 = 0 then (s / 29) % 34 else (s / 29) % 9
    let mut c : Counts := List.replicate 34 0
    for g in conc do
      for k in tilesOf g do c := bump c k
    c := bump (bump c pair) pair
    let mut all := c
    for g in called do
      for k in tilesOf g do all := bump all k
    if all.all (· ≤ 4) then
      out := out ++ [(c, called, windsOf (s / 31))]
  return out

/-- Hand-picked edge cases: (concealed tiles, called melds, round, seat). -/
def fuEdgeHands : List (String × List Group × Nat × Nat) :=
  let chii := fun k => ({ shape := .seq, kind := k, called := true } : Group)
  let pon := fun k => ({ shape := .trip, kind := k, called := true } : Group)
  let minkan := fun k => ({ shape := .trip, kind := k, called := true, kan := true } : Group)
  let ankan := fun k => ({ shape := .trip, kind := k, kan := true } : Group)
  [("234m567m345p678s22s", [], 27, 27), ("123m567m345p678s22s", [], 27, 27),
   ("123m123p123s789s99m", [], 27, 27), ("234m567m345p678s11z", [], 27, 27),
   ("234m567m345p678s55z", [], 27, 27), ("234m567m345p678s22z", [], 27, 28),
   ("234m567m345p678s22z", [], 27, 27), ("111m234p567p789s22s", [], 27, 27),
   ("555m234p567p789s22s", [], 27, 27), ("111z234m567p789s55m", [], 27, 27),
   ("111m999p123s456s77s", [], 27, 27), ("111m222p333s666z55z", [], 27, 27),
   ("11123m456p789s999s", [], 27, 27), ("111222333m456p77s", [], 27, 27),
   ("11122233344455m", [], 27, 27), ("22334455667788p", [], 27, 27),
   ("123456789m11122z", [], 28, 28),
   -- called melds
   ("234m567m345p22s", [chii 23], 27, 27), ("234m567m22s", [chii 23, pon 31], 27, 28),
   ("234m567m22s", [chii 23, minkan 0], 27, 27), ("234m567m22s", [ankan 27, ankan 31], 27, 27),
   ("123m11z", [ankan 0, ankan 8, ankan 33], 27, 27), ("11z", [ankan 0, ankan 8, ankan 33, ankan 32], 27, 27),
   ("55m", [pon 1, pon 2, chii 9, minkan 27], 28, 29), ("22234m", [ankan 33, pon 32, pon 31], 27, 27),
   ("123m22p", [chii 0, chii 9, chii 18], 27, 27), ("789m22p", [chii 0, chii 9, chii 18], 27, 27)]

def fuVectors : List String :=
  (fuEdgeHands.flatMap fun (h, called, round, seat) => fuVectorsOf (parseHand h) called round seat) ++
    ((randHands 300).flatMap fun (c, called, round, seat) => fuVectorsOf c called round seat)

end FuVectors

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
  writeVectors root "internal/yaku/testdata/lean_fu.json" fuVectors
