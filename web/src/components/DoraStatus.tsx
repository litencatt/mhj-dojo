import type { Tile as TileT } from '../api';
import { Tile } from './Tile';

export interface DoraStatusProps {
  doraIndicators: TileT[];
  dora: TileT[];
  uraDoraIndicators: TileT[]; // [] until the game ends
  uraDora: TileT[];
}

/** The dora and ura-dora indicators, boxed at the right of the header's status row. */
export function DoraStatus({ doraIndicators, dora, uraDoraIndicators, uraDora }: DoraStatusProps) {
  return (
    <dl class="dora-box">
      <div>
        <dt>ドラ<span class="dora-dt-rest">表示牌</span></dt>
        <dd class="dora-indicators">
          {doraIndicators.map((t, i) => (
            <Tile key={`${t}-${i}`} tile={t} size="sm" />
          ))}
          <span class="dora-arrow" aria-hidden="true">→</span>
          <span class="dora-label">ドラ</span>
          {dora.map((t, i) => (
            <Tile key={`d-${t}-${i}`} tile={t} size="sm" label={`ドラ ${t}`} />
          ))}
        </dd>
      </div>
      <div>
        <dt>裏ドラ<span class="dora-dt-rest">表示牌</span></dt>
        <dd class="dora-indicators">
          {uraDoraIndicators.length > 0 ? (
            <>
              {uraDoraIndicators.map((t, i) => (
                <Tile key={`u-${t}-${i}`} tile={t} size="sm" />
              ))}
              <span class="dora-arrow" aria-hidden="true">→</span>
              <span class="dora-label">裏ドラ</span>
              {uraDora.map((t, i) => (
                <Tile key={`ud-${t}-${i}`} tile={t} size="sm" label={`裏ドラ ${t}`} />
              ))}
            </>
          ) : (
            // Hidden until the game ends: one face-down tile per indicator.
            doraIndicators.map((_, i) => <Tile key={`ub-${i}`} tile="" size="sm" faceDown />)
          )}
        </dd>
      </div>
    </dl>
  );
}
