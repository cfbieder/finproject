import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * The mobile shell's one full-screen sheet.
 *
 * Deliberately NOT the shared <Modal> primitive: that is a centred, sized,
 * Radix-backed desktop dialog. A phone sheet covers the viewport, pads for the
 * safe-area insets, scrolls its own body under a fixed head, and pins its
 * actions to the bottom where a thumb reaches. Rendering the desktop modal
 * inside the /m shell would fight every one of those.
 *
 * It is the ONLY role="dialog" in mobile/ — MobilePickerSheet and
 * MobilePeriodSheet both render through it, so the chrome, the scroll lock and
 * the Escape handling exist once.
 */
export default function MobileSheet({ open, title, onClose, footer, children }) {
  // Lock body scroll while open, restoring whatever was there before.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes — mainly for desktop testing, where the sheet is reachable.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="m-picker" role="dialog" aria-modal="true" aria-label={title}>
      <div className="m-picker__head">
        <button
          type="button"
          className="m-picker__close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={22} />
        </button>
        <span className="m-picker__title">{title}</span>
      </div>
      {children}
      {footer && <div className="m-sheet__footer">{footer}</div>}
    </div>
  );
}
