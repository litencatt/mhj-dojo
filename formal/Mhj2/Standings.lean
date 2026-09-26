/-
Final standings of a game, as in internal/game hanchan.go (Standings):
rank by points, ties to the seat nearer the first dealer; score
(points − 30000) / 1000 + uma (+20 / +10 / −10 / −20) + oka (+20 to first);
sticks left on the table at the end go to first place.
-/
import Mathlib.Algebra.BigOperators.Fin
import Mathlib.Data.Fintype.Card
import Mathlib.Tactic.LinearCombination
import Mathlib.Tactic.Linarith
import Mathlib.Tactic.Ring
import Mathlib.Tactic.Choose

namespace Mhj2.Standings

open Finset

/-- The points each seat starts with and the points the score is measured
from (game.HanchanRule / game.Tonpuu). -/
def start : Int := 25000
def ret : Int := 30000

/-- Uma by rank (0 = first), in thousands. -/
def uma : Fin 4 → Int := ![20, 10, -10, -20]

structure Input where
  points : Fin 4 → Int
  firstDealer : Fin 4
  /-- Riichi sticks on the table. -/
  deposit : Int
  /-- The game is over: the sticks go to first place and scores are final. -/
  over : Bool

variable (x : Input)

namespace Input

/-- Seats after the first dealer in turn order (the first dealer is 0). -/
def near (s : Fin 4) : Nat := (s.val + 4 - x.firstDealer.val) % 4

/-- `t` ranks above `s`: more points, or as many and nearer the first dealer. -/
def beats (t s : Fin 4) : Prop :=
  x.points s < x.points t ∨ (x.points t = x.points s ∧ x.near t < x.near s)

instance : DecidableRel x.beats := fun _ _ => by unfold beats; infer_instance

/-- The rank (0 = first): how many seats rank above. -/
def rankN (s : Fin 4) : Nat := (univ.filter fun t => x.beats t s).card

theorem beats_irrefl (s : Fin 4) : ¬x.beats s s := by unfold beats; omega

theorem beats_trans {a b c : Fin 4} : x.beats a b → x.beats b c → x.beats a c := by
  unfold beats; omega

theorem near_inj {s t : Fin 4} (h : x.near s = x.near t) : s = t := by
  have := s.isLt; have := t.isLt; have := x.firstDealer.isLt
  unfold near at h; ext; omega

theorem beats_total {s t : Fin 4} (h : s ≠ t) : x.beats s t ∨ x.beats t s := by
  have : x.near s ≠ x.near t := fun e => h (x.near_inj e)
  unfold beats; omega

theorem rankN_lt (s : Fin 4) : x.rankN s < 4 := by
  have h : (univ.filter fun t => x.beats t s) ⊂ univ :=
    filter_ssubset.2 ⟨s, mem_univ _, x.beats_irrefl s⟩
  simpa [rankN] using card_lt_card h

def rank (s : Fin 4) : Fin 4 := ⟨x.rankN s, x.rankN_lt s⟩

/-- A seat ranks strictly above every seat it beats. -/
theorem rankN_lt_of_beats {s t : Fin 4} (h : x.beats t s) : x.rankN t < x.rankN s := by
  unfold rankN
  apply card_lt_card
  rw [ssubset_iff_of_subset]
  · exact ⟨t, by simp [h], by simp [x.beats_irrefl]⟩
  · intro u
    simp only [mem_filter, mem_univ, true_and]
    exact fun hu => x.beats_trans hu h

/-- More points rank higher. -/
theorem rank_points {s t : Fin 4} (h : x.points t < x.points s) : x.rankN s < x.rankN t :=
  x.rankN_lt_of_beats (Or.inl h)

/-- A tie goes to the seat nearer the first dealer. -/
theorem rank_tie {s t : Fin 4} (h : x.points s = x.points t) (hn : x.near s < x.near t) :
    x.rankN s < x.rankN t :=
  x.rankN_lt_of_beats (Or.inr ⟨h, hn⟩)

/-- No two seats share a rank. -/
theorem rank_injective : Function.Injective x.rank := by
  intro s t h
  by_contra hne
  have h' : x.rankN s = x.rankN t := congrArg Fin.val h
  rcases x.beats_total hne with hb | hb
  · have := x.rankN_lt_of_beats hb; omega
  · have := x.rankN_lt_of_beats hb; omega

theorem rank_bijective : Function.Bijective x.rank :=
  Finite.injective_iff_bijective.1 x.rank_injective

/-- 1 for first place. -/
def first (s : Fin 4) : Int := if x.rank s = 0 then 1 else 0

/-- Points, plus the sticks left on the table for first place at the end. -/
def final (s : Fin 4) : Int := x.points s + (if x.over then x.deposit else 0) * x.first s

/-- The score in points: final − 30000 + uma + oka (4 × 5000 to first). -/
def total (s : Fin 4) : Int :=
  x.final s - ret + uma (x.rank s) * 1000 + 4 * (ret - start) * x.first s

/-- The score in tenths (Go: float64(total/100)/10, truncating). -/
def scoreTenths (s : Fin 4) : Int := (x.total s).tdiv 100

theorem sum_uma : ∑ s, uma (x.rank s) = 0 := by
  rw [x.rank_bijective.sum_comp uma]; simp [Fin.sum_univ_four, uma]

/-- Exactly one seat is first. -/
theorem sum_first : ∑ s, x.first s = 1 := by
  unfold first
  rw [x.rank_bijective.sum_comp (fun r => if r = 0 then (1 : Int) else 0)]
  simp

/-- The scores (in points) add up to the points and sticks at the end minus
the starting points: zero when points are conserved. -/
theorem sum_total :
    ∑ s, x.total s = ∑ s, x.points s + (if x.over then x.deposit else 0) - 4 * start := by
  have h1 := x.sum_uma
  have h2 := x.sum_first
  simp only [Fin.sum_univ_four, total, final] at h1 h2 ⊢
  unfold ret start
  linear_combination (1000 : Int) * h1 + ((if x.over then x.deposit else 0) + 20000) * h2

/-- Once the game is over, with every seat's points and the sticks in
multiples of 100 (every payment is, see `compute_dvd`) and the points and
sticks adding up to the starting points, the scores add up to exactly 0. -/
theorem sum_score (hover : x.over = true) (hsum : ∑ s, x.points s + x.deposit = 4 * start)
    (hp : ∀ s, 100 ∣ x.points s) (hd : 100 ∣ x.deposit) : ∑ s, x.scoreTenths s = 0 := by
  have hdiv : ∀ s, ∃ q, x.total s = 100 * q := by
    intro s
    obtain ⟨a, ha⟩ := hp s
    obtain ⟨b, hb⟩ := hd
    refine ⟨a + b * x.first s - 300 + uma (x.rank s) * 10 + 200 * x.first s, ?_⟩
    simp only [total, final, hover, ↓reduceIte, ret, start, ha, hb]; ring
  choose q hq using hdiv
  have hs : ∀ s, x.scoreTenths s = q s := fun s => by
    simp [scoreTenths, hq s]
  have ht := x.sum_total
  simp only [hover, ↓reduceIte] at ht
  simp only [hs, hq] at ht ⊢
  rw [← Finset.mul_sum] at ht
  omega

end Input

end Mhj2.Standings
