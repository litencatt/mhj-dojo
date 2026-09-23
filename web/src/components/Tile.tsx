import { tileFace, parseTile } from '../tiles';

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

/** Renders a single mahjong tile face (SVG/CSS only, no image assets). */
export function Tile(props: TileProps) {
  const { tile, size = 'md', interactive = false, selected = false, dimmed = false, label, onClick, onHoverStart, onHoverEnd } = props;
  const { suit, red } = parseTile(tile);
  const face = tileFace(tile);
  const classes = ['tile', `tile-${size}`, `tile-suit-${suit}`];
  if (red) classes.push('tile-red');
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

  const content = (
    <>
      <span class="tile-main">{face.main}</span>
      {face.sub && <span class="tile-sub">{face.sub}</span>}
      {red && <span class="tile-red-dot" aria-hidden="true" />}
    </>
  );

  if (interactive) {
    return (
      <button type="button" {...commonProps} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div {...commonProps}>{content}</div>;
}
