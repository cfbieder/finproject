import { lazy } from "react";
import ReportTabs from "../components/ReportTabs/ReportTabs.jsx";
import { useHeaderPeriod } from "../contexts/headerPeriod.js";

/**
 * Balances (CR042 U5) — the consolidated balance-sheet report.
 *
 * Merges the four former sibling pages (/balance, /balance-sheet-periods,
 * /balance-trends, /balance-chart) into one destination with a deep-linkable
 * tab switcher at /balances/:view. The old URLs redirect here (see App.jsx).
 * Each tab renders the existing page component unchanged — pure IA/routing.
 */

const SummaryClassic = lazy(() => import("./BalanceV2"));
const SummaryWorkbench = lazy(() => import("./BalanceWorkbench"));

/** CR105 S3 — the Workbench layout gets Proposal B's Summary; classic keeps BalanceV2. */
function Summary() {
  return useHeaderPeriod() ? <SummaryWorkbench /> : <SummaryClassic />;
}
const Periods = lazy(() => import("./BalanceSheetPeriods"));
const Trends = lazy(() => import("./BalanceTrends"));
const Chart = lazy(() => import("./BalanceChart"));
const Forecast = lazy(() => import("./BalanceForecast"));

const TABS = [
  { key: "summary", label: "Summary", Component: Summary },
  { key: "periods", label: "Periods", Component: Periods },
  { key: "trends", label: "Trends", Component: Trends },
  { key: "chart", label: "Net Worth", Component: Chart },
  { key: "forecast", label: "Forecast", Component: Forecast },
];

export default function Balances() {
  return <ReportTabs basePath="/balances" tabs={TABS} ariaLabel="Balance views" />;
}
