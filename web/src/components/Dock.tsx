export interface DockItem {
  key: string;
  label: string;
  short?: string; // the label in the phone's bottom bar
}

export interface DockProps {
  items: DockItem[];
  onRestore: (key: string) => void;
}

/**
 * Minimized panels, docked as vertical tabs on the right edge of the screen;
 * on a phone-width screen (styles/*.css) a bar of tabs along the bottom instead,
 * so they never cover the page.
 */
export function Dock({ items, onRestore }: DockProps) {
  if (items.length === 0) return null;
  return (
    <nav class="panel-dock" aria-label="最小化したパネル">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          class="dock-tab"
          onClick={() => onRestore(it.key)}
          title={`${it.label}を表示`}
          aria-label={it.label}
        >
          <span class="dock-tab-icon" aria-hidden="true">
            +
          </span>
          <span class="dock-tab-label">{it.label}</span>
          <span class="dock-tab-short" aria-hidden="true">
            {it.short ?? it.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
