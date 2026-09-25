import type { Meld } from '../api';
import { Tile } from './Tile';

const MELD_NAMES: Record<Meld['type'], string> = { chii: 'チー', pon: 'ポン', kan: '明槓', ankan: '暗槓' };

export interface MeldsProps {
  melds: Meld[];
  owner: number; // the seat holding the melds
  size: 'sm' | 'xs';
}

/** A seat's called melds. The called tile lies sideways on the side of the
 * seat it came from (上家 left, 対面 middle, 下家 right); an ankan shows its
 * outer tiles face down. */
export function Melds({ melds, owner, size }: MeldsProps) {
  if (melds.length === 0) return null;
  return (
    <div class={`melds melds-${size}`} aria-label="副露">
      {melds.map((m, i) => {
        const own = m.tiles.slice(0, -1);
        const called = m.tiles[m.tiles.length - 1];
        const rel = (m.from - owner + 4) % 4; // 1 下家, 2 対面, 3 上家
        const at = m.type === 'ankan' ? -1 : rel === 3 ? 0 : rel === 2 ? 1 : own.length;
        const tiles = m.type === 'ankan' ? m.tiles : [...own.slice(0, at), called, ...own.slice(at)];
        return (
          <span key={i} class="meld" role="group" aria-label={MELD_NAMES[m.type]}>
            {tiles.map((t, j) =>
              j === at ? (
                <span key={j} class="meld-called">
                  <Tile tile={t} size={size} label={`${t}（鳴いた牌）`} />
                </span>
              ) : (
                <Tile key={j} tile={t} size={size} faceDown={m.type === 'ankan' && (j === 0 || j === 3)} />
              ),
            )}
          </span>
        );
      })}
    </div>
  );
}
