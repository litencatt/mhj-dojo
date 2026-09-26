/-
Scoring: han and fu (or a number of yakuman) to points, as in
internal/score. Standard riichi rules as documented in docs/api.md: no
kiriage mangan, counted yakuman at 13 han, yakuman multiples.
-/
import Mathlib.Tactic.Ring
import Mathlib.Tactic.NormNum

namespace Mhj2

/-- `v` rounded up to a multiple of 100. -/
def up100 (v : Nat) : Nat := (v + 99) / 100 * 100

theorem up100_dvd (v : Nat) : 100 ∣ up100 v := ⟨(v + 99) / 100, by unfold up100; ring⟩

theorem le_up100 (v : Nat) : v ≤ up100 v := by unfold up100; omega

theorem up100_lt (v : Nat) : up100 v < v + 100 := by unfold up100; omega

/-- `up100 v` is the least multiple of 100 that is at least `v`. -/
theorem up100_le {v m : Nat} (h : 100 ∣ m) (hv : v ≤ m) : up100 v ≤ m := by
  obtain ⟨k, rfl⟩ := h; unfold up100; omega

theorem up100_mono {a b : Nat} (h : a ≤ b) : up100 a ≤ up100 b :=
  up100_le (up100_dvd b) (Nat.le_trans h (le_up100 b))

/-- Limit hands. -/
inductive Limit
  | none | mangan | haneman | baiman | sanbaiman | yakuman
  deriving DecidableEq, Repr

/-- The name internal/score uses for a limit ("" for none). -/
def Limit.name : Limit → String
  | .none => ""
  | .mangan => "mangan"
  | .haneman => "haneman"
  | .baiman => "baiman"
  | .sanbaiman => "sanbaiman"
  | .yakuman => "yakuman"

/-- The limit of a hand of `han` han and `fu` fu with `yak` yakuman. -/
def limitOf (han fu yak : Nat) : Limit :=
  if yak > 0 then .yakuman
  else if han ≥ 13 then .yakuman
  else if han ≥ 11 then .sanbaiman
  else if han ≥ 8 then .baiman
  else if han ≥ 6 then .haneman
  else if han ≥ 5 then .mangan
  else if fu * 2 ^ (han + 2) ≥ 2000 then .mangan
  else .none

/-- The number of yakuman scored: 1 for a counted yakuman. -/
def multOf (han yak : Nat) : Nat :=
  if yak > 0 then yak else if han ≥ 13 then 1 else 0

/-- Base points: fu × 2^(han+2) below mangan, capped at mangan (2000), then
the limits 3000 / 4000 / 6000 / 8000 per yakuman. -/
def basePts (han fu yak : Nat) : Nat :=
  if yak > 0 then 8000 * yak
  else if han ≥ 13 then 8000
  else if han ≥ 11 then 6000
  else if han ≥ 8 then 4000
  else if han ≥ 6 then 3000
  else if han ≥ 5 then 2000
  else min (fu * 2 ^ (han + 2)) 2000

/-- What a win is worth and who pays it (score.Points). -/
structure Points where
  limit : Limit
  mult : Nat
  total : Nat
  ron : Nat
  fromDealer : Nat
  fromNonDealer : Nat
  deriving DecidableEq, Repr

/-- score.Compute: a ron is 4 × base (6 × for the dealer) rounded up; on a
tsumo the dealer pays 2 × base and the others base each (a dealer's tsumo:
2 × base from each), each rounded up. No han and no yakuman is no win. -/
def compute (han fu yak : Nat) (dealer tsumo : Bool) : Points :=
  if han = 0 ∧ yak = 0 then ⟨.none, 0, 0, 0, 0, 0⟩ else
  let l := limitOf han fu yak
  let m := multOf han yak
  let b := basePts han fu yak
  match tsumo, dealer with
  | false, true => ⟨l, m, up100 (6 * b), up100 (6 * b), 0, 0⟩
  | false, false => ⟨l, m, up100 (4 * b), up100 (4 * b), 0, 0⟩
  | true, true => ⟨l, m, 3 * up100 (2 * b), 0, 0, up100 (2 * b)⟩
  | true, false => ⟨l, m, up100 (2 * b) + 2 * up100 b, 0, up100 (2 * b), up100 b⟩

/-- score.Half: one side of a payment split between two seats, rounded up. -/
def half (v : Nat) : Nat := up100 ((v + 1) / 2)

/-! ### Every payment is a multiple of 100 -/

theorem compute_dvd (han fu yak : Nat) (dealer tsumo : Bool) :
    let p := compute han fu yak dealer tsumo
    100 ∣ p.total ∧ 100 ∣ p.ron ∧ 100 ∣ p.fromDealer ∧ 100 ∣ p.fromNonDealer := by
  by_cases h : han = 0 ∧ yak = 0
  · simp [compute, h]
  · cases tsumo <;> cases dealer <;> simp only [compute, h, ↓reduceIte, up100] <;> omega

theorem half_dvd (v : Nat) : 100 ∣ half v := up100_dvd _

/-- The two halves cover the payment, with at most 100 over per half. -/
theorem half_bounds (v : Nat) : v ≤ 2 * half v ∧ 2 * half v < v + 200 := by
  unfold half; have := le_up100 ((v + 1) / 2); have := up100_lt ((v + 1) / 2); omega

/-! ### Tsumo against ron -/

/-- The tsumo payments add up to at least the ron value and at most 200
more (each is rounded up separately). -/
theorem tsumo_total_bounds (han fu yak : Nat) (dealer : Bool) :
    let r := (compute han fu yak dealer false).ron
    let t := (compute han fu yak dealer true).total
    r ≤ t ∧ t ≤ r + 200 := by
  unfold compute
  split_ifs
  · simp
  · generalize basePts han fu yak = b
    cases dealer
    · simp only
      have h1 := le_up100 (2 * b); have h2 := up100_lt (2 * b)
      have h3 := le_up100 b; have h4 := up100_lt b
      have h5 := le_up100 (4 * b); have h6 := up100_lt (4 * b)
      have hd : 100 ∣ up100 (2 * b) + 2 * up100 b := by simp only [up100]; omega
      refine ⟨up100_le hd (by omega), ?_⟩
      obtain ⟨x, hx⟩ := hd; obtain ⟨y, hy⟩ := up100_dvd (4 * b); omega
    · simp only
      have h1 := le_up100 (2 * b); have h2 := up100_lt (2 * b)
      have h5 := le_up100 (6 * b); have h6 := up100_lt (6 * b)
      have hd : 100 ∣ 3 * up100 (2 * b) := by simp only [up100]; omega
      refine ⟨up100_le hd (by omega), ?_⟩
      obtain ⟨x, hx⟩ := hd; obtain ⟨y, hy⟩ := up100_dvd (6 * b); omega

/-! ### Monotonic in han -/

theorem basePts_mono {h h' : Nat} (fu : Nat) (hh : h ≤ h') :
    basePts h fu 0 ≤ basePts h' fu 0 := by
  have hp : fu * 2 ^ (h + 2) ≤ fu * 2 ^ (h' + 2) :=
    Nat.mul_le_mul_left _ (Nat.pow_le_pow_right (by norm_num) (by omega))
  unfold basePts
  generalize fu * 2 ^ (h + 2) = x at *
  generalize fu * 2 ^ (h' + 2) = y at *
  split_ifs <;> omega

/-- For a fixed fu, more han never scores less (limits included), for every
payment. -/
theorem compute_mono {h h' : Nat} (fu : Nat) (dealer tsumo : Bool) (h1 : 1 ≤ h) (hh : h ≤ h') :
    let p := compute h fu 0 dealer tsumo
    let q := compute h' fu 0 dealer tsumo
    p.total ≤ q.total ∧ p.ron ≤ q.ron ∧ p.fromDealer ≤ q.fromDealer ∧
      p.fromNonDealer ≤ q.fromNonDealer := by
  have hb := basePts_mono fu hh
  have c1 : h ≠ 0 := by omega
  have c2 : h' ≠ 0 := by omega
  simp only [compute, c1, c2, false_and, ↓reduceIte]
  generalize basePts h fu 0 = a at *
  generalize basePts h' fu 0 = b at *
  have m2 := up100_mono (show 2 * a ≤ 2 * b by omega)
  have m1 := up100_mono hb
  have m4 := up100_mono (show 4 * a ≤ 4 * b by omega)
  have m6 := up100_mono (show 6 * a ≤ 6 * b by omega)
  cases tsumo <;> cases dealer <;> simp only <;> omega

/-! ### Limits -/

theorem limit_below_mangan (han fu : Nat) (h1 : 1 ≤ han) (h4 : han ≤ 4) :
    (limitOf han fu 0 = .mangan ↔ 2000 ≤ fu * 2 ^ (han + 2)) ∧
    (limitOf han fu 0 = .none ↔ fu * 2 ^ (han + 2) < 2000) := by
  unfold limitOf
  split_ifs <;> (try simp) <;> omega

theorem basePts_limits (han fu : Nat) :
    (han = 5 → basePts han fu 0 = 2000 ∧ limitOf han fu 0 = .mangan) ∧
    (6 ≤ han → han ≤ 7 → basePts han fu 0 = 3000 ∧ limitOf han fu 0 = .haneman) ∧
    (8 ≤ han → han ≤ 10 → basePts han fu 0 = 4000 ∧ limitOf han fu 0 = .baiman) ∧
    (11 ≤ han → han ≤ 12 → basePts han fu 0 = 6000 ∧ limitOf han fu 0 = .sanbaiman) ∧
    (13 ≤ han → basePts han fu 0 = 8000 ∧ limitOf han fu 0 = .yakuman ∧ multOf han 0 = 1) := by
  unfold basePts limitOf multOf
  refine ⟨?_, ?_, ?_, ?_, ?_⟩ <;> intros <;> split_ifs <;> first | omega | simp

/-- Below a limit the base points are exactly fu × 2^(han+2), under 2000. -/
theorem basePts_below (han fu : Nat) (h4 : han ≤ 4) (hb : fu * 2 ^ (han + 2) < 2000) :
    basePts han fu 0 = fu * 2 ^ (han + 2) := by
  unfold basePts
  split_ifs <;> omega

/-- n yakuman: 32000 × n by ron from a non-dealer, 48000 × n from the
dealer; by tsumo 8000 × n / 16000 × n each. -/
theorem yakuman_payments (han fu n : Nat) (hn : 0 < n) :
    (compute han fu n false false).ron = 32000 * n ∧
    (compute han fu n true false).ron = 48000 * n ∧
    (compute han fu n false true).fromDealer = 16000 * n ∧
    (compute han fu n false true).fromNonDealer = 8000 * n ∧
    (compute han fu n true true).fromNonDealer = 16000 * n ∧
    (compute han fu n false true).total = 32000 * n ∧
    (compute han fu n true true).total = 48000 * n := by
  have hc : ¬(han = 0 ∧ n = 0) := by omega
  simp only [compute, basePts, hc, hn, ↓reduceIte, up100]
  omega

end Mhj2
