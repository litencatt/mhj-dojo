/-
Round settlement, as in internal/game round.go (tsumo, ron, finish,
exhaustiveDraw): the hand's payments (with pao), the honba, the noten
penalty and the riichi sticks. Rules from docs/api.md.
-/
import Mhj2.Score
import Mathlib.Tactic.FinCases
import Mathlib.Tactic.Linarith
import Mathlib.Data.Fintype.Card

namespace Mhj2

abbrev Seat := Fin 4

/-- Points won (positive) or lost per seat. -/
abbrev Deltas := Seat → Int

def sum4 (d : Deltas) : Int := d 0 + d 1 + d 2 + d 3

def ind (b : Bool) : Int := if b then 1 else 0

/-- A payment: `(payer, receiver, amount)`. -/
abbrev Payment := Seat × Seat × Int

/-- The deltas of a list of payments. -/
def deltasOf (ps : List Payment) : Deltas := fun i =>
  (ps.map fun p => (if i = p.2.1 then p.2.2 else 0) - (if i = p.1 then p.2.2 else 0)).sum

theorem sum4_single (s : Seat) (a : Int) : sum4 (fun i => if i = s then a else 0) = a := by
  fin_cases s <;> simp [sum4]

/-- Payments move points between seats: they add up to zero. -/
theorem sum4_deltasOf (ps : List Payment) : sum4 (deltasOf ps) = 0 := by
  induction ps with
  | nil => simp [sum4, deltasOf]
  | cons p ps ih =>
    have h1 := sum4_single p.2.1 p.2.2
    have h2 := sum4_single p.1 p.2.2
    simp only [sum4, deltasOf, List.map_cons, List.sum_cons] at ih h1 h2 ⊢
    linarith

inductive Kind
  | tsumo | ron | draw | abort
  deriving DecidableEq, Repr

/-- A yakuman of the winning hand: how many yakuman it counts (2 for a double
yakuman) and its responsible seat (包), if any. -/
structure Part where
  mult : Nat
  pao : Option Seat
  deriving DecidableEq, Repr

/-- How a round ended. `han`/`fu` score a hand without yakuman; `parts` are
the yakuman of a yakuman hand. `deposit` is the sticks carried into the
round; `riichi` the seats whose riichi was accepted this round. -/
structure Input where
  kind : Kind
  dealer : Seat
  winner : Seat
  discarder : Seat
  honba : Nat
  deposit : Nat
  riichi : Seat → Bool
  tenpai : Seat → Bool
  han : Nat
  fu : Nat
  parts : List Part

namespace Input

variable (x : Input)

def isDealer : Bool := decide (x.winner = x.dealer)

/-- The number of yakuman. -/
def mult : Nat := (x.parts.map Part.mult).sum

def points (tsumo : Bool) : Points := compute x.han x.fu x.mult x.isDealer tsumo

/-- The responsible seats and the yakuman each is responsible for. -/
def paos : List (Seat × Nat) := x.parts.filterMap fun p => p.pao.map (·, p.mult)

def others : List Seat := (List.finRange 4).filter (· ≠ x.winner)

/-- Tsumo: each responsible seat pays its yakuman in full (the tsumo total
of that many yakuman); the others share the rest of the hand as usual. -/
def tsumoHand : List Payment :=
  let paoPays := x.paos.map fun (p, m) =>
    (p, x.winner, ((compute 0 0 m x.isDealer true).total : Int))
  let rest := if x.paos = [] then x.points true
    else compute 0 0 (x.mult - (x.paos.map Prod.snd).sum) x.isDealer true
  paoPays ++ x.others.map fun o =>
    (o, x.winner, ((if o = x.dealer then rest.fromDealer else rest.fromNonDealer : Nat) : Int))

/-- Ron: the discarder pays the hand, except that a responsible seat other
than the discarder pays half of its yakuman (rounded up) and the discarder
the other half. -/
def ronHand : List Payment :=
  let v := fun m => (compute 0 0 m x.isDealer false).ron
  let shared := x.paos.filter (·.1 ≠ x.discarder)
  (x.discarder, x.winner, ((x.points false).ron : Int) - ((shared.map fun q => (v q.2 : Int)).sum)) ::
    shared.flatMap fun (p, m) =>
      [(x.discarder, x.winner, (half (v m) : Int)), (p, x.winner, (half (v m) : Int))]

/-- The seat that pays all the honba of a tsumo: the responsible seat when
its pao covers the whole hand. -/
def honbaPayer : Option Seat :=
  match x.paos with
  | [] => none
  | (p, _) :: _ =>
    if x.paos.all (·.1 = p) ∧ (x.paos.map Prod.snd).sum = x.mult then some p else none

/-- Honba: 300 each from the discarder on a ron, 100 each from every other
seat on a tsumo (all 300 from a responsible seat covering the whole hand). -/
def honbaPays : List Payment :=
  let h : Int := x.honba
  match x.kind with
  | .ron => [(x.discarder, x.winner, 300 * h)]
  | .tsumo =>
    match x.honbaPayer with
    | some p => [(p, x.winner, 300 * h)]
    | none => x.others.map fun o => (o, x.winner, 100 * h)
  | _ => []

/-- The number of tenpai seats. -/
def tenpaiCount : Nat := (sum4 fun s => ind (x.tenpai s)).toNat

/-- The noten penalty: 3000 from the noten seats, shared by the tenpai
seats, when some but not all are tenpai. -/
def noten : Deltas := fun s =>
  let n := x.tenpaiCount
  if 0 < n ∧ n < 4 then
    if x.tenpai s then ((3000 / n : Nat) : Int) else -((3000 / (4 - n) : Nat) : Int)
  else 0

def won : Bool := x.kind = .tsumo || x.kind = .ron

/-- The sticks on the table at the end of the round, before a winner takes
them: the carried ones and this round's riichi. -/
def pot : Int := x.deposit + 1000 * sum4 fun s => ind (x.riichi s)

structure Output where
  hand : Deltas
  honba : Deltas
  stick : Deltas
  deposit : Int

/-- The settlement of a round. -/
def settle : Output where
  hand := match x.kind with
    | .tsumo => deltasOf x.tsumoHand
    | .ron => deltasOf x.ronHand
    | .draw => x.noten
    | .abort => fun _ => 0
  honba := deltasOf x.honbaPays
  stick := fun s => -1000 * ind (x.riichi s) + (if x.won ∧ s = x.winner then x.pot else 0)
  deposit := if x.won then 0 else x.pot

/-- The noten penalty adds up to zero. -/
theorem noten_sum : sum4 x.noten = 0 := by
  unfold noten tenpaiCount
  rcases h0 : x.tenpai 0 <;> rcases h1 : x.tenpai 1 <;> rcases h2 : x.tenpai 2 <;>
    rcases h3 : x.tenpai 3 <;> simp [sum4, ind, h0, h1, h2, h3]

/-- Conservation: the points the seats gain, plus the sticks left on the
table, are the sticks carried into the round. -/
theorem settle_conserves :
    sum4 x.settle.hand + sum4 x.settle.honba + sum4 x.settle.stick + x.settle.deposit =
      x.deposit := by
  have hh : sum4 x.settle.hand = 0 := by
    unfold settle
    cases x.kind <;> first | (simp only [sum4_deltasOf, noten_sum]; done) | simp [sum4]
  have hb : sum4 x.settle.honba = 0 := sum4_deltasOf _
  have hs : sum4 x.settle.stick = -1000 * sum4 (fun s => ind (x.riichi s)) +
      (if x.won then x.pot else 0) := by
    have := sum4_single x.winner x.pot
    unfold settle
    cases hw : x.won
    · simp [sum4]; ring
    · simp only [true_and, ↓reduceIte, sum4] at this ⊢; linarith
  rw [hh, hb, hs]
  unfold settle pot
  by_cases hw : x.won <;> simp [hw]

/-! ### Every delta is a multiple of 100 -/

theorem dvd_sum100 (l : List Int) (h : ∀ y ∈ l, (100 : Int) ∣ y) : (100 : Int) ∣ l.sum := by
  induction l with
  | nil => simp
  | cons a l ih =>
    have ha := h a (by simp)
    have hl := ih fun y hy => h y (by simp [hy])
    simp only [List.sum_cons]; omega

theorem dvd_deltasOf (ps : List Payment) (h : ∀ p ∈ ps, (100 : Int) ∣ p.2.2) (i : Seat) :
    (100 : Int) ∣ deltasOf ps i := by
  apply dvd_sum100
  intro y hy
  obtain ⟨p, hp, rfl⟩ := List.mem_map.1 hy
  have := h p hp
  split_ifs <;> omega

theorem dvd_cast {n : Nat} (h : 100 ∣ n) : (100 : Int) ∣ (n : Int) := by omega

theorem tsumoHand_dvd : ∀ p ∈ x.tsumoHand, (100 : Int) ∣ p.2.2 := by
  intro p hp
  simp only [tsumoHand, List.mem_append, List.mem_map] at hp
  rcases hp with ⟨q, _, rfl⟩ | ⟨o, _, rfl⟩
  · exact dvd_cast (compute_dvd _ _ _ _ _).1
  · apply dvd_cast
    split_ifs
    · exact (compute_dvd _ _ _ _ _).2.2.1
    · exact (compute_dvd _ _ _ _ _).2.2.1
    · exact (compute_dvd _ _ _ _ _).2.2.2
    · exact (compute_dvd _ _ _ _ _).2.2.2

theorem ronHand_dvd : ∀ p ∈ x.ronHand, (100 : Int) ∣ p.2.2 := by
  intro p hp
  simp only [ronHand, List.mem_cons, List.mem_flatMap] at hp
  rcases hp with rfl | ⟨q, _, hq⟩
  · apply Int.dvd_sub (dvd_cast (compute_dvd _ _ _ _ _).2.1)
    apply dvd_sum100
    intro y hy
    obtain ⟨q, _, rfl⟩ := List.mem_map.1 hy
    exact dvd_cast (compute_dvd _ _ _ _ _).2.1
  · simp only [List.not_mem_nil, or_false] at hq
    rcases hq with rfl | rfl <;> exact dvd_cast (half_dvd _)

theorem honbaPays_dvd : ∀ p ∈ x.honbaPays, (100 : Int) ∣ p.2.2 := by
  intro p hp
  unfold honbaPays at hp
  split at hp
  · simp only [List.mem_cons, List.not_mem_nil, or_false] at hp; subst hp; simp only; omega
  · split at hp
    · simp only [List.mem_cons, List.not_mem_nil, or_false] at hp; subst hp; simp only; omega
    · obtain ⟨o, _, rfl⟩ := List.mem_map.1 hp; simp only; omega
  · simp at hp

theorem noten_dvd (i : Seat) : (100 : Int) ∣ x.noten i := by
  unfold noten tenpaiCount
  rcases h0 : x.tenpai 0 <;> rcases h1 : x.tenpai 1 <;> rcases h2 : x.tenpai 2 <;>
    rcases h3 : x.tenpai 3 <;> fin_cases i <;> simp [sum4, ind, h0, h1, h2, h3]

/-- With the carried sticks in multiples of 100, every delta of a round is a
multiple of 100: so are the points of every seat, all game long. -/
theorem settle_dvd (hd : 100 ∣ x.deposit) (i : Seat) :
    (100 : Int) ∣ x.settle.hand i ∧ (100 : Int) ∣ x.settle.honba i ∧
      (100 : Int) ∣ x.settle.stick i ∧ (100 : Int) ∣ x.settle.deposit := by
  have hp : (100 : Int) ∣ x.pot := by unfold pot; omega
  refine ⟨?_, dvd_deltasOf _ x.honbaPays_dvd i, ?_, ?_⟩
  · unfold settle
    cases x.kind
    · exact dvd_deltasOf _ x.tsumoHand_dvd i
    · exact dvd_deltasOf _ x.ronHand_dvd i
    · exact x.noten_dvd i
    · simp
  · unfold settle; simp only; split_ifs <;> unfold ind <;> split_ifs <;> omega
  · unfold settle; simp only; split_ifs <;> omega

end Input

end Mhj2
