export interface PanelHeadingProps {
  title: string;
  onMinimize?: () => void;
}

/** A panel's h2 with an optional minimize button that sends it to the dock. */
export function PanelHeading({ title, onMinimize }: PanelHeadingProps) {
  return (
    <div class="panel-heading">
      <h2>{title}</h2>
      {onMinimize && (
        <button type="button" class="panel-minimize" onClick={onMinimize} aria-label={`${title}を最小化`} title="最小化">
          –
        </button>
      )}
    </div>
  );
}
