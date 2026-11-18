/**
 * CR105 S5 — keyboard helpers for the Workbench layout.
 *
 * A shortcut never fires while the user is typing (an input, a select, a
 * textarea, a contenteditable), with Ctrl/⌘/Alt held, or while a modal dialog
 * is open — those keys belong to whatever has focus.
 */
import { useEffect, useRef } from "react";

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/**
 * Is a dialog open? Radix (the shared <Modal>, ConfirmModal, the category
 * picker) renders role="dialog" WITHOUT aria-modal, so matching
 * [aria-modal='true'] missed every one of the app's own modals — keys then
 * acted on the rows behind them. Every dialog here unmounts when closed.
 */
export function dialogOpen() {
  return typeof document !== "undefined" && !!document.querySelector("[role='dialog'], [role='alertdialog']");
}

/** True when a plain letter key should be left alone. */
export function isTypingTarget(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target;
  if (t instanceof Element && (t.matches(EDITABLE) || t.closest("[contenteditable='true']"))) return true;
  return dialogOpen();
}

/**
 * g, then a section's letter, jumps to that section (B: "g b goes to Budget").
 * The second key must follow within 1.5 s. Listens in the CAPTURE phase and
 * claims the key after g whether or not it is a section letter, so a mistyped
 * jump ("g a") never reaches a page's own shortcut (the inbox's accept).
 */
export function useGoChords(sections, navigate) {
  const armed = useRef(0);
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || isTypingTarget(e)) return;
      if (e.key === "Shift") return;
      const k = e.key.toLowerCase();
      if (Date.now() - armed.current < 1500) {
        armed.current = 0;
        e.preventDefault();
        const s = sections.find((x) => x.go === k);
        if (s) navigate(s.tabs[0].path);
        return;
      }
      if (k === "g" && !e.shiftKey) {
        armed.current = Date.now();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sections, navigate]);
}
