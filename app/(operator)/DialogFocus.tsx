"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behavior for a workspace modal, rendered as the first child of its role="dialog"
 * element: moves focus into the dialog when it opens, keeps Tab inside it, closes it on Escape,
 * and hands focus back to whatever opened it once it unmounts.
 *
 * The workspace dialogs are conditionally rendered inline JSX, so a hook per dialog would have to
 * live at the top of the component, away from the markup it describes. A child component keeps
 * the behavior next to each dialog and mounts and unmounts with it.
 *
 * Listeners sit on the dialog itself rather than the document, so when one dialog opens over
 * another (discard-changes over the deal editor) only the one holding focus reacts to Escape.
 */
export function DialogFocus({ onClose }: { onClose: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
    // Prefer the first real control over the corner close button, so a form dialog opens ready to
    // type into; a dialog with nothing else to focus lands on its close button.
    if (!dialog.contains(document.activeElement)) {
      const items = focusable();
      (items.find((el) => !el.classList.contains("close")) || items[0] || dialog).focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return <span ref={anchor} hidden />;
}
