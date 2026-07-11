import { lazy } from "react";
import ReportTabs from "../components/ReportTabs/ReportTabs.jsx";

/**
 * BudgetVsActual (CR042 U5) — the consolidated budget-vs-actual report.
 *
 * Merges the three former variants — /budget-realization (table),
 * /budget-graph (charts), /budget-variances (ranked line items) — into one
 * destination /budget-vs-actual with a deep-linkable tab switcher at
 * /budget-vs-actual/:view. The old URLs redirect here (App.jsx). Budget
 * Worksheet (entry) and Budget FX Rates stay separate — they are not vs-actual.
 */

const Realization = lazy(() => import("./BudgetRealization"));
const Graph = lazy(() => import("./BudgetRealizationGraph"));
const Variances = lazy(() => import("./BudgetVariances"));

const TABS = [
  { key: "table", label: "Realization", Component: Realization },
  { key: "chart", label: "Chart", Component: Graph },
  { key: "variances", label: "Variances", Component: Variances },
];

export default function BudgetVsActual() {
  return (
    <ReportTabs
      basePath="/budget-vs-actual"
      tabs={TABS}
      ariaLabel="Budget vs actual views"
    />
  );
}
