/-
Fu: the readings of a complete hand and the fu of each, as in internal/yaku
(DecomposeWith, ReadingsWith, waitOf, Fu). The fu rules are stated in the
rule's own terms (a table per meld, not Go's doubling); docs/api.md's house
choice: a pair of the round wind that is also the seat wind is 4 fu.
-/
import Mathlib.Tactic.Ring
import Mathlib.Tactic.NormNum
import Mathlib.Algebra.Order.BigOperators.Group.List

namespace MhjDojo.Fu

/-! ### Tiles

Kinds 0-8 are 1-9m, 9-17 1-9p, 18-26 1-9s, 27-30 the winds 東南西北 and
31-33 the dragons 白發中. -/

def isHonor (k : Nat) : Bool := 27 ≤ k
def num (k : Nat) : Nat := k % 9 + 1
def isDragon (k : Nat) : Bool := 31 ≤ k
/-- A terminal or an honor (么九牌). -/
def isYaochu (k : Nat) : Bool := isHonor k || num k = 1 || num k = 9

inductive Shape
  | seq | trip
  deriving DecidableEq, Repr

/-- A group of a reading: a sequence (`kind` = its lowest tile) or a
triplet. `called` is a chii, pon or open kan; an ankan is a `kan` that is
not `called`. `won` marks the group the winning tile completed. -/
structure Group where
  shape : Shape
  kind : Nat
  called : Bool := false
  kan : Bool := false
  won : Bool := false
  deriving DecidableEq, Repr

def Group.contains (g : Group) (k : Nat) : Bool :=
  match g.shape with
  | .seq => g.kind ≤ k && k ≤ g.kind + 2
  | .trip => g.kind = k

inductive Wait
  | ryanmen | kanchan | penchan | shanpon | tanki
  deriving DecidableEq, Repr

def Wait.name : Wait → String
  | .ryanmen => "ryanmen" | .kanchan => "kanchan" | .penchan => "penchan"
  | .shanpon => "shanpon" | .tanki => "tanki"

/-- The wait a winning tile `w` completed in group `g`: a triplet is a
shanpon wait; in a sequence the middle tile is kanchan, the 3 of 123 and the
7 of 789 are penchan, and any other end is ryanmen. -/
def waitOf (g : Group) (w : Nat) : Wait :=
  match g.shape with
  | .trip => .shanpon
  | .seq =>
    if w = g.kind + 1 then .kanchan
    else if (w = g.kind + 2 ∧ num g.kind = 1) ∨ (w = g.kind ∧ num g.kind = 7) then .penchan
    else .ryanmen

/-- The fu of a triplet or kan, by the standard table: open triplet 2 (4 for
a terminal or honor), concealed triplet 4 (8), open kan 8 (16), concealed
kan 16 (32). Sequences score nothing. -/
def meldFu (g : Group) (concealed : Bool) : Nat :=
  match g.shape, g.kan, concealed, isYaochu g.kind with
  | .seq, _, _, _ => 0
  | .trip, false, false, false => 2
  | .trip, false, false, true => 4
  | .trip, false, true, false => 4
  | .trip, false, true, true => 8
  | .trip, true, false, false => 8
  | .trip, true, false, true => 16
  | .trip, true, true, false => 16
  | .trip, true, true, true => 32

/-- A reading: the pair and the four groups (concealed ones and called
melds), how the hand was won and the winds. -/
structure Reading where
  pair : Nat
  groups : List Group
  winTile : Nat
  ron : Bool
  round : Nat
  seat : Nat
  deriving Repr

namespace Reading

variable (r : Reading)

/-- No chii, pon or open kan (an ankan keeps a hand closed). -/
def closed : Bool := r.groups.all fun g => !g.called

def wait : Wait :=
  match r.groups.find? (·.won) with
  | some g => waitOf g r.winTile
  | none => .tanki

/-- A triplet counts as concealed unless called, or completed by a ron. -/
def concealed (g : Group) : Bool := !g.called && !(r.ron && g.won)

def meldsFu : Nat := (r.groups.map fun g => meldFu g (r.concealed g)).sum

/-- 2 fu for each reason the pair is a value pair: a dragon, the round wind,
the seat wind (so a double wind pair is 4). -/
def pairFu : Nat :=
  (if isDragon r.pair then 2 else 0) + (if r.pair = r.round then 2 else 0) +
    (if r.pair = r.seat then 2 else 0)

/-- Kanchan, penchan and tanki waits are 2 fu. -/
def waitFu : Nat :=
  match r.wait with
  | .kanchan | .penchan | .tanki => 2
  | _ => 0

/-- Tsumo 2 fu; a closed ron 10 (menzen kafu). -/
def winFu : Nat := if r.ron then (if r.closed then 10 else 0) else 2

/-- Pinfu: closed, four sequences, a pair worth no fu, a two-sided wait. -/
def pinfu : Bool :=
  r.closed && r.groups.all (·.shape = .seq) && r.pairFu = 0 && r.wait = .ryanmen

/-- The fu before rounding: 20 (futei) plus every part. -/
def raw : Nat := 20 + r.winFu + r.waitFu + r.pairFu + r.meldsFu

def up10 (v : Nat) : Nat := (v + 9) / 10 * 10

/-- The fu: pinfu is 20 by tsumo and 30 by ron (no tsumo fu); an open hand
won by ron with no fu at all is 30; otherwise the parts, rounded up to 10. -/
def fu : Nat :=
  if r.pinfu then (if r.ron then 30 else 20)
  else if !r.closed && r.raw = 20 then 30
  else up10 r.raw

end Reading

/-- Seven pairs: always 25 fu. -/
def chiitoitsuFu : Nat := 25

/-! ### Proofs -/

open Reading

variable (r : Reading)

theorem up10_dvd (v : Nat) : 10 ∣ up10 v := Dvd.intro_left _ rfl

theorem meldFu_le (g : Group) (c : Bool) : meldFu g c ≤ 32 := by
  unfold meldFu; split <;> simp

theorem meldFu_le_nokan (g : Group) (c : Bool) (h : g.kan = false) : meldFu g c ≤ 8 := by
  unfold meldFu; split <;> simp_all

/-- The table is the usual doubling rule: a terminal or honor doubles, being
concealed doubles, a kan is four times a triplet. -/
theorem meldFu_rule (g : Group) (c : Bool) (h : g.shape = .trip) :
    meldFu g c = 2 * (if isYaochu g.kind then 2 else 1) * (if c then 2 else 1) *
      (if g.kan then 4 else 1) := by
  rcases g with ⟨_ | _, k, _, _ | _, _⟩ <;> simp at h <;> cases c <;>
    cases hy : isYaochu k <;> simp [meldFu, hy]

theorem meldsFu_le : r.meldsFu ≤ 32 * r.groups.length := by
  unfold meldsFu
  have := List.sum_le_length_nsmul (r.groups.map fun g => meldFu g (r.concealed g)) 32
    (by simp only [List.mem_map]; rintro _ ⟨g, -, rfl⟩; exact meldFu_le _ _)
  simpa [mul_comm] using this

theorem meldsFu_le_nokan (h : ∀ g ∈ r.groups, g.kan = false) :
    r.meldsFu ≤ 8 * r.groups.length := by
  unfold meldsFu
  have := List.sum_le_length_nsmul (r.groups.map fun g => meldFu g (r.concealed g)) 8
    (by simp only [List.mem_map]; rintro _ ⟨g, hg, rfl⟩; exact meldFu_le_nokan _ _ (h g hg))
  simpa [mul_comm] using this

theorem pairFu_le : r.pairFu ≤ 6 := by unfold pairFu; split_ifs <;> omega

theorem waitFu_le : r.waitFu ≤ 2 := by unfold waitFu; split <;> omega

theorem winFu_le : r.winFu ≤ 10 := by unfold winFu; split_ifs <;> omega

/-- Every fu is a multiple of 10 (only seven pairs score 25). -/
theorem fu_dvd : 10 ∣ r.fu := by
  unfold fu; split_ifs <;> first | exact up10_dvd _ | norm_num

theorem fu_ge : 20 ≤ r.fu := by
  unfold fu up10 raw; split_ifs <;> omega

theorem raw_ge : 20 ≤ r.raw := by unfold raw; omega

/-- 20 fu is exactly a pinfu tsumo. -/
theorem fu_eq_20 : r.fu = 20 ↔ r.pinfu = true ∧ r.ron = false := by
  have hr : r.raw = 20 → r.ron = true ∧ r.closed = false := by
    intro h; unfold raw winFu at h
    cases h1 : r.ron <;> cases h2 : r.closed <;> simp [h1, h2] at h ⊢ <;> omega
  constructor
  · intro h
    unfold fu at h
    by_cases h1 : r.pinfu = true
    · rw [ite_eq_left h1] at h
      by_cases h2 : r.ron = true
      · rw [ite_eq_left h2] at h; omega
      · exact ⟨h1, by simpa using h2⟩
    · rw [ite_eq_right h1] at h
      by_cases h3 : (!r.closed && decide (r.raw = 20)) = true
      · rw [ite_eq_left h3] at h; omega
      · rw [ite_eq_right h3] at h
        exfalso
        have := raw_ge r
        unfold up10 at h
        have h4 : r.raw = 20 := by omega
        obtain ⟨-, hc⟩ := hr h4
        exact h3 (by simp [hc, h4])
  · rintro ⟨h1, h2⟩; simp [fu, h1, h2]

/-- An open hand scores at least 30 fu. -/
theorem fu_open (h : r.closed = false) : 30 ≤ r.fu := by
  have hp : r.pinfu = false := by simp [pinfu, h]
  have := raw_ge r
  unfold fu; rw [ite_eq_right (by simp [hp])]
  by_cases h3 : r.raw = 20
  · rw [ite_eq_left (by simp [h, h3])]
  · rw [ite_eq_right (by simp [h, h3])]; unfold up10; omega

/-- A ron scores at least 30 fu. -/
theorem fu_ron (h : r.ron = true) : 30 ≤ r.fu := by
  cases hc : r.closed
  · exact fu_open r hc
  · have : r.winFu = 10 := by simp [winFu, h, hc]
    unfold fu up10 raw; split_ifs <;> simp_all; omega

/-- With four groups the fu is at most 170 (four concealed terminal or honor
kans, a double wind pair, a tanki wait and a closed ron: 164). -/
theorem fu_le (h : r.groups.length ≤ 4) : r.fu ≤ 170 := by
  have := meldsFu_le r; have := pairFu_le r; have := waitFu_le r; have := winFu_le r
  unfold fu up10 raw; split_ifs <;> omega

/-- Without kans the fu is at most 70. -/
theorem fu_le_nokan (h : r.groups.length ≤ 4) (hk : ∀ g ∈ r.groups, g.kan = false) :
    r.fu ≤ 70 := by
  have := meldsFu_le_nokan r hk; have := pairFu_le r; have := waitFu_le r
  have := winFu_le r
  unfold fu up10 raw; split_ifs <;> omega

/-! ### Readings of a hand

`c` counts the concealed tiles (34 kinds), including the winning tile. -/

abbrev Counts := List Nat

def cnt (c : Counts) (k : Nat) : Nat := c.getD k 0

def take (c : Counts) (k n : Nat) : Counts := c.mapIdx fun i v => if i = k then v - n else v

/-- Every way to split `c` into exactly `n` groups, each list in ascending
order: the lowest tile left starts a triplet or a sequence. -/
def groupsOf : Nat → Counts → List (List Group)
  | 0, c => if c.all (· = 0) then [[]] else []
  | n + 1, c =>
    match (List.range 34).find? (0 < cnt c ·) with
    | none => []
    | some k =>
      (if 3 ≤ cnt c k then (groupsOf n (take c k 3)).map ({ shape := .trip, kind := k } :: ·)
        else []) ++
      (if !isHonor k && num k ≤ 7 && 0 < cnt c (k + 1) && 0 < cnt c (k + 2) then
        (groupsOf n (take (take (take c k 1) (k + 1) 1) (k + 2) 1)).map
          ({ shape := .seq, kind := k } :: ·)
      else [])

/-- The 4 groups + pair decompositions of concealed tiles `c` with the
called melds: (pair, concealed groups). -/
def decompositions (c : Counts) (called : List Group) : List (Nat × List Group) :=
  ((List.range 34).filter (2 ≤ cnt c ·)).flatMap fun p =>
    (groupsOf (4 - called.length) (take c p 2)).map (p, ·)

/-- Every reading of a hand won on `w`: the winning tile completes the pair
or one concealed group (identical groups give one reading). -/
def readings (c : Counts) (called : List Group) (w : Nat) (ron : Bool) (round seat : Nat) :
    List Reading :=
  (decompositions c called).flatMap fun (p, gs) =>
    let mk := fun (hs : List Group) => Reading.mk p (hs ++ called) w ron round seat
    (if p = w then [mk gs] else []) ++
      ((gs.eraseDups.filter (·.contains w)).map fun g => mk (gs.replace g { g with won := true }))

end MhjDojo.Fu
