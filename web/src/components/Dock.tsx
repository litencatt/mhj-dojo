export interface DockItem {
  key: string;
  label: string;
}

export interface DockProps {
  items: DockItem[];
  onRestore: (key: string) => void;
}

/** Minimized panels, docked as vertical tabs on the right edge of the screen. */
export function Dock({ items, onRestore }: DockProps) {
  if (items.length === 0) return null;
  return (
    <nav class="panel-dock" aria-label="最小化したパネル">
      {items.map((it) => (
        <button key={it.key} type="button" class="dock-tab" onClick={() => onRestore(it.key)} title={`${it.label}を表示`}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
