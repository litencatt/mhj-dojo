import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { HandGroup, HandGroupType } from '../api';
import { useHandGroupsToggle } from '../hooks';
import { Tile } from './Tile';
import { tileName } from '../tiles';

export interface HandProps {
  hand: string[];
  // The engine's split of `hand` (docs/api.md "HandGroup"); enables the 面子表示 toggle.
  groups?: HandGroup[];
  drawn: string | null;
  discards: string[];
  disabled: boolean;
  // When set, only these tiles can be clicked (e.g. the riichi discards).
  allowed?: string[];
  // Only the drawn tile can be clicked (after riichi), even if a hand tile is identical.
  onlyDrawn?: boolean;
  melds?: ComponentChildren; // called melds, shown after the hand (game mode)
  // Game mode: your wind, points, rank and riichi beside the heading, and
  // your river under the hand, shown on an upright phone only (style.css),
  // where they stand in for your seat at the table.
  status?: ComponentChildren;
  river?: ComponentChildren;
  acting?: boolean; // game mode: your turn, marked as your seat's box marks it
  highlight?: string | null; // tiles to mark (exact string), e.g. a hovered advice candidate
  // Game mode: a mark per tile (exact string), e.g. its danger against a
  // riichi: a class for the badge and the text it stands for.
  marks?: Record<string, { className: string; text: string }>;
  // The dojo's 有効牌ハイライト: a count under each tile (exact string), and its text; best is marked.
  badges?: Record<string, { count: number; text: string; best: boolean }>;
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

// A selected tile: its display position, or 'drawn'.
type Pick = number | 'drawn';

/**
 * 13-tile hand + drawn tile (set apart) + discard river. Click discards; hover/focus previews.
 * With 面子表示 on, the hand is regrouped into the engine's blocks, each under a labelled bracket.
 *
 * Touch has no hover, so a tap only selects a tile (raised, and previewed like
 * a hovered one) and a second tap on the same tile discards it. The mouse and
 * the keyboard still discard on the first click.
 */
export function Hand(props: HandProps) {
  const { hand, groups, drawn, discards, disabled, allowed, onlyDrawn = false, melds, status, river, acting = false, highlight, marks, badges, onDiscard, onPreview } = props;
  const mark = (t: string) =>
    classes(highlight && t === highlight ? 'tile-advice' : undefined, marks?.[t]?.className, badges?.[t]?.best ? 'tile-ukeire-best' : undefined);
  const label = (t: string) => {
    const notes = [marks?.[t]?.text, badges?.[t]?.text].filter(Boolean);
    return notes.length > 0 ? `${tileName(t)}、${notes.join('、')}` : undefined;
  };
  const can = (t: string, isDrawn: boolean) => !disabled && (isDrawn || !onlyDrawn) && (!allowed || allowed.includes(t));
  const [showGroups, setShowGroups] = useHandGroupsToggle();
  const layout = useMemo(() => (showGroups ? validGroups(hand, groups) : null), [showGroups, hand, groups]);
  // Display position → index into hand.
  const order = useMemo(() => (layout ? layout.flatMap((g) => g.tiles) : hand.map((_, i) => i)), [layout, hand]);
  const tilesRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // Set when the drawn tile is discarded from the keyboard: if the next state has
  // no drawn tile, its button unmounts and focus moves to the last hand tile.
  const refocus = useRef(false);
  // The display position of a hand tile discarded from the keyboard: a grouped
  // tile remounts when its position moves to another group, so focus is put
  // back at that position.
  const refocusPos = useRef<number | null>(null);
  // The pointer of the latest press in the hand ('touch', 'pen' or 'mouse'), for
  // a browser whose click event does not say (a PointerEvent's pointerType);
  // cleared by a key press or a cancelled press, so it never outlives its tap.
  const pointer = useRef<string | null>(null);
  // The tile a tap selected, with its tile, kept previewed until discarded.
  const [picked, setPicked] = useState<{ at: Pick; tile: string } | null>(null);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  // A new hand, a locked one or other tiles allowed (リーチ toggled) drop the
  // selection, so a tap made before can never confirm a different action.
  useEffect(() => {
    setPicked(null);
  }, [hand, drawn, disabled, allowed, onlyDrawn]);

  // A tap anywhere outside the hand drops the selection (a scroll is no tap,
  // so the preview stays while scrolling to the yaku table).
  useEffect(() => {
    if (!picked) return;
    const onClick = (e: MouseEvent) => {
      if (rowRef.current?.contains(e.target as Node)) return;
      setPicked(null);
      onPreview(null);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  // Selects on the first tap and discards on the second; true when the click
  // should go on to discard. Touch and pen select first (a pen has no hover
  // either); the mouse and the keyboard (a click with no pointer, detail 0)
  // discard at once.
  const tapToDiscard = (e: MouseEvent, at: Pick, t: string): boolean => {
    const type = 'pointerType' in e && typeof e.pointerType === 'string' ? (e as PointerEvent).pointerType : pointer.current;
    pointer.current = null;
    const touch = e.detail !== 0 && (type === 'touch' || type === 'pen');
    if (!touch) return true;
    if (picked && picked.at === at && picked.tile === t) {
      setPicked(null);
      // Leave nothing focused, so the next hand is not previewed by focus.
      (document.activeElement as HTMLElement | null)?.blur();
      return true;
    }
    setPicked({ at, tile: t });
    onPreview(t);
    return false;
  };
  // Leaving a tile goes back to the selected tile's preview, if any.
  const previewEnd = () => onPreview(pickedRef.current?.tile ?? null);
  const pickClass = (at: Pick, t: string) => (picked && picked.at === at && picked.tile === t ? 'tile-picked' : undefined);
  const classes = (...cs: Array<string | undefined>) => cs.filter(Boolean).join(' ') || undefined;

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
        className={classes(mark(t), pickClass(pos, t))}
        label={label(t)}
        title={marks?.[t]?.text}
        badge={badges?.[t] && String(badges[t].count)}
        onClick={(e) => {
          if (!tapToDiscard(e, pos, t)) return;
          refocusPos.current = tilesRef.current?.contains(document.activeElement) ? pos : null;
          onDiscard(t);
        }}
        onHoverStart={() => onPreview(t)}
        onHoverEnd={previewEnd}
      />
    );
  };

  let pos = 0;
  return (
    <section class={acting ? 'hand-panel hand-acting' : 'hand-panel'} aria-label="手牌">
      <div class="hand-heading">
        <h2>手牌</h2>
        {status && <div class="hand-status">{status}</div>}
        {groups && (
          <button
            type="button"
            class={`filter-chip ${showGroups ? 'filter-chip-on' : ''}`}
            aria-pressed={showGroups}
            onClick={() => setShowGroups(!showGroups)}
          >
            面子表示
          </button>
        )}
      </div>
      <div
        class="hand-row"
        ref={rowRef}
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onKeyDown={() => {
          pointer.current = null;
        }}
      >
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
              className={classes(mark(drawn), pickClass('drawn', drawn))}
              label={label(drawn)}
              title={marks?.[drawn]?.text}
              badge={badges?.[drawn] && String(badges[drawn].count)}
              onClick={(e) => {
                if (!tapToDiscard(e, 'drawn', drawn)) return;
                refocus.current = !!document.activeElement?.closest('.hand-drawn');
                onDiscard(drawn);
              }}
              onHoverStart={() => onPreview(drawn)}
              onHoverEnd={previewEnd}
            />
          </div>
        )}
        {melds}
      </div>
      {river}
      {/* Always mounted, so a screen reader announces the selection. */}
      <p class="visually-hidden" role="status" aria-live="polite">
        {picked ? `選択中：${tileName(picked.tile)}（もう一度タップで打牌）` : ''}
      </p>
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
