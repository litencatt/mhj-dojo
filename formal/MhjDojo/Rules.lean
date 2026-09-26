/-
Rule-level properties of the settlement, stated with the rule's own
numbers (32000 / 48000 per yakuman, 300 per honba) rather than in terms
of how `Settle.lean` computes them. The golden vectors only show that Go
computes what the model computes; these show that the model computes what
docs/api.md says:

* a yakuman win under pao pays the winner exactly the full hand, as without
  pao (`tsumo_pao`, `ron_pao`);
* on a tsumo, a responsible seat pays its yakuman in full, and every seat
  (responsible or not) pays its normal share of the rest of the hand
  (`tsumo_pao`);
* on a ron, a responsible seat other than the discarder pays half of its
  yakuman and never more than its full value (`ron_pao`, `ron_pao_le`);
* the winner receives 300 per honba, whoever pays it (`honba_winner`).
-/
import MhjDojo.Settle

namespace MhjDojo

/-- One yakuman: 32000 for a non-dealer, 48000 for the dealer. -/
def yakUnit (dealer : Bool) : Int := if dealer then 48000 else 32000

/-- What a yakuman hand (or none, with no han) pays, in terms of the rule. -/
theorem yak_points (han fu n : Nat) (d : Bool) (h : 0 < n ∨ han = 0) :
    ((compute han fu n d true).total : Int) = yakUnit d * n ∧
    ((compute han fu n d false).ron : Int) = yakUnit d * n ∧
    (compute han fu n d true).fromDealer = (if d then 0 else 16000 * n) ∧
    (compute han fu n d true).fromNonDealer = (if d then 16000 else 8000) * n := by
  by_cases hn : n = 0
  · subst hn
    have : han = 0 := by omega
    subst this
    simp [compute, yakUnit]
  · have hc : ¬(han = 0 ∧ n = 0) := by omega
    have hp : 0 < n := by omega
    cases d <;> simp only [compute, basePts, hc, hp, ↓reduceIte, up100, yakUnit,
      Bool.false_eq_true, true_and] <;> refine ⟨?_, ?_, ?_⟩ <;> try refine ⟨?_, ?_⟩
    all_goals omega

theorem half_yak (n : Nat) (d : Bool) :
    (half (compute 0 0 n d false).ron : Int) = yakUnit d / 2 * n := by
  have := (yak_points 0 0 n d (Or.inr rfl)).2.1
  cases d <;> simp only [yakUnit, Bool.false_eq_true, ↓reduceIte] at this ⊢ <;>
    simp only [half, up100] <;> omega

theorem sum4_ite (d : Seat) (a b : Int) : sum4 (fun o => if o = d then a else b) = a + 3 * b := by
  fin_cases d <;> simp [sum4] <;> ring

/-! ### Payments as deltas -/

theorem deltasOf_nil (i : Seat) : deltasOf [] i = 0 := by simp [deltasOf]

theorem deltasOf_cons (p : Payment) (ps : List Payment) (i : Seat) :
    deltasOf (p :: ps) i =
      ((if i = p.2.1 then p.2.2 else 0) - (if i = p.1 then p.2.2 else 0)) + deltasOf ps i := by
  simp [deltasOf]

theorem deltasOf_append (a b : List Payment) (i : Seat) :
    deltasOf (a ++ b) i = deltasOf a i + deltasOf b i := by
  simp [deltasOf]

theorem deltasOf_flatMap {α} (l : List α) (f : α → List Payment) (i : Seat) :
    deltasOf (l.flatMap f) i = (l.map fun q => deltasOf (f q) i).sum := by
  induction l with
  | nil => simp [deltasOf_nil]
  | cons a l ih => simp [List.flatMap_cons, deltasOf_append, ih]

/-- Payments of `T` from each responsible seat to the winner. -/
theorem deltasOf_paos (l : List (Seat × Nat)) (w s : Seat) (T : Nat → Int) :
    deltasOf (l.map fun q => (q.1, w, T q.2)) s =
      (if s = w then (l.map fun q => T q.2).sum else 0) -
        (l.map fun q => if s = q.1 then T q.2 else 0).sum := by
  induction l with
  | nil => simp [deltasOf_nil]
  | cons a l ih =>
    obtain ⟨p, m⟩ := a
    rw [List.map_cons, deltasOf_cons, ih]
    simp only [List.map_cons, List.sum_cons]
    split_ifs <;> ring

/-- A payment of `f o` from every seat `o` other than the winner. -/
theorem deltasOf_others (w s : Seat) (f : Seat → Int) :
    deltasOf (((List.finRange 4).filter (· ≠ w)).map fun o => (o, w, f o)) s =
      if s = w then sum4 f - f w else -f s := by
  have h0 : (List.finRange 4).filter (fun x => !decide (x = (0 : Seat))) = [1, 2, 3] := by decide
  have h1 : (List.finRange 4).filter (fun x => !decide (x = (1 : Seat))) = [0, 2, 3] := by decide
  have h2 : (List.finRange 4).filter (fun x => !decide (x = (2 : Seat))) = [0, 1, 3] := by decide
  have h3 : (List.finRange 4).filter (fun x => !decide (x = (3 : Seat))) = [0, 1, 2] := by decide
  fin_cases w <;> fin_cases s <;> simp [h0, h1, h2, h3, deltasOf, sum4] <;> ring

theorem sum_mul (l : List (Seat × Nat)) (c : Int) :
    (l.map fun q => c * (q.2 : Int)).sum = c * ((l.map Prod.snd).sum : Nat) := by
  induction l with
  | nil => simp
  | cons a l ih => simp only [List.map_cons, List.sum_cons, ih]; push_cast; ring

theorem sum_ite_mul (l : List (Seat × Nat)) (s : Seat) (c : Int) :
    (l.map fun q => if s = q.1 then c * (q.2 : Int) else 0).sum =
      c * (l.map fun q => if s = q.1 then (q.2 : Int) else 0).sum := by
  induction l with
  | nil => simp
  | cons a l ih => simp only [List.map_cons, List.sum_cons, ih]; split_ifs <;> ring

theorem sum_ite_zero (l : List (Seat × Nat)) (s : Seat) (h : ∀ q ∈ l, s ≠ q.1) :
    (l.map fun q => if s = q.1 then (q.2 : Int) else 0).sum = 0 := by
  induction l with
  | nil => simp
  | cons a l ih =>
    simp only [List.map_cons, List.sum_cons]
    rw [ite_eq_right_iff.2 fun e => absurd e (h a (by simp)), ih fun q hq => h q (by simp [hq])]; simp

theorem paos_le (ps : List Part) :
    ((ps.filterMap fun p => p.pao.map (·, p.mult)).map Prod.snd).sum ≤ (ps.map Part.mult).sum := by
  induction ps with
  | nil => simp
  | cons p ps ih => cases h : p.pao <;> simp [h] <;> omega

namespace Input

variable (x : Input)

/-- The yakuman a seat is responsible for. -/
def paoAt (s : Seat) : Int := (x.paos.map fun q => if s = q.1 then (q.2 : Int) else 0).sum

/-- The yakuman under pao. -/
def paoMult : Nat := (x.paos.map Prod.snd).sum

/-- A seat's normal share of a tsumo of `n` yakuman: 16000 × n from the
dealer (or from everyone when the dealer wins), 8000 × n from the others. -/
def share (s : Seat) (n : Nat) : Int :=
  if x.isDealer ∨ s = x.dealer then 16000 * n else 8000 * n

theorem paoMult_le : x.paoMult ≤ x.mult := paos_le x.parts

/-- Tsumo of a yakuman hand under pao (responsible seats other than the
winner): the winner receives the full hand, 32000 (48000 for the dealer)
per yakuman, exactly as without pao; every other seat pays in full the
yakuman it is responsible for plus its normal share of the yakuman not
under pao (a seat with no pao pays just its normal share). -/
theorem tsumo_pao (hyak : 0 < x.mult) (hpw : ∀ q ∈ x.paos, q.1 ≠ x.winner) :
    deltasOf x.tsumoHand x.winner = ((x.points true).total : Int) ∧
    ((x.points true).total : Int) = yakUnit x.isDealer * x.mult ∧
    ∀ s, s ≠ x.winner →
      deltasOf x.tsumoHand s = -(yakUnit x.isDealer * x.paoAt s + x.share s (x.mult - x.paoMult)) := by
  have hle := x.paoMult_le
  have hpts := yak_points x.han x.fu x.mult x.isDealer (Or.inl hyak)
  -- the rest of the hand, shared as usual
  let R := if x.paos = [] then x.points true
    else compute 0 0 (x.mult - x.paoMult) x.isDealer true
  have hR : R.fromDealer = (if x.isDealer then 0 else 16000 * (x.mult - x.paoMult)) ∧
      R.fromNonDealer = (if x.isDealer then 16000 else 8000) * (x.mult - x.paoMult) := by
    by_cases hp : x.paos = []
    · have h0 : x.paoMult = 0 := by simp [paoMult, hp]
      simp only [R, hp, ↓reduceIte, points, h0, Nat.sub_zero]
      exact ⟨hpts.2.2.1, hpts.2.2.2⟩
    · have := yak_points 0 0 (x.mult - x.paoMult) x.isDealer (Or.inr rfl)
      simp only [R, hp, ↓reduceIte]
      exact ⟨this.2.2.1, this.2.2.2⟩
  let f : Seat → Int := fun o => ((if o = x.dealer then R.fromDealer else R.fromNonDealer : Nat) : Int)
  have ht : ∀ s, deltasOf x.tsumoHand s =
      deltasOf (x.paos.map fun q => (q.1, x.winner, ((compute 0 0 q.2 x.isDealer true).total : Int))) s +
        deltasOf (((List.finRange 4).filter (· ≠ x.winner)).map fun o => (o, x.winner, f o)) s :=
    fun s => deltasOf_append _ _ s
  have hT : ∀ m, ((compute 0 0 m x.isDealer true).total : Int) = yakUnit x.isDealer * m :=
    fun m => (yak_points 0 0 m x.isDealer (Or.inr rfl)).1
  have hpaos : ∀ s, deltasOf (x.paos.map fun q =>
      (q.1, x.winner, ((compute 0 0 q.2 x.isDealer true).total : Int))) s =
      (if s = x.winner then yakUnit x.isDealer * x.paoMult else 0) - yakUnit x.isDealer * x.paoAt s := by
    intro s
    have := deltasOf_paos x.paos x.winner s fun m => ((compute 0 0 m x.isDealer true).total : Int)
    rw [this]
    simp only [hT, sum_mul, sum_ite_mul, paoMult, paoAt]
  have hsum : sum4 f = ((R.fromDealer : Nat) : Int) + 3 * ((R.fromNonDealer : Nat) : Int) := by
    rw [← sum4_ite x.dealer]; simp only [f, sum4]; push_cast; rfl
  have hw0 : x.paoAt x.winner = 0 := sum_ite_zero _ _ fun q hq => (hpw q hq).symm
  have hd : x.isDealer = true ↔ x.winner = x.dealer := by simp [isDealer]
  refine ⟨?_, by simp only [points]; exact hpts.1, ?_⟩
  · rw [ht, hpaos, deltasOf_others, hsum, hw0]
    simp only [points]
    rw [hpts.1]
    simp only [↓reduceIte, f]
    cases hdl : x.isDealer
    · have : x.winner ≠ x.dealer := fun e => by simp [hd.2 e] at hdl
      simp only [this, ↓reduceIte, hR, hdl, yakUnit, Bool.false_eq_true]; push_cast; omega
    · have : x.winner = x.dealer := hd.1 hdl
      simp only [this, ↓reduceIte, hR, hdl, yakUnit]; push_cast; omega
  · intro s hs
    rw [ht, hpaos, deltasOf_others]
    simp only [hs, ↓reduceIte, f, share]
    cases hdl : x.isDealer
    · have : x.winner ≠ x.dealer := fun e => by simp [hd.2 e] at hdl
      by_cases hsd : s = x.dealer
      · simp only [hsd, ↓reduceIte, hR, hdl, yakUnit, Bool.false_eq_true, or_true]; push_cast; ring
      · simp only [hsd, ↓reduceIte, hR, hdl, yakUnit, Bool.false_eq_true, or_false]; push_cast; ring
    · have hsd : s ≠ x.dealer := fun e => hs (e.trans (hd.1 hdl).symm)
      simp only [hsd, ↓reduceIte, hR, hdl, yakUnit, true_or]; push_cast; ring

/-- The payments of the responsible seats' halves on a ron. -/
theorem deltasOf_halves (l : List (Seat × Nat)) (d w s : Seat) (H : Nat → Int) :
    deltasOf (l.flatMap fun q => [(d, w, H q.2), (q.1, w, H q.2)]) s =
      (if s = w then 2 * (l.map fun q => H q.2).sum else 0) -
        (if s = d then (l.map fun q => H q.2).sum else 0) -
        (l.map fun q => if s = q.1 then H q.2 else 0).sum := by
  induction l with
  | nil => simp [deltasOf_nil]
  | cons a l ih =>
    rw [List.flatMap_cons, deltasOf_append, ih, deltasOf_cons, deltasOf_cons, deltasOf_nil]
    simp only [List.map_cons, List.sum_cons]
    split_ifs <;> ring

theorem sum_filter_ne (l : List (Seat × Nat)) (d s : Seat) (hs : s ≠ d) :
    ((l.filter (·.1 ≠ d)).map fun q => if s = q.1 then (q.2 : Int) else 0).sum =
      (l.map fun q => if s = q.1 then (q.2 : Int) else 0).sum := by
  induction l with
  | nil => simp
  | cons a l ih =>
    by_cases h : a.1 = d
    · have : ¬s = a.1 := fun e => hs (e.trans h)
      rw [List.filter_cons_of_neg (by simpa using h)]
      simp only [List.map_cons, List.sum_cons, this, ↓reduceIte, zero_add, ih]
    · rw [List.filter_cons_of_pos (by simpa using h)]
      simp only [List.map_cons, List.sum_cons, ih]

/-- The yakuman under pao of seats other than the discarder. -/
def paoShared : Nat := ((x.paos.filter (·.1 ≠ x.discarder)).map Prod.snd).sum

/-- Ron of a yakuman hand under pao (responsible seats other than the
winner, a discarder other than the winner): the winner receives the full
hand, 32000 (48000 for the dealer) per yakuman, exactly as without pao;
each responsible seat other than the discarder pays half of its yakuman,
the discarder the rest; nobody else pays. -/
theorem ron_pao (hyak : 0 < x.mult) (hpw : ∀ q ∈ x.paos, q.1 ≠ x.winner)
    (hdw : x.discarder ≠ x.winner) :
    deltasOf x.ronHand x.winner = ((x.points false).ron : Int) ∧
    ((x.points false).ron : Int) = yakUnit x.isDealer * x.mult ∧
    deltasOf x.ronHand x.discarder =
      -(yakUnit x.isDealer * x.mult - yakUnit x.isDealer / 2 * x.paoShared) ∧
    ∀ s, s ≠ x.winner → s ≠ x.discarder →
      deltasOf x.ronHand s = -(yakUnit x.isDealer / 2 * x.paoAt s) := by
  have hpts := yak_points x.han x.fu x.mult x.isDealer (Or.inl hyak)
  have hV : ∀ m, ((compute 0 0 m x.isDealer false).ron : Int) = yakUnit x.isDealer * m :=
    fun m => (yak_points 0 0 m x.isDealer (Or.inr rfl)).2.1
  have hH : ∀ m, (half (compute 0 0 m x.isDealer false).ron : Int) = yakUnit x.isDealer / 2 * m :=
    fun m => half_yak m x.isDealer
  let shared := x.paos.filter (·.1 ≠ x.discarder)
  have ht : ∀ s, deltasOf x.ronHand s =
      ((if s = x.winner then (((x.points false).ron : Int) -
          (shared.map fun q => ((compute 0 0 q.2 x.isDealer false).ron : Int)).sum) else 0) -
        (if s = x.discarder then (((x.points false).ron : Int) -
          (shared.map fun q => ((compute 0 0 q.2 x.isDealer false).ron : Int)).sum) else 0)) +
      deltasOf (shared.flatMap fun q =>
        [(x.discarder, x.winner, (half (compute 0 0 q.2 x.isDealer false).ron : Int)),
         (q.1, x.winner, (half (compute 0 0 q.2 x.isDealer false).ron : Int))]) s :=
    fun s => deltasOf_cons _ _ s
  have hS : (shared.map fun q => ((compute 0 0 q.2 x.isDealer false).ron : Int)).sum =
      yakUnit x.isDealer * x.paoShared := by
    simp only [hV, sum_mul, paoShared, shared]
  have hhalf : ∀ s, deltasOf (shared.flatMap fun q =>
        [(x.discarder, x.winner, (half (compute 0 0 q.2 x.isDealer false).ron : Int)),
         (q.1, x.winner, (half (compute 0 0 q.2 x.isDealer false).ron : Int))]) s =
      (if s = x.winner then 2 * (yakUnit x.isDealer / 2 * x.paoShared) else 0) -
        (if s = x.discarder then yakUnit x.isDealer / 2 * x.paoShared else 0) -
        yakUnit x.isDealer / 2 * (shared.map fun q => if s = q.1 then (q.2 : Int) else 0).sum := by
    intro s
    rw [deltasOf_halves shared x.discarder x.winner s
      fun m => (half (compute 0 0 m x.isDealer false).ron : Int)]
    simp only [hH, sum_mul, sum_ite_mul, paoShared, shared]
  have hmem : ∀ q ∈ shared, q.1 ≠ x.winner ∧ q.1 ≠ x.discarder := fun q hq => by
    have := List.mem_filter.1 hq
    exact ⟨hpw q this.1, by simpa using this.2⟩
  have hR : ((x.points false).ron : Int) = yakUnit x.isDealer * x.mult := by
    simp only [points]; exact hpts.2.1
  refine ⟨?_, hR, ?_, ?_⟩
  · rw [ht, hhalf, hS, sum_ite_zero _ _ fun q hq => (hmem q hq).1.symm]
    simp only [↓reduceIte, hdw.symm]
    cases hdl : x.isDealer <;> simp only [yakUnit, Bool.false_eq_true, ↓reduceIte] <;> ring
  · rw [ht, hhalf, hS, sum_ite_zero _ _ fun q hq => (hmem q hq).2.symm, hR]
    simp only [↓reduceIte, hdw]
    cases hdl : x.isDealer <;> simp only [yakUnit, Bool.false_eq_true, ↓reduceIte] <;> ring
  · intro s hs hsd
    rw [ht, hhalf, sum_filter_ne _ _ _ hsd]
    simp only [hs, hsd, ↓reduceIte, paoAt]
    ring

/-- On a ron, a responsible seat other than the discarder never pays more
than the full value of the yakuman it is responsible for. -/
theorem ron_pao_le (hyak : 0 < x.mult) (hpw : ∀ q ∈ x.paos, q.1 ≠ x.winner)
    (hdw : x.discarder ≠ x.winner) (s : Seat) (hs : s ≠ x.winner) (hsd : s ≠ x.discarder) :
    0 ≤ -deltasOf x.ronHand s ∧ -deltasOf x.ronHand s ≤ yakUnit x.isDealer * x.paoAt s := by
  rw [(x.ron_pao hyak hpw hdw).2.2.2 s hs hsd]
  have : 0 ≤ x.paoAt s := by
    unfold paoAt
    induction x.paos with
    | nil => simp
    | cons a l ih => simp only [List.map_cons, List.sum_cons]; split_ifs <;> omega
  unfold yakUnit; split_ifs <;> constructor <;> omega

theorem honbaPayer_mem {p : Seat} (h : x.honbaPayer = some p) : ∃ q ∈ x.paos, q.1 = p := by
  unfold honbaPayer at h
  split at h
  · cases h
  · rename_i q r heq
    split_ifs at h
    cases h
    exact ⟨(p, q), by rw [heq]; simp, rfl⟩

/-- The winner receives 300 per honba on every win: from the discarder on a
ron, 100 from each other seat on a tsumo, or all 300 from a responsible
seat whose pao covers the whole hand. -/
theorem honba_winner (hk : x.kind = .tsumo ∨ x.kind = .ron) (hpw : ∀ q ∈ x.paos, q.1 ≠ x.winner)
    (hdw : x.kind = .ron → x.discarder ≠ x.winner) :
    deltasOf x.honbaPays x.winner = 300 * x.honba := by
  rcases hk with hk | hk
  · unfold honbaPays
    simp only [hk]
    cases hp : x.honbaPayer with
    | some p =>
      obtain ⟨q, hq, rfl⟩ := x.honbaPayer_mem hp
      have := hpw q hq
      simp only [deltasOf_cons, deltasOf_nil, ↓reduceIte, Ne.symm this]
      ring
    | none =>
      have := deltasOf_others x.winner x.winner fun _ => 100 * (x.honba : Int)
      simp only [others]
      rw [this]
      simp [sum4]; ring
  · unfold honbaPays
    simp only [hk, deltasOf_cons, deltasOf_nil, ↓reduceIte, Ne.symm (hdw hk)]
    ring

end Input

end MhjDojo
