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
      role="alertdialog"
      aria-labelledby="tab-stopped-title"
      aria-describedby="tab-stopped-desc"
      // Escape would close it and leave the page usable.
      onCancel={(e) => e.preventDefault()}
      onClose={show}
    >
      <p id="tab-stopped-title" class="tab-stopped-title">
        このタブは別のタブで開かれたため停止しました
      </p>
      <p id="tab-stopped-desc" class="tab-stopped-desc">
        「このタブで続ける」を押すと、もう一方のタブが最後に進めた状態から続けます。
      </p>
      <div class="tab-stopped-actions">
        <button
          type="button"
          class="action-primary"
          autofocus
          disabled={busy}
          aria-describedby={busy ? 'tab-stopped-wait' : undefined}
          onClick={onContinue}
        >
          このタブで続ける
        </button>
        <button type="button" onClick={close}>
          閉じる
        </button>
        {busy && (
          <span id="tab-stopped-wait" class="tab-stopped-wait">
            前の操作の応答を待っています
          </span>
        )}
      </div>
      {closeFailed && (
        <p class="tab-stopped-hint" role="status">
          このページからは閉じられませんでした。このタブはそのまま閉じてかまいません
        </p>
      )}
    </dialog>
  );
}
