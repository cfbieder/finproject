/**
 * CR105 S4 — the Workbench inspector: one 340px panel on the right that shows
 * a drill-down (a transaction, a cash-flow figure, a forecast line) without
 * leaving the page.
 *
 * Only WorkbenchLayout mounts the provider (InspectorContext.jsx). Outside it
 * useInspector() returns null, and a page opens its existing modal instead —
 * so the classic layout is unchanged:
 *
 *   const insp = useInspector();
 *   if (insp) insp.open({ key, title, content: <Body … /> });
 *   else setModalOpen(true);
 *
 * `key` identifies what is shown: opening the same key again closes it (a
 * second click on the same figure), a different key replaces it.
 */
import { createContext, useContext } from "react";

export const InspectorContext = createContext(null);

/** The inspector API ({ open, close, item, … }), or null outside the Workbench layout. */
export function useInspector() {
  return useContext(InspectorContext);
}
