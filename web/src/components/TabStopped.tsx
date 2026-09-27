import { useEffect, useRef, useState } from 'preact/hooks';

interface TabStoppedProps {
  busy: boolean; // a request sent before the stop is still out
  onContinue: () => void;
}

/**
 * Covers the page once another tab has opened the same session or game
 * (singleTab.ts): a modal <dialog>, so nothing under it can be used. It
 * stays until the player takes the session or game back here, or closes
 * the tab.
 */
export function TabStopped({ busy, onContinue }: TabStoppedProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closeFailed, setCloseFailed] = useState(false);

  const show = () => {
    const d = ref.current;
    if (d && d.isConnected && !d.open) d.showModal();
  };
  useEffect(show, []);

  function close() {
    window.close();
    // Browsers only close a window a script opened: this one is likely
    // still here, which a moment later means it stays.
    window.setTimeout(() => setCloseFailed(true), 300);
  }

  return (
    <dialog
      ref={ref}
      class="tab-stopped"
      aria-labelledby="tab-stopped-title"
      // Escape would close it and leave the page usable.
      onCancel={(e) => e.preventDefault()}
      onClose={show}
    >
      <p id="tab-stopped-title" class="tab-stopped-title">
        このタブは別のタブで開かれたため停止しました
      </p>
      <div class="tab-stopped-actions">
        <button type="button" class="action-primary" disabled={busy} onClick={onContinue}>
          このタブで続ける
        </button>
        <button type="button" onClick={close}>
          閉じる
        </button>
      </div>
      {closeFailed && (
        <p class="tab-stopped-hint" role="status">
          このページからは閉じられませんでした。このタブはそのまま閉じてかまいません
        </p>
      )}
    </dialog>
  );
}
