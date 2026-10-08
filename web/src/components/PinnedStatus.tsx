import { DoraStatus, type DoraStatusProps } from './DoraStatus';

interface PinnedStatusProps extends DoraStatusProps {
  wallRemaining: number;
}

/** The wall left and the dora, together (style.css .status-wall-dora). */
export function WallDora({ wallRemaining, ...dora }: PinnedStatusProps) {
  return (
    <div class="status-wall-dora">
      <dl class="wall-status">
        <div>
          <dt>残り牌</dt>
          <dd data-testid="wall-remaining">{wallRemaining}</dd>
        </div>
      </dl>
      <DoraStatus {...dora} />
    </div>
  );
}

/**
 * On a phone the wall left and the dora move from the header to the top of
 * the hand's area, which sticks to the top of the screen as the page scrolls
 * (style.css): always in sight. Elsewhere it is hidden and the header shows
 * them; only one of the two is ever displayed.
 */
export function PinnedStatus(props: PinnedStatusProps) {
  return (
    <div class="pinned-status" data-testid="pinned-status">
      <WallDora {...props} />
    </div>
  );
}
