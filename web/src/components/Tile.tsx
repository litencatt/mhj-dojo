import { TileFace } from './TileFace';

export interface TileProps {
  tile: string;
  size?: 'md' | 'sm' | 'xs';
  interactive?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  label?: string;
  onClick?: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

/** Renders a single mahjong tile: an ivory body (CSS) with an SVG face. */
export function Tile(props: TileProps) {
  const { tile, size = 'md', interactive = false, selected = false, dimmed = false, label, onClick, onHoverStart, onHoverEnd } = props;
  const classes = ['tile', `tile-${size}`];
  if (selected) classes.push('tile-selected');
  if (dimmed) classes.push('tile-dimmed');
  if (interactive) classes.push('tile-interactive');

  const commonProps = {
    className: classes.join(' '),
    onMouseEnter: onHoverStart,
    onMouseLeave: onHoverEnd,
    onFocus: onHoverStart,
    onBlur: onHoverEnd,
    'aria-label': label ?? tile,
  };

  const content = <TileFace tile={tile} />;

  if (interactive) {
    return (
      <button type="button" {...commonProps} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div {...commonProps}>{content}</div>;
}
