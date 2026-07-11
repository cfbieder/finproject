import { Navigate, Link, useParams } from "react-router-dom";
import "./ReportTabs.css";

/**
 * ReportTabs (CR042 U5) — the shared tab shell for consolidated reports.
 *
 * Renders a slim underline tab strip above the active sub-report. Each report
 * page (Balances, CashFlow, BudgetVsActual) supplies its `basePath` + `tabs`
 * ([{ key, label, Component }]) and the shell handles the /base/:view routing:
 * the `:view` param selects the tab, an unknown slug canonicalizes to the first
 * tab, and each tab deep-links to `${basePath}/${key}`. The sub-page components
 * render unchanged below the strip (siblings, so no nested <main>).
 */
export default function ReportTabs({ basePath, tabs, ariaLabel = "Report views" }) {
  const { view } = useParams();
  const active = view || tabs[0].key;
  const tab = tabs.find((t) => t.key === active);

  if (!tab) return <Navigate to={`${basePath}/${tabs[0].key}`} replace />;

  const Active = tab.Component;
  return (
    <>
      <nav className="report-tabs" aria-label={ariaLabel}>
        {tabs.map((t) => (
          <Link
            key={t.key}
            to={`${basePath}/${t.key}`}
            className={`report-tab${t.key === active ? " report-tab--active" : ""}`}
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
