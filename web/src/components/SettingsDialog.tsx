import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void; // 閉じる, Esc (the dialog's cancel), or the owner closing it
  children: ComponentChildren;
}

/**
 * A mode's 設定, as a modal dialog (the page behind is inert). It opens with
 * the focus on the first choice (the checked radio button, else the first
 * field); closed, the dialog gives the focus back to 設定.
 */
export function SettingsDialog({ open, onClose, children }: SettingsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      (d.querySelector<HTMLElement>('input:checked') ?? d.querySelector<HTMLElement>('input, select'))?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="settings-dialog" aria-labelledby="settings-heading" onClose={onClose}>
      <div class="settings-dialog-head">
        <h2 id="settings-heading">設定</h2>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
      {children}
    </dialog>
  );
}
