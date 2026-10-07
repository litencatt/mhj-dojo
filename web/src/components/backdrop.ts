import { useRef } from 'preact/hooks';

/** Whether a pointer event hit the modal dialog's backdrop: the dialog itself, outside its box. */
function onBackdrop(e: MouseEvent): boolean {
  const d = e.currentTarget as HTMLElement;
  if (e.target !== d) return false;
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * The handlers that close a modal <dialog> on a click (or tap) on its
 * backdrop, but not on a drag (such as a text selection) that only ends
 * there, nor on a click on the dialog's own scrollbar (inside its box).
 */
export function useBackdropClose(close: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onPointerDown: (e: PointerEvent) => {
      pressedOnBackdrop.current = onBackdrop(e);
    },
    onClick: (e: MouseEvent) => {
      if (pressedOnBackdrop.current && onBackdrop(e)) close();
      pressedOnBackdrop.current = false;
    },
  };
}
