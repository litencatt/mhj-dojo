import { Tile } from './Tile';

export interface HandProps {
  hand: string[];
  drawn: string | null;
  discards: string[];
  disabled: boolean;
  onDiscard: (tile: string) => void;
  onPreview: (tile: string | null) => void;
}

/** 13-tile hand + drawn tile (set apart) + discard river. Click discards; hover/focus previews. */
export function Hand(props: HandProps) {
  const { hand, drawn, discards, disabled, onDiscard, onPreview } = props;
  return (
    <section class="hand-panel" aria-label="手牌">
      <h2>手牌</h2>
      <div class="hand-row">
        <div class="hand-tiles" role="group" aria-label="手牌13枚">
          {hand.map((t, i) => (
            <Tile
              key={`${t}-${i}`}
              tile={t}
              interactive={!disabled}
              onClick={() => !disabled && onDiscard(t)}
              onHoverStart={() => onPreview(t)}
              onHoverEnd={() => onPreview(null)}
            />
          ))}
        </div>
        {drawn && (
          <div class="hand-drawn" aria-label="ツモ牌">
            <Tile
              tile={drawn}
              interactive={!disabled}
              onClick={() => !disabled && onDiscard(drawn)}
              onHoverStart={() => onPreview(drawn)}
              onHoverEnd={() => onPreview(null)}
            />
          </div>
        )}
      </div>
      {discards.length > 0 && (
        <div class="discard-river" aria-label="捨て牌">
          <span class="discard-label">捨て牌</span>
          {discards.map((t, i) => (
            <Tile key={`${t}-${i}`} tile={t} size="sm" />
          ))}
        </div>
      )}
    </section>
  );
}
