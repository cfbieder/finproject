import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { EllipsisVertical } from "lucide-react";

/**
 * Per-row "kebab" (⋮) menu for the transaction review table. Collapses the
 * formerly-inline row actions (Category / Split / Neutralize / Transfer /
 * Accept) into a single icon that opens a popup menu.
 *
 * The menu is rendered through a portal to <body> with fixed positioning so it
 * is not clipped by the table's horizontally-scrolling `overflow:auto` wrapper.
 *
 * @param {{ items: Array<{key,label,onClick,disabled?,tone?}>, busy?: boolean }} props
 */
export default function RowActionMenu({ items, busy = false }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);

  const MENU_W = 184;

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = items.length * 36 + 10;
    let top = r.bottom + 4;
    if (top + menuH > window.innerHeight - 8) {
      top = Math.max(8, r.top - 4 - menuH); // flip above when near the bottom edge
    }
    // Open down-right, left-aligned to the trigger; shift left only if it would
    // overflow the right viewport edge.
    let left = r.left;
    if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - 8 - MENU_W;
    if (left < 8) left = 8;
    setCoords({ top, left });
  }, [items.length]);

  const toggle = useCallback(
    (e) => {
      e.stopPropagation();
      setOpen((o) => {
        if (!o) place();
        return !o;
      });
    },
    [place]
  );

  // Close on any outside click, scroll (including the inner table scroller),
  // resize, or Escape. The opening click is stopPropagation'd, so the listener
  // added here only catches subsequent interactions.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="trans-budget-table__kebab"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        onClick={toggle}
      >
        {busy ? (
          <span className="trans-budget-table__kebab-spinner" aria-hidden="true" />
        ) : (
          <EllipsisVertical size={16} aria-hidden="true" />
        )}
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            className="trans-budget-row-menu"
            role="menu"
            style={{ top: coords.top, left: coords.left, width: MENU_W }}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={`trans-budget-row-menu__item${
                  it.tone ? ` trans-budget-row-menu__item--${it.tone}` : ""
                }`}
                disabled={it.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  it.onClick();
                }}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
