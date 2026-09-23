import { Tile } from './Tile';

export interface HandProps {
  hand: string[];
  drawn: string | null;
  discards: string[];
  disabled: boolean;
  // When set, only these tiles can be clicked (e.g. the riichi discards).
  allowed?: string[];
  // Only the drawn tile can be clicked (after riichi), even if a hand tile is identical.
  onlyDrawn?: boolean;
  onDiscard: (tile: string) => void;
  onPreview: (tile: string | null) => void;
}

/** 13-tile hand + drawn tile (set apart) + discard river. Click discards; hover/focus previews. */
export function Hand(props: HandProps) {
  const { hand, drawn, discards, disabled, allowed, onlyDrawn = false, onDiscard, onPreview } = props;
  const can = (t: string, isDrawn: boolean) => !disabled && (isDrawn || !onlyDrawn) && (!allowed || allowed.includes(t));
  // Tiles are always buttons keyed by position, so keyboard focus stays at the
  // clicked position through the request and the new hand.
  return (
    <section class="hand-panel" aria-label="手牌">
      <h2>手牌</h2>
      <div class="hand-row">
        <div class="hand-tiles" role="group" aria-label="手牌13枚">
          {hand.map((t, i) => (
            <Tile
              key={i}
              tile={t}
              interactive={can(t, false)}
              disabled={!can(t, false)}
              dimmed={!disabled && !can(t, false)}
              onClick={() => can(t, false) && onDiscard(t)}
              onHoverStart={() => onPreview(t)}
              onHoverEnd={() => onPreview(null)}
            />
          ))}
        </div>
        {drawn && (
          <div class="hand-drawn" aria-label="ツモ牌">
            <Tile
              tile={drawn}
              interactive={can(drawn, true)}
              disabled={!can(drawn, true)}
              dimmed={!disabled && !can(drawn, true)}
              onClick={() => can(drawn, true) && onDiscard(drawn)}
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
