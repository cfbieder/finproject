/**
 * CR105 S4 — the Workbench inspector: one 340px panel on the right that shows
 * a drill-down (a transaction, a cash-flow figure, a forecast line) without
 * leaving the page.
 *
 * Only WorkbenchLayout mounts the provider (InspectorContext.jsx). Outside it
 * (tests, a page rendered bare) useInspector() returns null and the drill-down
 * does nothing — the classic modal fallbacks were removed in v3.102.0:
 *
 *   useInspector()?.open({ key, title, content: <Body … /> });
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
