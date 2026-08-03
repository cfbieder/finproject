/**
 * The five headline metrics a forecast trajectory chart can plot (CR067 P1).
 *
 * In its own `.js` module rather than beside the component: `FCTrajectoryChart.jsx` exporting
 * both a component and a constant trips `react-refresh/only-export-components`, which is one
 * of the six ratchets and may only shrink.
 *
 * Each `key` names a row on a `buildScenarioMatrix` result — and `netCashFlow` is the one to
 * be careful with, because that matrix carries TWO things by that name: a top-level array of
 * plain numbers (never null) and `cash.get("Net Cash Flow")` (null in a year with no
 * Income/Expense/Transfers rows). Compare plots the SECOND. Reading the first draws 0 where
 * Compare draws a gap. `Expense` is likewise already net of Transfers.
 */
export const METRICS = [
  { key: "netAssets", label: "Net Assets" },
  { key: "totalAssets", label: "Total Assets" },
  { key: "netCashFlow", label: "Net Cash Flow" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expenses" },
];
