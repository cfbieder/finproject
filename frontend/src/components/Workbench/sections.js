/**
 * CR105 S1 — the Workbench information architecture.
 *
 * Each rail section owns a list of tabs; a tab is an existing route. The route
 * table (config/routes.jsx) stays the source of the pages themselves — this
 * file only groups them. sections.test.js fails if a nav route is missing here
 * or a tab points at a path the router does not have.
 *
 * `period: true` marks a tab whose page follows the header month (CR105 S2);
 * the header shows the month picker only on those tabs.
 *
 * `go` is the section's keyboard jump (CR105 S5): g, then that letter.
 * The FIRST tab is where the rail icon and the g-jump land, so order matters.
 */
import {
  Home,
  Inbox,
  Receipt,
  Calculator,
  TrendingUp,
  BarChart3,
  PieChart,
  Landmark,
  Settings2,
} from "lucide-react";

export const WORKBENCH_SECTIONS = [
  { key: "today", go: "d", label: "Today", icon: Home, tabs: [{ path: "/", label: "Today" }] },
  {
    key: "inbox", go: "i",
    label: "Inbox",
    icon: Inbox,
    tabs: [{ path: "/refresh-feeds", label: "Refresh & review" }],
  },
  {
    key: "tx", go: "t",
    label: "Transactions",
    icon: Receipt,
    tabs: [
      { path: "/ledger", label: "Ledger" },
      { path: "/transfer-analysis", label: "Transfers" },
      { path: "/trans-actual", label: "Actuals", period: true },
      { path: "/manual-entry", label: "Manual entry" },
      { path: "/balance-calibration", label: "Calibration" },
      { path: "/manual-calibration", label: "Manual calibration" },
      { path: "/holdings", label: "Holdings" },
    ],
  },
  {
    key: "budget", go: "b",
    label: "Budget",
    icon: Calculator,
    tabs: [
      { path: "/budget-vs-actual", label: "Analysis", period: true },
      { path: "/budget-le", label: "Latest Estimate" },
      { path: "/budget-builder", label: "Builder" },
      { path: "/budget-worksheet", label: "Worksheet" },
      // The budget rows the Builder publishes and the Worksheet edits.
      { path: "/trans-budget", label: "Transactions" },
      { path: "/budget-fx", label: "FX rates" },
    ],
  },
  {
    key: "forecast", go: "f",
    label: "Forecast",
    icon: TrendingUp,
    tabs: [
      { path: "/forecast-mapping", label: "Mapping" },
      { path: "/forecast-scenarios", label: "Scenarios" },
      { path: "/forecast-modules", label: "Modules" },
      { path: "/forecast-review", label: "Review" },
      { path: "/forecast-compare", label: "Compare" },
      { path: "/forecast-multi-compare", label: "Multi-compare" },
      { path: "/forecast-sensitivity", label: "Sensitivity" },
      { path: "/forecast-equity", label: "Equity" },
      { path: "/fc-settings", label: "Settings" },
    ],
  },
  {
    key: "wealth", go: "w",
    label: "Wealth",
    icon: BarChart3,
    tabs: [
      { path: "/balances", label: "Balances", period: true },
      { path: "/cash-flow", label: "Cash flow", period: true },
      { path: "/net-worth-drivers", label: "Net worth drivers", period: true },
      { path: "/category-trend", label: "Category trend", period: true },
    ],
  },
  {
    key: "investments", go: "p",
    label: "Investments",
    icon: PieChart,
    tabs: [
      { path: "/investments", label: "Summary" },
      { path: "/investments/exposure", label: "Exposure" },
      { path: "/investments/income", label: "Income" },
      { path: "/investments/risk", label: "Risk" },
      // /investment-returns is the pre-move path, kept for bookmarks.
      { path: "/investments/returns", label: "Returns", also: ["/investment-returns"] },
      { path: "/investments/positions", label: "Positions" },
    ],
  },
  {
    key: "taxes", go: "x",
    label: "Taxes",
    icon: Landmark,
    tabs: [
      { path: "/tax/foreign-accounts", label: "Foreign accounts" },
      { path: "/tax/fbar", label: "FBAR" },
    ],
  },
  {
    key: "setup", go: "s",
    label: "Setup",
    icon: Settings2,
    foot: true,
    tabs: [
      { path: "/bank-feed-diagnostic", label: "Bank feeds" },
      { path: "/coa-management", label: "Chart of accounts" },
      { path: "/program-settings", label: "Settings" },
      { path: "/upload-ps", label: "Upload PS" },
      { path: "/backup-database", label: "Backup" },
      { path: "/quicken-import", label: "Quicken import" },
    ],
  },
];

/** True when `pathname` is `base` or a page under it (segment-aware; "/" only exact). */
function underPath(pathname, base) {
  if (base === "/") return pathname === "/";
  return pathname === base || pathname.startsWith(base + "/");
}

/**
 * The section and tab that own `pathname`: the longest matching tab path wins,
 * so /investments/exposure is Exposure, not Summary, and /balances/periods is
 * Balances. Returns { section: null, tab: null } for pages outside every section.
 */
export function findWorkbenchTab(pathname) {
  let best = { section: null, tab: null, len: -1 };
  for (const section of WORKBENCH_SECTIONS) {
    for (const tab of section.tabs) {
      for (const p of [tab.path, ...(tab.also || [])]) {
        if (underPath(pathname, p) && p.length > best.len) {
          best = { section, tab, len: p.length };
        }
      }
    }
  }
  return { section: best.section, tab: best.tab };
}
