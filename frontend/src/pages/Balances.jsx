import { lazy } from "react";
import ReportTabs from "../components/ReportTabs/ReportTabs.jsx";

/**
 * Balances (CR042 U5) — the consolidated balance-sheet report.
 *
 * Merges the four former sibling pages (/balance, /balance-sheet-periods,
 * /balance-trends, /balance-chart) into one destination with a deep-linkable
 * tab switcher at /balances/:view. The old URLs redirect here (see App.jsx).
 * Each tab renders the existing page component unchanged — pure IA/routing.
 */

const Summary = lazy(() => import("./BalanceV2"));
const Periods = lazy(() => import("./BalanceSheetPeriods"));
const Trends = lazy(() => import("./BalanceTrends"));
const Chart = lazy(() => import("./BalanceChart"));

const TABS = [
  { key: "summary", label: "Summary", Component: Summary },
  { key: "periods", label: "Periods", Component: Periods },
  { key: "trends", label: "Trends", Component: Trends },
  { key: "chart", label: "Net Worth", Component: Chart },
];

export default function Balances() {
  return <ReportTabs basePath="/balances" tabs={TABS} ariaLabel="Balance views" />;
}
