import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
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
  melds?: ComponentChildren; // called melds, shown after the hand (game mode)
  onDiscard: (tile: string) => void;
  onPreview: (tile: string | null) => void;
}

/** 13-tile hand + drawn tile (set apart) + discard river. Click discards; hover/focus previews. */
export function Hand(props: HandProps) {
  const { hand, drawn, discards, disabled, allowed, onlyDrawn = false, melds, onDiscard, onPreview } = props;
  const can = (t: string, isDrawn: boolean) => !disabled && (isDrawn || !onlyDrawn) && (!allowed || allowed.includes(t));
  const tilesRef = useRef<HTMLDivElement>(null);
  // Set when the drawn tile is discarded from the keyboard: if the next state has
  // no drawn tile, its button unmounts and focus moves to the last hand tile.
  const refocus = useRef(false);

  // Tiles are always buttons keyed by position, so keyboard focus stays at the
  // clicked position through the request and the new hand. The tile under focus
  // may have changed, so its preview is issued again.
  useEffect(() => {
    const tiles = tilesRef.current;
    if (!tiles) return;
    const active = document.activeElement;
    if (refocus.current) {
      refocus.current = false;
      if (!drawn && (!active || active === document.body)) {
        (tiles.lastElementChild as HTMLElement | null)?.focus(); // its focus handler previews
        return;
      }
    }
    const i = Array.prototype.indexOf.call(tiles.children, active);
    if (i >= 0) onPreview(hand[i]);
    else if (drawn && active?.closest('.hand-drawn')) onPreview(drawn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, drawn]);

  return (
    <section class="hand-panel" aria-label="手牌">
      <h2>手牌</h2>
      <div class="hand-row">
        <div class="hand-tiles" role="group" aria-label={`手牌${hand.length}枚`} ref={tilesRef}>
          {hand.map((t, i) => {
            const ok = can(t, false);
            return (
              <Tile
                key={i}
                tile={t}
                button
                interactive={ok}
                dimmed={!disabled && !ok}
                onClick={() => onDiscard(t)}
                onHoverStart={() => onPreview(t)}
                onHoverEnd={() => onPreview(null)}
              />
            );
          })}
        </div>
        {drawn && (
          <div class="hand-drawn" aria-label="ツモ牌">
            <Tile
              tile={drawn}
              button
              interactive={can(drawn, true)}
              dimmed={!disabled && !can(drawn, true)}
              onClick={() => {
                refocus.current = !!document.activeElement?.closest('.hand-drawn');
                onDiscard(drawn);
              }}
              onHoverStart={() => onPreview(drawn)}
              onHoverEnd={() => onPreview(null)}
            />
          </div>
        )}
        {melds}
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
