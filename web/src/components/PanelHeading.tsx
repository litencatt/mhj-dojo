import type { ComponentChildren } from 'preact';

export interface PanelHeadingProps {
  title: string;
  onMinimize?: () => void;
  children?: ComponentChildren; // extra inline content after the title
  actions?: ComponentChildren; // buttons before the minimize button, at the right end
}

/** A panel's h2 with an optional minimize button that sends it to the dock. */
export function PanelHeading({ title, onMinimize, children, actions }: PanelHeadingProps) {
  return (
    <div class="panel-heading">
      <h2>
        {title}
        {children}
      </h2>
      {actions}
      {onMinimize && (
        <button type="button" class="panel-minimize" onClick={onMinimize} aria-label={`${title}を最小化`} title="最小化">
          –
        </button>
      )}
    </div>
  );
}
