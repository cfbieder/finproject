import * as Dialog from "@radix-ui/react-dialog";
import "./Modal.css";

/**
 * Modal (CR042 U4) — the shared dialog primitive.
 *
 * Wraps @radix-ui/react-dialog under the app's tokens, replacing the ~20
 * bespoke `role="dialog"` overlays scattered across the codebase. Radix gives
 * us focus trapping, ESC-to-close, scroll locking, and correct ARIA wiring
 * (`aria-modal`, labelled/described by title/description) for free — none of
 * which the hand-rolled overlays had.
 *
 * Controlled: render conditionally as before (`{open && <Modal open .../>}`) or
 * keep it mounted and drive `open`. `onClose` fires on ESC, overlay click, and
 * the ✕ button.
 *
 *   title        required for accessibility (Radix warns without a Title). Pass
 *                a string, or set `hideTitle` to keep it screen-reader-only.
 *   description  optional sub-header text (wired to aria-describedby).
 *   footer       optional node rendered in the actions bar (right-aligned).
 *   size         "default" (520px) | "wide" (720px).
 *   dismissable  when false, ESC / overlay-click / ✕ are disabled (busy state).
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "default",
  hideTitle = false,
  dismissable = true,
  ariaLabel,
  bare = false,
  closeOnOutside = true,
}) {
  const guard = (event) => {
    if (!dismissable) event.preventDefault();
  };
  const guardOutside = (event) => {
    if (!dismissable || !closeOnOutside) event.preventDefault();
  };

  // `bare` mode: provide only Radix's overlay + focus-trap + ESC + portal, and
  // let the caller's own card own its look. Used to migrate the many bespoke
  // Forecast overlays (fc-*-modal) onto the primitive without restyling them —
  // they gain a11y (focus trap, ESC, correct ARIA) while staying visually 1:1.
  if (bare) {
    return (
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next && dismissable) onClose?.();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal__overlay" />
          <Dialog.Content
            className="modal--bare"
            aria-label={ariaLabel || title}
            onEscapeKeyDown={guard}
            onPointerDownOutside={guardOutside}
            onInteractOutside={guardOutside}
          >
            {/* Radix requires a Title for a11y; the caller's card supplies the
                visible heading, so this one is screen-reader-only. */}
            <Dialog.Title className="modal__title modal__title--hidden">
              {ariaLabel || title || "Dialog"}
            </Dialog.Title>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissable) onClose?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal__overlay" />
        <Dialog.Content
          className={`modal modal--${size}`}
          aria-label={hideTitle ? ariaLabel || title : undefined}
          onEscapeKeyDown={guard}
          onPointerDownOutside={guardOutside}
          onInteractOutside={guardOutside}
        >
          <div className="modal__header">
            <Dialog.Title
              className={hideTitle ? "modal__title modal__title--hidden" : "modal__title"}
            >
              {title}
            </Dialog.Title>
            {dismissable && (
              <Dialog.Close asChild>
                <button type="button" className="modal__close" aria-label="Close">
                  ×
                </button>
              </Dialog.Close>
            )}
          </div>
          {description && (
            <Dialog.Description className="modal__desc">
              {description}
            </Dialog.Description>
          )}
          <div className="modal__body">{children}</div>
          {footer && <div className="modal__footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
