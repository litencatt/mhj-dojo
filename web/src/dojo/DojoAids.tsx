import type { GameState, Remaining, Tile as TileT, YakuRow } from '../api';
import { Tile } from '../components/Tile';
import { tileName } from '../tiles';

/** Each hand tile's ukeire once discarded (the normal row of by_discard); the best (lowest shanten, then most) marked. */
export function ukeireBadges(state: GameState): Record<string, { count: number; text: string; best: boolean }> {
  const rows = Object.entries(state.by_discard).flatMap(([t, rs]) => {
    const n = rs.find((r) => r.key === 'normal');
    return n && n.shanten !== null ? [{ t, shanten: n.shanten, count: n.ukeire_total }] : [];
  });
  const low = Math.min(...rows.map((r) => r.shanten));
  const most = Math.max(...rows.filter((r) => r.shanten === low).map((r) => r.count));
  return Object.fromEntries(
    rows.map((r) => [r.t, { count: r.count, text: `切ると有効牌${r.count}枚`, best: r.shanten === low && r.count === most }]),
  );
}

interface DojoAidsProps {
  analysis: YakuRow[];
  learned: Set<string>;
  closed: boolean; // no open meld (an ankan keeps the hand closed)
  riichi: boolean; // already in riichi
  remaining: Remaining;
  noyaku: boolean; // 補助: 役なし警告
  riichiOwned: boolean;
  waits: boolean; // 補助: 待ち牌表示
  nextDraws?: TileT[]; // イカサマ: 山読み
}

/** The dojo's aids above the hand: 役なし (or 立直 to win), the waits with their copies left, and the next draws. */
export function DojoAids({ analysis, learned, closed, riichi, remaining, noyaku, riichiOwned, waits, nextDraws }: DojoAidsProps) {
  const normal = analysis.find((r) => r.key === 'normal');
  const tenpai = normal?.shanten === 0;
  // Tenpai in the general form, but no learned yaku's row is: a win would have no yaku (立直 and
  // 門前清自摸和 have no row; a closed hand wins with 立直, an initial yaku).
  const noYaku = tenpai && !riichi && !analysis.some((r) => r.key !== 'normal' && learned.has(r.key) && r.shanten !== null && r.shanten <= 0);
  const warn = noyaku && noYaku;
  const showWaits = waits && tenpai && normal.ukeire.length > 0;
  if (!warn && !showWaits && !nextDraws?.length) return null;
  return (
    <div class="dojo-aids">
      {(warn || showWaits) && (
        <p class="dojo-aid" data-testid="dojo-waits">
          {warn &&
            (closed && riichiOwned ? (
              <span class="dojo-aid-ok">役なし：立直で和了れます</span>
            ) : (
              <span class="dojo-aid-warn">役なし</span>
            ))}
          {showWaits && (
            <>
              <span class="dojo-aid-label">待ち</span>
              {normal.ukeire.map((t) => (
                <span key={t} class="dojo-aid-tile">
                  <Tile tile={t} size="xs" dimmed={(remaining[t] ?? 0) === 0} label={`${tileName(t)} 残り${remaining[t] ?? 0}枚`} />
                  <span class="dojo-aid-count" aria-hidden="true">
                    {remaining[t] ?? 0}
                  </span>
                </span>
              ))}
            </>
          )}
        </p>
      )}
      {!!nextDraws?.length && (
        <p class="dojo-aid" data-testid="dojo-next-draws">
          <span class="dojo-aid-label">次のツモ（鳴きがなければ）</span>
          {nextDraws.map((t, i) => (
            <Tile key={i} tile={t} size="xs" />
          ))}
        </p>
      )}
    </div>
  );
}
