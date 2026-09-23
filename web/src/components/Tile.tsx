import { TileFace } from './TileFace';

export interface TileProps {
  tile: string;
  size?: 'md' | 'sm' | 'xs';
  interactive?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  faceDown?: boolean; // show the tile's back (e.g. unrevealed ura dora)
  label?: string;
  onClick?: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

/** Renders a single mahjong tile: an ivory body (CSS) with an SVG face. */
export function Tile(props: TileProps) {
  const { tile, size = 'md', interactive = false, selected = false, dimmed = false, faceDown = false, label, onClick, onHoverStart, onHoverEnd } = props;
  const classes = ['tile', `tile-${size}`];
  if (selected) classes.push('tile-selected');
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

  if (interactive) {
    return (
      <button type="button" {...commonProps} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div {...commonProps}>{content}</div>;
}
