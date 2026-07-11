import { lazy } from "react";
import ReportTabs from "../components/ReportTabs/ReportTabs.jsx";

/**
 * CashFlowTabs (CR042 U5) — the consolidated cash-flow report.
 *
 * Merges /cash-flow (P&L summary) and /cash-flow-periods (per-period columns)
 * into one destination /cash-flow with a deep-linkable tab switcher at
 * /cash-flow/:view. The old /cash-flow-periods URL redirects here (App.jsx).
 */

const Summary = lazy(() => import("./CashFlow"));
const Periods = lazy(() => import("./CashFlowPeriods"));

const TABS = [
  { key: "summary", label: "Summary", Component: Summary },
  { key: "periods", label: "By Period", Component: Periods },
];

export default function CashFlowTabs() {
  return (
    <ReportTabs basePath="/cash-flow" tabs={TABS} ariaLabel="Cash flow views" />
  );
}
