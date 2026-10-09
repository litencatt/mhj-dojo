import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useBackdropClose } from './backdrop';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void; // 閉じる, Esc (the dialog's cancel), or the owner closing it
  children: ComponentChildren;
}

/**
 * A mode's 設定, as a modal dialog (the page behind is inert). It opens with
 * the focus on the first field (of a group of radio buttons, the checked
 * one); closed (閉じる, Esc or a click on the backdrop), the dialog gives
 * the focus back to 設定.
 */
export function SettingsDialog({ open, onClose, children }: SettingsDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(onClose);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      const first = d.querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
      const checked = first?.type === 'radio' ? d.querySelector<HTMLElement>(`input[name="${first.name}"]:checked`) : null;
      (checked ?? first)?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} class="settings-dialog" aria-labelledby="settings-heading" onClose={onClose} {...backdrop}>
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
