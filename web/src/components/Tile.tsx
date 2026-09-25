import { TileFace } from './TileFace';

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
  className?: string; // extra class, e.g. a playback highlight
  onClick?: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

/** Renders a single mahjong tile: an ivory body (CSS) with an SVG face. */
export function Tile(props: TileProps) {
  const { tile, size = 'md', interactive = false, button = false, dimmed = false, faceDown = false, label, className, onClick, onHoverStart, onHoverEnd } = props;
  const classes = ['tile', `tile-${size}`];
  if (dimmed) classes.push('tile-dimmed');
  if (faceDown) classes.push('tile-back');
  if (interactive) classes.push('tile-interactive');
  if (className) classes.push(className);

  const commonProps = {
    className: classes.join(' '),
    onMouseEnter: onHoverStart,
    onMouseLeave: onHoverEnd,
    onFocus: onHoverStart,
    onBlur: onHoverEnd,
    'aria-label': label ?? (faceDown ? '伏せ牌' : tile),
  };

  const content = faceDown ? null : <TileFace tile={tile} />;

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
