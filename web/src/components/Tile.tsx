import { TileFace } from './TileFace';

export interface TileProps {
  tile: string;
  size?: 'md' | 'sm' | 'xs';
  interactive?: boolean;
  // A button that cannot be clicked right now. It stays a (focusable) button
  // rather than using the native attribute, which would drop keyboard focus.
  disabled?: boolean;
  dimmed?: boolean;
  faceDown?: boolean; // show the tile's back (e.g. unrevealed ura dora)
  label?: string;
  onClick?: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

/** Renders a single mahjong tile: an ivory body (CSS) with an SVG face. */
export function Tile(props: TileProps) {
  const { tile, size = 'md', interactive = false, disabled = false, dimmed = false, faceDown = false, label, onClick, onHoverStart, onHoverEnd } = props;
  const classes = ['tile', `tile-${size}`];
  if (dimmed) classes.push('tile-dimmed');
  if (faceDown) classes.push('tile-back');
  if (interactive) classes.push('tile-interactive');

  const commonProps = {
    className: classes.join(' '),
    onMouseEnter: onHoverStart,
    onMouseLeave: onHoverEnd,
    onFocus: onHoverStart,
    onBlur: onHoverEnd,
    'aria-label': label ?? (faceDown ? '伏せ牌' : tile),
  };

  const content = faceDown ? null : <TileFace tile={tile} />;

  if (interactive || disabled) {
    return (
      <button type="button" {...commonProps} aria-disabled={interactive ? undefined : 'true'} onClick={interactive ? onClick : undefined}>
        {content}
      </button>
    );
  }
  return <div {...commonProps}>{content}</div>;
}
