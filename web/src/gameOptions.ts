import type { CpuLevel, GameOptions } from './api';
import type { ResumeItem } from './components/ResumePanel';
import { LENGTH_NAMES, WIND_NAMES, roundName } from './components/GameTable';
import { MASTER_MATCH_LENGTH, masterMatchOpen, uraOpen } from './dojo/masterMatch';
import { dojoGame, dojoOptions, type DojoProgress } from './dojo/progress';
import type { GameSummary } from './saves';

export const DEALER_NAMES = { random: 'ランダム', you: '自分' } as const;
/** The CPU levels the game options offer: the master and the urashihan play only the dojo's 師範戦 and ウラ面 (masterMatchOptions, uraGameOptions). */
export const CPU_NAMES = { weak: '弱い', normal: '普通' } as const;
/** Every CPU level's name, for a game's. */
export const CPU_LEVEL_NAMES: Record<CpuLevel, string> = { ...CPU_NAMES, master: '師範', ura: '裏師範' };

/**
 * The game options in the URL (or a form), unknown values as the defaults: a CPU game is never
 * against the master or the urashihan, which come only from the dojo's own options.
 */
export function parseOptions(get: (key: string) => string | null): GameOptions {
  return {
    length: get('length') === 'hanchan' ? 'hanchan' : 'tonpuu',
    first_dealer: get('first_dealer') === 'you' ? 'you' : 'random',
    cpu: get('cpu') === 'weak' ? 'weak' : 'normal',
  };
}

/** A saved game in the list of saves: 「東風戦 東2局 シード 5」, and the URL params that deal it again. */
export function savedItem(g: GameSummary): ResumeItem {
  const r = g.round;
  const round = r && (r.over ? '終局' : WIND_NAMES[r.wind] && roundName(r.wind, r.number, r.honba));
  const seed = g.seed !== null && `シード ${g.seed}`;
  const params: Record<string, string> = {};
  if (g.length) params.length = g.length;
  if (g.firstDealer) params.first_dealer = g.firstDealer;
  if (g.cpu) params.cpu = g.cpu;
  if (g.seedKnown) params.seed = String(g.seed);
  return {
    id: g.id,
    label: [LENGTH_NAMES[g.length as GameOptions['length']], round, seed].filter(Boolean).join(' '),
    used: g.used,
    params,
    over: !!r?.over,
  };
}

export function urlOptions(): GameOptions {
  const params = new URLSearchParams(location.search);
  return parseOptions((k) => params.get(k));
}

/** The game a dojo plays: the length and CPU chosen in the hub, with what the dojo has bought. */
export function dojoGameOptions(p: DojoProgress): GameOptions {
  return { ...dojoGame(p), first_dealer: 'random', dojo: dojoOptions(p) };
}

/** The 師範戦: a 半荘戦 against three masters with the yaku the dojo has bought, without any cheat; null until it may be tried. */
export function masterMatchOptions(p: DojoProgress): GameOptions | null {
  if (!masterMatchOpen(p)) return null;
  return { length: MASTER_MATCH_LENGTH, cpu: 'master', first_dealer: 'random', dojo: dojoOptions(p, 'master') };
}

/** A ウラ面 game: a 半荘戦 against three urashihan, with the cheats owned; null until the ウラ面 is open. */
export function uraGameOptions(p: DojoProgress): GameOptions | null {
  if (!uraOpen(p)) return null;
  return { length: MASTER_MATCH_LENGTH, cpu: 'ura', first_dealer: 'random', dojo: dojoOptions(p, 'ura') };
}
