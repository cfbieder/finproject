import { lazy } from "react";
import { useParams, Navigate, Link } from "react-router-dom";
import "./Balances.css";

/**
 * Balances (CR042 U5) — the consolidated balance-sheet report.
 *
 * Merges the four former sibling pages (/balance, /balance-sheet-periods,
 * /balance-trends, /balance-chart) into one destination with a deep-linkable
 * tab switcher at /balances/:view. The old URLs 301-style redirect here (see
 * App.jsx). Each tab renders the existing page component unchanged, so this is
 * a pure IA/routing change — no report logic moved.
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
  const { view } = useParams();
  const active = view || "summary";
  const tab = TABS.find((t) => t.key === active);

  // Unknown tab slug → canonicalize to the summary view.
  if (!tab) return <Navigate to="/balances/summary" replace />;

  const Active = tab.Component;
  return (
    <>
      <nav className="balances-tabs" aria-label="Balance views">
        {TABS.map((t) => (
          <Link
            key={t.key}
            to={`/balances/${t.key}`}
            className={`balances-tab${t.key === active ? " balances-tab--active" : ""}`}
            aria-current={t.key === active ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Active />
    </>
  );
}
