import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { HandGroup, HandGroupType } from '../api';
import { useHandGroupsToggle } from '../hooks';
import { Tile } from './Tile';

export interface HandProps {
  hand: string[];
  // The server's split of `hand` (docs/api.md "HandGroup"); enables the 面子表示 toggle.
  groups?: HandGroup[];
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

const GROUP_LABELS: Record<HandGroupType, string> = {
  seq: '順子',
  trip: '刻子',
  pair: '雀頭',
  ryanmen: '両面',
  kanchan: '嵌張',
  penchan: '辺張',
  toitsu: '対子',
  float: '浮き',
};

// The bracket colour class: complete melds, the pair, taatsu, floating tiles.
const GROUP_CLASS: Record<HandGroupType, string> = {
  seq: 'meld',
  trip: 'meld',
  pair: 'pair',
  ryanmen: 'taatsu',
  kanchan: 'taatsu',
  penchan: 'taatsu',
  toitsu: 'taatsu',
  float: 'float',
};

/** The groups to draw, or null unless they index every tile of hand exactly once. */
function validGroups(hand: string[], groups: HandGroup[] | undefined): HandGroup[] | null {
  if (!groups) return null;
  const seen = new Array<boolean>(hand.length).fill(false);
  let n = 0;
  for (const g of groups) {
    if (!(g.type in GROUP_LABELS)) return null;
    for (const i of g.tiles) {
      if (!Number.isInteger(i) || i < 0 || i >= hand.length || seen[i]) return null;
      seen[i] = true;
      n++;
    }
  }
  return n === hand.length ? groups.filter((g) => g.tiles.length > 0) : null;
}

/**
 * 13-tile hand + drawn tile (set apart) + discard river. Click discards; hover/focus previews.
 * With 面子表示 on, the hand is regrouped into the server's blocks, each under a labelled bracket.
 */
export function Hand(props: HandProps) {
  const { hand, groups, drawn, discards, disabled, allowed, onlyDrawn = false, melds, onDiscard, onPreview } = props;
  const can = (t: string, isDrawn: boolean) => !disabled && (isDrawn || !onlyDrawn) && (!allowed || allowed.includes(t));
  const [showGroups, setShowGroups] = useHandGroupsToggle();
  const layout = useMemo(() => (showGroups ? validGroups(hand, groups) : null), [showGroups, hand, groups]);
  // Display position → index into hand.
  const order = useMemo(() => (layout ? layout.flatMap((g) => g.tiles) : hand.map((_, i) => i)), [layout, hand]);
  const tilesRef = useRef<HTMLDivElement>(null);
  // Set when the drawn tile is discarded from the keyboard: if the next state has
  // no drawn tile, its button unmounts and focus moves to the last hand tile.
  const refocus = useRef(false);
  // The display position of a hand tile discarded from the keyboard: a grouped
  // tile remounts when its position moves to another group, so focus is put
  // back at that position.
  const refocusPos = useRef<number | null>(null);

  // Tiles are buttons keyed by position, so keyboard focus stays at the clicked
  // position through the request and the new hand (or is put back there when the
  // groups changed shape). The tile under focus may have changed, so its preview
  // is issued again.
  useEffect(() => {
    const tiles = tilesRef.current;
    if (!tiles) return;
    const buttons = Array.from(tiles.querySelectorAll<HTMLElement>('button.tile'));
    const active = document.activeElement;
    const lost = !active || active === document.body;
    const pos = refocusPos.current;
    refocusPos.current = null;
    if (refocus.current) {
      refocus.current = false;
      if (!drawn && lost) {
        buttons[buttons.length - 1]?.focus(); // its focus handler previews
        return;
      }
    }
    if (pos !== null && lost && buttons.length > 0) {
      buttons[Math.min(pos, buttons.length - 1)].focus();
      return;
    }
    const i = buttons.indexOf(active as HTMLElement);
    if (i >= 0) onPreview(hand[order[i]]);
    else if (drawn && active?.closest('.hand-drawn')) onPreview(drawn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand, drawn]);

  // Keyed by display position: a button survives an update only where the same
  // position is still in the same group, so focus never jumps to another position.
  const tileButton = (i: number, pos: number) => {
    const t = hand[i];
    const ok = can(t, false);
    return (
      <Tile
        key={pos}
        tile={t}
        button
        interactive={ok}
        dimmed={!disabled && !ok}
        onClick={() => {
          refocusPos.current = tilesRef.current?.contains(document.activeElement) ? pos : null;
          onDiscard(t);
        }}
        onHoverStart={() => onPreview(t)}
        onHoverEnd={() => onPreview(null)}
      />
    );
  };

  let pos = 0;
  return (
    <section class="hand-panel" aria-label="手牌">
      <div class="hand-heading">
        <h2>手牌</h2>
        {groups && (
          <label class="hand-groups-toggle">
            <input type="checkbox" checked={showGroups} onChange={(e) => setShowGroups(e.currentTarget.checked)} />
            面子表示
          </label>
        )}
      </div>
      <div class="hand-row">
        <div
          class={layout ? 'hand-tiles hand-tiles-grouped' : 'hand-tiles'}
          role="group"
          aria-label={`手牌${hand.length}枚`}
          ref={tilesRef}
        >
          {layout
            ? layout.map((g, gi) => (
                <div key={gi} class={`hand-group hand-group-${GROUP_CLASS[g.type]}`} role="group" aria-label={GROUP_LABELS[g.type]}>
                  <span class="hand-group-label" aria-hidden="true">
                    {GROUP_LABELS[g.type]}
                  </span>
                  <div class="hand-group-tiles">{g.tiles.map((i) => tileButton(i, pos++))}</div>
                </div>
              ))
            : hand.map((_, i) => tileButton(i, pos++))}
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
