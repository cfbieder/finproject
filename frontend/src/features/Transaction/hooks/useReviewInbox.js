/**
 * CR105 S5 — Refresh Feeds' review list as a keyboard inbox (Workbench only).
 *
 *   j / k   move the row cursor        a   accept the cursor row
 *   c       set its category           /   focus the search box
 *
 * Accept and category go through the page's own handlers, so the CR065
 * unpaired-accept warning and the category picker behave exactly as with the
 * mouse. The cursor follows the rows AS DRAWN (grouping by account reorders
 * them), read from the table's data-row-id attributes. Outside the Workbench
 * layout the hook is inert and the rows pass through unfiltered.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useInspector } from "../../../contexts/inspector.js";
import { isTypingTarget } from "../../../components/Workbench/keys.js";

const text = (e) =>
  [e?.Description1, e?.Description2, e?.Account, e?.Category, e?.Currency, e?.Amount]
    .filter((v) => v != null)
    .join(" ")
    .toLowerCase();

export default function useReviewInbox({ rows, active, onAccept, onCategory, busy }) {
  const enabled = useInspector() !== null;
  const [search, setSearch] = useState("");
  const [cursorId, setCursorId] = useState(null);
  const searchRef = useRef(null);
  const tableRef = useRef(null);
  // Set the moment an accept starts — before the page's busy flag (which arrives a
  // render later, and only after the no-offset warning is answered).
  const inFlight = useRef(false);

  const filtered = useMemo(() => {
    const q = enabled ? search.trim().toLowerCase() : "";
    if (!q) return rows;
    return rows.filter(({ entry }) => text(entry).includes(q));
  }, [rows, search, enabled]);

  // The cursor only points at a row that is on screen.
  const shownCursor = filtered.some((r) => r.rowId === cursorId) ? cursorId : null;

  const latest = useRef({});
  const cursorAt = useRef(null);
  useEffect(() => {
    cursorAt.current = cursorId;
  }, [cursorId]);
  useEffect(() => {
    latest.current = { filtered, shownCursor, onAccept, onCategory, busy };
  });

  useEffect(() => {
    if (!enabled || !active) return undefined;

    const order = () =>
      Array.from(tableRef.current?.querySelectorAll("tr[data-row-id]") || []).map((el) => el.dataset.rowId);
    const show = (id) => {
      setCursorId(id);
      requestAnimationFrame(() => {
        const el = Array.from(tableRef.current?.querySelectorAll("tr[data-row-id]") || []).find(
          (r) => r.dataset.rowId === id
        );
        el?.scrollIntoView?.({ block: "nearest" });
      });
    };

    const onKey = async (e) => {
      if (e.defaultPrevented || isTypingTarget(e)) return;
      // A held key must not walk down the list accepting (or re-opening) row after row.
      if (e.repeat && (e.key === "a" || e.key === "c")) return;
      const { filtered: list, shownCursor: cur, busy: isBusy } = latest.current;
      const ids = order();
      const at = cur ? ids.indexOf(cur) : -1;
      const entryOf = (id) => list.find((r) => r.rowId === id)?.entry;

      switch (e.key) {
        case "j":
        case "k": {
          if (ids.length === 0) return;
          e.preventDefault();
          const next = at < 0 ? 0 : Math.min(Math.max(at + (e.key === "j" ? 1 : -1), 0), ids.length - 1);
          show(ids[next]);
          return;
        }
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          return;
        case "c":
          if (!cur) return;
          e.preventDefault();
          latest.current.onCategory(cur, entryOf(cur));
          return;
        case "a": {
          if (!cur || isBusy || inFlight.current) return;
          e.preventDefault();
          // Where the cursor goes once the row leaves the list.
          const after = ids[at + 1] ?? ids[at - 1] ?? null;
          inFlight.current = true;
          try {
            const ok = await latest.current.onAccept(cur, entryOf(cur));
            // Move on only if the user has not moved the cursor meanwhile.
            if (ok && after && latest.current.shownCursor !== after && cursorAt.current === cur) show(after);
          } finally {
            inFlight.current = false;
          }
          return;
        }
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, active]);

  return {
    enabled,
    // A mouse click on a row moves the cursor there, so a/c act on what was clicked.
    point: (id) => enabled && setCursorId(id),
    rows: filtered,
    cursorId: enabled ? shownCursor : null,
    search,
    setSearch,
    searchRef,
    tableRef,
  };
}
