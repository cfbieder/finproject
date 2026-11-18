/** CR105 S4 — the inspector's provider and panel; the hook is in inspector.js. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { InspectorContext, useInspector } from "./inspector.js";

const EDITABLE = "input, textarea, select, [contenteditable='true']";

/** Hand focus back to whatever opened the panel. */
function restoreFocus(opener) {
  const el = opener.current;
  opener.current = null;
  if (el && typeof el.focus === "function" && document.contains(el)) el.focus();
}

/**
 * Two ways to fill the panel:
 *  - open({ key, title, content }) — a read-only snapshot (a figure's entries);
 *  - <InspectorPortal title onClose> — the page renders LIVE content (a form whose
 *    values the page holds) into the panel; ✕ and Esc call its onClose.
 */
export function InspectorProvider({ children }) {
  const [opened, setOpened] = useState(null); // { key, title, content, path }
  const [portal, setPortal] = useState(null); // { title }
  const [slot, setSlot] = useState(null); // the panel body element
  const itemRef = useRef(null);
  const pathRef = useRef(null);
  const portalClose = useRef(null);
  const opener = useRef(null);
  const { pathname } = useLocation();

  // A drill-down belongs to the page it was opened on: on another page it is not shown.
  const item = opened && opened.path === pathname ? opened : null;

  useEffect(() => {
    itemRef.current = item;
    pathRef.current = pathname;
  });

  const close = useCallback(() => {
    if (portalClose.current) {
      portalClose.current(); // the page decides (e.g. cancels its edit)
      return;
    }
    setOpened(null);
    restoreFocus(opener);
  }, []);

  const open = useCallback(
    (next) => {
      if (itemRef.current?.key === next.key) {
        close(); // the same figure again closes it
        return;
      }
      if (!itemRef.current) opener.current = document.activeElement;
      setOpened({ ...next, path: pathRef.current });
    },
    [close]
  );

  const attach = useCallback((title, onClose) => {
    opener.current = document.activeElement;
    portalClose.current = onClose;
    setOpened(null);
    setPortal({ title });
  }, []);
  const detach = useCallback(() => {
    portalClose.current = null;
    setPortal(null);
    restoreFocus(opener);
  }, []);

  const active = Boolean(item || portal);

  // Esc closes — unless it is meant for a field inside the panel, or a modal is on top.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      const t = e.target;
      if (t instanceof Element && t.closest(".wb-insp") && t.matches(EDITABLE)) return;
      // A live form (portal) is closed by its own Cancel, never by a stray Esc on a button or list.
      if (portalClose.current && t instanceof Element && t.closest(".wb-insp form")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  const value = useMemo(
    () => ({ open, close, item, portal, attach, detach, slot, setSlot }),
    [open, close, item, portal, attach, detach, slot]
  );
  return <InspectorContext.Provider value={value}>{children}</InspectorContext.Provider>;
}

/** The panel itself; WorkbenchLayout places it beside the page. */
export function InspectorPanel() {
  const ctx = useInspector();
  const heading = useRef(null);
  const item = ctx?.item ?? null;
  const portal = ctx?.portal ?? null;
  const setSlot = ctx?.setSlot;
  const close = ctx?.close;
  const title = portal?.title ?? item?.title;
  const key = portal ? "portal" : item?.key;
  useEffect(() => {
    if (key) heading.current?.focus();
  }, [key]);
  if (!item && !portal) return null;
  return (
    <aside className="wb-insp" aria-label={`Details: ${title}`}>
      <div className="wb-insp__head">
        <h2 className="wb-insp__title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button
          type="button"
          className="wb-insp__close"
          onClick={close}
          aria-label="Close details"
          title="Close (Esc)"
        >
          <X size={16} />
        </button>
      </div>
      {portal ? (
        <div className="wb-insp__body" ref={setSlot} />
      ) : (
        <div className="wb-insp__body">{item.content}</div>
      )}
    </aside>
  );
}

/**
 * Render live page content into the inspector while mounted. Outside the
 * Workbench layout it renders nothing — callers render their modal instead.
 */
export function InspectorPortal({ title, onClose, children }) {
  const ctx = useInspector();
  const attach = ctx?.attach;
  const detach = ctx?.detach;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!attach) return undefined;
    attach(title, () => closeRef.current?.());
    return () => detach();
  }, [attach, detach, title]);
  if (!ctx?.slot || !ctx.portal) return null;
  return createPortal(children, ctx.slot);
}
