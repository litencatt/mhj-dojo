import { TileFace } from './TileFace';
import { tileName } from '../tiles';

export interface TileProps {
  tile: string;
  size?: 'md' | 'sm' | 'xs';
  interactive?: boolean;
  // Render a button even when not interactive (aria-disabled, out of the Tab
  // order). Unlike the native disabled attribute, this keeps keyboard focus.
  button?: boolean;
  dimmed?: boolean;
  faceDown?: boolean; // show the tile's back (e.g. unrevealed ura dora)
  label?: string;
  title?: string; // a tooltip, e.g. the danger of a hand tile
  className?: string; // extra class, e.g. a playback highlight
  badge?: string; // a small count under the face (the dojo's ukeire per discard); the label should say it too
  onClick?: (e: MouseEvent) => void;
  // A mouse pointer entering or leaving, or keyboard focus. Touch never
  // hovers: iOS would otherwise take a hover that changes the page as the
  // tap's whole effect and drop its click.
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

/** Runs `f` for a mouse pointer only (not touch or pen). */
export function mouseOnly(f: () => void) {
  return (e: PointerEvent) => {
    if (e.pointerType === 'mouse') f();
  };
}

/** Renders a single mahjong tile: an ivory body (CSS) with an SVG face. */
export function Tile(props: TileProps) {
  const { tile, size = 'md', interactive = false, button = false, dimmed = false, faceDown = false, label, title, className, badge, onClick, onHoverStart, onHoverEnd } = props;
  const classes = ['tile', `tile-${size}`];
  if (dimmed) classes.push('tile-dimmed');
  if (faceDown) classes.push('tile-back');
  if (interactive) classes.push('tile-interactive');
  if (className) classes.push(className);

  const commonProps = {
    className: classes.join(' '),
    onPointerEnter: onHoverStart && mouseOnly(onHoverStart),
    onPointerLeave: onHoverEnd && mouseOnly(onHoverEnd),
    onFocus: onHoverStart,
    onBlur: onHoverEnd,
    'aria-label': label ?? (faceDown ? '伏せ牌' : tileName(tile)),
    title,
  };

  const content = faceDown ? null : (
    <>
      <TileFace tile={tile} />
      {badge !== undefined && (
        <span class="tile-badge" aria-hidden="true">
          {badge}
        </span>
      )}
    </>
  );

  if (interactive || button) {
    return (
      <button
        type="button"
        {...commonProps}
        aria-disabled={interactive ? undefined : 'true'}
        tabIndex={interactive ? undefined : -1}
        onClick={interactive ? onClick : undefined}
      >
        {content}
      </button>
    );
  }
  return <div {...commonProps}>{content}</div>;
}
