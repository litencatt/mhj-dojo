import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { GameState, YakuRow } from '../api';
import { initialProgress, loadProgress, payRounds, saveProgress, settle, type DojoProgress, type Reward } from './progress';

/**
 * A dojo game's side of the dojo (GameApp with dojo): its progress, what it
 * owns and what it pays (its looks, as every mode's, are looks.tsx's). A won
 * round pays its han as it ends (progress.paidRounds keeps the rounds paid,
 * by the game's id); a finished game pays the rest once (progress.settle
 * keeps the seeds paid). Both read fresh from storage so that another tab's
 * purchases are not lost. Off (a CPU game) it owns nothing and does nothing.
 */
export function useDojoGame(dojo: boolean, state: GameState | null) {
  // The dojo's growth: read at the start, kept as it changes (the payments below).
  const [progress, setProgress] = useState<DojoProgress>(() => (dojo ? loadProgress().progress : initialProgress()));
  const [saveFailed, setSaveFailed] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const has = (id: string) => dojo && (progress.ownedItems.includes(id) || progress.ownedYaku.includes(id));
  // The yaku learned, for the rows shown (useLearnedRows) and the aids.
  const learned = useMemo(() => new Set(progress.ownedYaku), [progress.ownedYaku]);

  useEffect(() => {
    if (!dojo || !state) return;
    if (!state.game_over) {
      const paid = payRounds(loadProgress().progress, state.game_id, state.rounds);
      if (!paid) return;
      setSaveFailed(!saveProgress(paid.progress));
      setProgress(paid.progress);
      return;
    }
    const { progress: next, reward: paid } = settle(loadProgress().progress, state, state.game_id);
    if (!paid) return;
    setSaveFailed(!saveProgress(next));
    setProgress(next);
    setReward(paid);
  }, [state]);

  // A lesson's success (useLesson) saved the progress: shown here too, its reward with it.
  const update = useCallback((p: DojoProgress) => setProgress(p), []);

  return { progress, has, learned, reward, saveFailed, update };
}

/**
 * The analysis, the per-discard rows and the chart's history as a dojo game
 * shows them: the rows of the yaku learned (and the general form) only. A CPU
 * game shows them all.
 */
export function useLearnedRows(dojo: boolean, learned: Set<string>, state: GameState | null) {
  const keepRow = useCallback((key: string) => !dojo || key === 'normal' || learned.has(key), [dojo, learned]);
  const analysis = useMemo(() => state?.analysis.filter((r: YakuRow) => keepRow(r.key)), [state, keepRow]);
  const byDiscard = useMemo(
    () =>
      dojo && state
        ? Object.fromEntries(Object.entries(state.by_discard).map(([t, rows]) => [t, rows.filter((r) => keepRow(r.key))]))
        : state?.by_discard,
    [state, dojo, keepRow],
  );
  const history = useMemo(
    () =>
      dojo && state
        ? state.history.map((h) => ({ ...h, shanten: Object.fromEntries(Object.entries(h.shanten).filter(([k]) => keepRow(k))) }))
        : state?.history,
    [state, dojo, keepRow],
  );
  return { analysis, byDiscard, history };
}
