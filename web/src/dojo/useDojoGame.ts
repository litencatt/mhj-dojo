import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { GameState, YakuRow } from '../api';
import { TILE_BACKS, TILE_THEMES, applyRiichiStick, applyTableCloth, applyTileBack, applyTileTheme, applyWinEffect } from '../tileThemes';
import { initialProgress, loadProgress, payRounds, saveProgress, settle, type DojoProgress, type Reward } from './progress';

/**
 * A dojo game's side of the dojo (GameApp with dojo): its progress, what it
 * owns, the looks it shows and what it pays. A won round pays its han as it
 * ends (progress.paidRounds keeps the rounds paid, by the game's id); a
 * finished game pays the rest once (progress.settle keeps the seeds paid).
 * Both read fresh from storage so that another tab's purchases are not lost.
 * Off (a CPU game) it owns nothing and does nothing.
 */
export function useDojoGame(dojo: boolean, state: GameState | null) {
  // The dojo's growth: read at the start, kept as it changes (the payments below).
  const [progress, setProgress] = useState<DojoProgress>(() => (dojo ? loadProgress().progress : initialProgress()));
  const [saveFailed, setSaveFailed] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const has = (id: string) => dojo && (progress.ownedItems.includes(id) || progress.ownedYaku.includes(id));
  // The yaku learned, for the rows shown (useLearnedRows) and the aids.
  const learned = useMemo(() => new Set(progress.ownedYaku), [progress.ownedYaku]);

  // The tile theme, back and other looks bought in the dojo, for the dojo's screens only.
  useEffect(() => {
    if (!dojo) return;
    applyTileTheme(TILE_THEMES.find((t) => t.item === progress.activeTheme)?.id ?? 'default');
    return () => applyTileTheme('default');
  }, [dojo, progress.activeTheme]);
  useEffect(() => {
    if (!dojo) return;
    applyTileBack(TILE_BACKS.find((t) => t.item === progress.activeBack)?.id ?? 'default');
    return () => applyTileBack('default');
  }, [dojo, progress.activeBack]);
  useEffect(() => {
    if (!dojo) return;
    applyTableCloth(progress.activeCloth);
    applyRiichiStick(progress.activeStick);
    applyWinEffect(progress.activeEffect);
    return () => {
      applyTableCloth('default');
      applyRiichiStick('default');
      applyWinEffect('default');
    };
  }, [dojo, progress.activeCloth, progress.activeStick, progress.activeEffect]);

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

  return { progress, has, learned, reward, saveFailed };
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
