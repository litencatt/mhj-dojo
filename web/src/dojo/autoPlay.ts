import { useCallback, useState } from 'preact/hooks';
import type { ActionType, GameState, Tile } from '../api';

/**
 * The dojo's automations (#277), each a bought assist switched on and off in
 * the hand's heading: 自動和了 wins whenever it can, 自動ツモ切り discards the
 * drawn tile, 鳴きなし passes on every pon, chii and open kan.
 */
export type AutoKey = 'win' | 'tsumogiri' | 'nocall';

export const AUTO_KEYS: readonly AutoKey[] = ['win', 'tsumogiri', 'nocall'];

/** Each automation's shop item and the label of its switch. */
export const AUTO_ITEMS: Record<AutoKey, { item: string; label: string }> = {
  win: { item: 'assist:autowin', label: '自動和了' },
  tsumogiri: { item: 'assist:tsumogiri', label: '自動ツモ切り' },
  nocall: { item: 'assist:nocall', label: '鳴きなし' },
};

/**
 * The move the automations switched on make for this state, or null when
 * the player is to choose. A win comes first: with 自動和了 off, a state that
 * can win is left to the player, ツモ切り and 鳴きなし included (鳴きなし
 * still hides the calls, ActionBar). ツモ切り only plays a drawn tile (none
 * right after a call), and skips the turn's kan, riichi and 九種九牌.
 */
export function autoMove(state: GameState, on: ReadonlySet<AutoKey>): { type: ActionType; tile?: Tile } | null {
  const { legal } = state;
  if (state.game_over || state.result) return null;
  if (state.phase === 'call' && legal.skip) {
    if (legal.ron) return on.has('win') ? { type: 'ron' } : null;
    return on.has('nocall') ? { type: 'skip' } : null;
  }
  if (state.phase !== 'discard' || state.actor !== state.you) return null;
  if (legal.tsumo) return on.has('win') ? { type: 'tsumo' } : null;
  const drawn = state.seats[state.you]?.drawn;
  if (on.has('tsumogiri') && drawn && legal.discards.includes(drawn)) return { type: 'discard', tile: drawn };
  return null;
}

const AUTO_KEY = 'mhj-dojo.dojo.auto.v1';

function loadAuto(): Set<AutoKey> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(AUTO_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? AUTO_KEYS.filter((k) => saved.includes(k)) : []);
  } catch {
    return new Set();
  }
}

/** The automations switched on (all off at first), kept in localStorage for the next game. */
export function useAutoPlay() {
  const [on, setOn] = useState<ReadonlySet<AutoKey>>(loadAuto);
  const toggle = useCallback((key: AutoKey) => {
    setOn((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      try {
        localStorage.setItem(AUTO_KEY, JSON.stringify([...next]));
      } catch {
        // Storage unavailable: the switch just won't persist.
      }
      return next;
    });
  }, []);
  return { on, toggle };
}
