/**
 * Unified Routes Configuration
 *
 * Single source of truth for all application routes.
 * Used to generate the router, navigation menu, category landing pages, and breadcrumbs.
 */

import { lazy } from "react";
import { ForecastProvider } from "../contexts";
import {
  Upload,
  RefreshCw,
  HardDrive,
  FileSpreadsheet,
  BarChart3,
  TrendingUp,
  LayoutDashboard,
  Layers,
  Settings2,
  Receipt,
  DollarSign,
  BookOpen,
  Target,
  PlusCircle,
  Calculator,
  Eye,
  ArrowLeftRight,
  GitCompare,
  SlidersHorizontal,
  Wallet,
  PieChart,
  Palette,
  LineChart,
  Scale,
  Landmark,
} from "lucide-react";

// Eagerly loaded pages (for fast initial render)
import Home from "../pages/Home";

// Lazy loaded pages (for code splitting)
const BackupDatabase = lazy(() => import("../pages/BackupDatabase"));
const QuickenImport = lazy(() => import("../pages/QuickenImport"));
const BankFeedDiagnostic = lazy(() => import("../pages/BankFeedDiagnostic"));
// CR042 U5: the four former balance pages are now tabs inside Balances.
const Balances = lazy(() => import("../pages/Balances"));
const BudgetInput = lazy(() => import("../pages/BudgetWorksheetV2"));
// CR042 U5: the three budget-vs-actual variants are now tabs inside BudgetVsActual.
const BudgetVsActual = lazy(() => import("../pages/BudgetVsActual"));
// CR083 P0b: the Latest Estimate. One screen, no tab strip (§11.1).
const BudgetLE = lazy(() => import("../pages/BudgetLE"));
// CR042 U5: the two cash-flow pages are now tabs inside CashFlowTabs.
const CashFlowTabs = lazy(() => import("../pages/CashFlowTabs"));
const InvestmentReturns = lazy(() => import("../pages/InvestmentReturns"));
const NetWorthDrivers = lazy(() => import("../pages/NetWorthDrivers"));
const Investments = lazy(() => import("../pages/Investments"));
const InvestmentAccount = lazy(() => import("../pages/InvestmentAccount"));
const InvestmentExposure = lazy(() => import("../pages/InvestmentExposure"));
const FCEquity = lazy(() => import("../pages/FCEquity"));
const FCLineMapping = lazy(() => import("../pages/FCLineMapping"));
const FCModuleManage = lazy(() => import("../pages/FCModuleManage"));
const FCReview = lazy(() => import("../pages/FCReview"));
const FCCompare = lazy(() => import("../pages/FCCompare"));
const FCMultiCompare = lazy(() => import("../pages/FCMultiCompare"));
const FCSensitivity = lazy(() => import("../pages/FCSensitivity"));
const FCScenarios = lazy(() => import("../pages/FCScenarios"));
const FCSettings = lazy(() => import("../pages/FCSettings"));
const ProgramSettings = lazy(() => import("../pages/ProgramSettings"));
const RefreshFeeds = lazy(() => import("../pages/RefreshFeeds"));
const TransActual = lazy(() => import("../pages/TransActual"));
const TransBudget = lazy(() => import("../pages/TransBudget"));
const TransferAnalysis = lazy(() => import("../pages/TransferAnalysis"));
const Ledger = lazy(() => import("../pages/Ledger"));
const BalanceCalibration = lazy(() => import("../pages/BalanceCalibration"));
const ManualCalibration = lazy(() => import("../pages/ManualCalibration"));
const ManualTransactionEntry = lazy(() => import("../pages/ManualTransactionEntry"));
const UploadPS = lazy(() => import("../pages/UploadPS"));
const COAManagement = lazy(() => import("../pages/COAManagement"));
const BudgetFX = lazy(() => import("../pages/BudgetFX"));
const CategoryTrend = lazy(() => import("../pages/CategoryTrend"));
const UIPreview = lazy(() => import("../pages/UIPreview"));
const TaxForeignAccounts = lazy(() => import("../pages/TaxForeignAccounts"));
const TaxFbar = lazy(() => import("../pages/TaxFbar"));

/**
 * Category metadata for landing pages.
 */
export const CATEGORY_META = {
  Database: {
    description: "Import, refresh, and manage your financial data sources",
    icon: HardDrive,
  },
  Budgeting: {
    description: "Plan budgets, track realization, and analyze variances",
    icon: Calculator,
  },
  Forecasting: {
    description: "Build scenarios, manage modules, and review forecasts",
    icon: TrendingUp,
  },
  "Reports & Graphs": {
    description: "View balance sheets, cash flow reports, and charts",
    icon: BarChart3,
  },
  Transactions: {
    description: "Browse and manage actual and budget transactions",
    icon: Receipt,
  },
  Settings: {
    description: "Configure chart of accounts and application preferences",
    icon: Settings2,
  },
  Taxes: {
    description: "Foreign account reporting and other annual tax forms",
    icon: Landmark,
  },
  Investments: {
    description: "What each investment account holds, as the custodian reports it",
    icon: PieChart,
  },
};

/**
 * Route configuration object.
 *
 * Each route can have:
 * - path: URL path
 * - component: Component to render
 * - label: Display name for navigation
 * - category: Navigation category (optional)
 * - subcategory: Navigation subcategory (optional)
 * - wrapper: Context provider to wrap the route (optional)
 * - showInNav: Whether to show in navigation (default: true)
 * - description: Short description for landing page cards
 * - icon: Lucide icon component
 */
export const routes = [
  // Home
  {
    path: "/",
    component: Home,
    label: "Home",
    showInNav: true,
    category: null,
    description: "Dashboard and quick actions",
    icon: LayoutDashboard,
  },

  // Transactions
  {
    path: "/refresh-feeds",
    component: RefreshFeeds,
    label: "Refresh Feeds",
    category: "Transactions",
    description: "Refresh and review bank-feed transactions",
    icon: RefreshCw,
  },
  {
    path: "/trans-actual",
    component: TransActual,
    label: "Actuals",
    category: "Transactions",
    description: "View, search, and manage actual transactions",
    icon: Receipt,
  },
  {
    path: "/trans-budget",
    component: TransBudget,
    label: "Budget",
    category: "Transactions",
    description: "View and manage budget transaction entries",
    icon: FileSpreadsheet,
  },
  {
    path: "/transfer-analysis",
    component: TransferAnalysis,
    label: "Transfer Analysis",
    category: "Transactions",
    description: "Match and analyze transfer transactions across accounts",
    icon: ArrowLeftRight,
  },
  {
    path: "/ledger",
    component: Ledger,
    label: "Ledger",
    category: "Transactions",
    description: "Account ledger with running balance for assets and liabilities",
    icon: BookOpen,
  },
  {
    path: "/balance-calibration",
    component: BalanceCalibration,
    label: "Balance Calibration",
    category: "Transactions",
    description: "Calibrate account opening balances for Balance Sheet accuracy",
    icon: Target,
  },
  {
    path: "/manual-calibration",
    component: ManualCalibration,
    label: "Manual Calibration",
    category: "Transactions",
    description: "Calibrate non-fed account balances by entering the current balance by hand",
    icon: Wallet,
  },
  {
    path: "/manual-entry",
    component: ManualTransactionEntry,
    label: "Manual Entry",
    category: "Transactions",
    description: "Hand-enter a single actual transaction (stays open for rapid entry)",
    icon: PlusCircle,
  },

  // Budgeting
  {
    path: "/budget-worksheet",
    component: BudgetInput,
    label: "Budget Worksheet",
    category: "Budgeting",
    description: "Create and edit monthly budget entries",
    icon: FileSpreadsheet,
  },
  {
    path: "/budget-le",
    component: BudgetLE,
    label: "Latest Estimate",
    category: "Budgeting",
    description:
      "Where the year lands — actual months to the cut, plus an estimate for the rest",
    icon: Target,
  },
  {
    // CR088 P5: renamed "Budget vs Actual" -> "Budget Analysis". The page now
    // compares any two of BUDGET, ACTUAL and LE, so the old label named one of
    // three modes and sat on screen contradicting its own toggle. The ROUTE is
    // deliberately unchanged (owner decision): this destination already absorbs
    // three CR042 redirects, and a fourth would be redirect debt on redirect
    // debt for a string nobody reads.
    path: "/budget-vs-actual",
    component: BudgetVsActual,
    label: "Budget Analysis",
    category: "Budgeting",
    description:
      "Compare any two of budget, actual and latest estimate by category — realization table, charts, and line items ranked by largest variance",
    icon: Target,
  },
  {
    path: "/budget-vs-actual/:view",
    component: BudgetVsActual,
    label: "Budget Analysis",
    category: "Budgeting",
    showInNav: false,
    icon: Target,
  },
  {
    path: "/budget-fx",
    component: BudgetFX,
    label: "Budget FX Rates",
    category: "Budgeting",
    description: "Manage monthly budget exchange rates by currency",
    icon: DollarSign,
  },

  // Forecasting (wrapped in ForecastProvider)
  {
    path: "/forecast-mapping",
    stepLabel: "Mapping", // short form for the in-page stepper (FCStepNav reads it here)
    step: 1, // Forecast workflow step — mirrors FCStepNav; rendered by the Sidebar only
    component: FCLineMapping,
    label: "Income & Expense Mapping",
    category: "Forecasting",
    description: "Map budget categories to forecast income and expense lines",
    icon: ArrowLeftRight,
  },
  {
    path: "/forecast-scenarios",
    stepLabel: "Scenarios", // short form for the in-page stepper (FCStepNav reads it here)
    step: 2, // Forecast workflow step — mirrors FCStepNav; rendered by the Sidebar only
    component: FCScenarios,
    label: "Forecast Scenarios",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Create and manage forecast scenarios with assumptions",
    icon: Layers,
  },
  {
    path: "/forecast-modules",
    stepLabel: "Modules", // short form for the in-page stepper (FCStepNav reads it here)
    step: 3, // Forecast workflow step — mirrors FCStepNav; rendered by the Sidebar only
    component: FCModuleManage,
    label: "Forecast Modules",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Configure balance sheet forecast modules",
    icon: BookOpen,
  },
  // CR069 P2 — the Expenditures step is GONE: an income/expense item is a module with no
  // valuation and one stream, managed on /forecast-modules like everything else. The route is
  // removed here rather than in P3 because its API answers 410 from this same deploy — the
  // engine stopped reading `forecast_income_expense`, so a save on that page would be accepted
  // and silently ignored. Six steps become FIVE: Mapping → Scenarios → Modules → Review →
  // Compare, and the steps below were renumbered to match. The stepper and the sidebar both
  // derive from this list, so they cannot disagree about it (FCStepNav.jsx:5-13).
  // The page component and its ~2,770 lines retire in P3.
  {
    path: "/forecast-review",
    stepLabel: "Review", // short form for the in-page stepper (FCStepNav reads it here)
    step: 4, // Forecast workflow step — mirrors FCStepNav; rendered by the Sidebar only
    component: FCReview,
    label: "Forecast Review",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Review and analyze generated forecasts",
    icon: Eye,
  },
  {
    path: "/forecast-compare",
    stepLabel: "Compare", // short form for the in-page stepper (FCStepNav reads it here)
    step: 5, // Forecast workflow step — mirrors FCStepNav; rendered by the Sidebar only
    component: FCCompare,
    label: "Forecast Compare",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Compare two forecast scenarios: deltas, charts, and commentary",
    icon: ArrowLeftRight,
  },
  {
    // CR067 — the same treatment as Equity below, for the same reason: a report OVER a
    // generated forecast, not a seventh setup step, so deliberately no `step`. Compare
    // answers "how do these two differ?" in detail; this answers "how does the fan of
    // variants sit against the base?" and only that. No `wrapper: ForecastProvider` —
    // the page's own `useScenarios` is self-contained, as on Equity.
    path: "/forecast-multi-compare",
    component: FCMultiCompare,
    label: "Forecast Multi-Compare",
    category: "Forecasting",
    description:
      "One base scenario and any of its variants on a single trajectory chart — the fan, where Compare gives you one pair at a time",
    icon: GitCompare,
  },
  {
    // CR085 — a report over a generated forecast, so no `step` and no `wrapper:
    // ForecastProvider`, following Multi-Compare and Equity. Compare and Multi-Compare
    // both answer "how do these PLANS differ?"; this answers "which assumption inside ONE
    // plan is it resting on?", which no number of pairwise comparisons produces.
    path: "/forecast-sensitivity",
    component: FCSensitivity,
    label: "Forecast Sensitivity",
    category: "Forecasting",
    description:
      "Move one assumption at a time and rank what actually moves the plan — every bar a real forecast build",
    icon: SlidersHorizontal,
  },
  {
    // CR062 P2 — sits in Forecasting, deliberately WITHOUT a `step`. It is a report
    // over a generated forecast, not a seventh setup step, and the CR042 invariant
    // ("the Forecasting group is exactly the six steps FCStepNav numbers, in the
    // same order") is about the NUMBERED list: the Sidebar prefixes `N. ` only when
    // `step` is set, so an unnumbered entry after step 6 leaves the stepper and the
    // sidebar still agreeing 1–6. Give this a `step` and they diverge — that is the
    // thing to keep out, not the entry itself. Owner moved it here from
    // Reports & Graphs (2026-07-31): it needs a scenario and answers a forecast
    // question, so Reports was where people did not look for it.
    // No `wrapper: ForecastProvider` — the page's `useScenarios` is self-contained.
    path: "/forecast-equity",
    component: FCEquity,
    label: "Forecast Equity",
    category: "Forecasting",
    description:
      "Each forecast asset gross and net of the loans secured against it — the equity build, and income after debt service",
    icon: LineChart,
  },
  {
    path: "/fc-settings",
    component: FCSettings,
    label: "Forecast Settings",
    // Same rule: assumptions/config live in Settings. The Forecasting group is then
    // the six steps FCStepNav numbers, in the same order, plus the unnumbered
    // Equity report above.
    category: "Settings",
    description: "Birth year, module types, and FX rate assumptions",
    icon: DollarSign,
  },

  // Reports & Graphs > Reports
  {
    path: "/balances",
    component: Balances,
    label: "Balances",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description:
      "Balance sheet, period-end snapshots, account trends, and the net-worth chart",
    icon: Wallet,
  },
  {
    // Deep-linkable tab view; reachable by URL but not listed separately in nav.
    path: "/balances/:view",
    component: Balances,
    label: "Balances",
    category: "Reports & Graphs",
    subcategory: "Reports",
    showInNav: false,
    icon: Wallet,
  },
  {
    path: "/cash-flow",
    component: CashFlowTabs,
    label: "Cash Flow",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Cash-flow P&L summary and the per-period (month/quarter/year) breakdown",
    icon: ArrowLeftRight,
  },
  {
    path: "/cash-flow/:view",
    component: CashFlowTabs,
    label: "Cash Flow",
    category: "Reports & Graphs",
    subcategory: "Reports",
    showInNav: false,
    icon: ArrowLeftRight,
  },

  {
    path: "/investment-returns",
    component: InvestmentReturns,
    label: "Investment Returns",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description:
      "Realized income and price return per period for an account, absolute and as a Modified Dietz %",
    icon: LineChart,
  },

  {
    path: "/net-worth-drivers",
    component: NetWorthDrivers,
    label: "Net Worth Drivers",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description:
      "Why net worth changed over a period — re-valued, earned, spent, currency, transfers — and which accounts did it",
    icon: Scale,
  },

  // Reports & Graphs > Graphs
  {
    path: "/category-trend",
    component: CategoryTrend,
    label: "Category Trend",
    category: "Reports & Graphs",
    subcategory: "Graphs",
    description: "Track category spending or income trends vs budget over time",
    icon: TrendingUp,
  },

  // Database
  {
    path: "/upload-ps",
    component: UploadPS,
    label: "Upload PS",
    category: "Database",
    description: "Upload PocketSmith CSV spreadsheet data",
    icon: Upload,
  },
  {
    path: "/backup-database",
    component: BackupDatabase,
    label: "Backup Database",
    category: "Database",
    description: "Create and manage database backups",
    icon: HardDrive,
  },
  {
    path: "/quicken-import",
    component: QuickenImport,
    label: "Quicken Import",
    category: "Database",
    description: "Map, promote, and roll back Quicken backfill batches (CR019)",
    icon: Upload,
  },
  {
    path: "/bank-feed-diagnostic",
    component: BankFeedDiagnostic,
    label: "Bank Feed Setup",
    // Configuration, not a recurring task — it belongs with Settings, not in the daily
    // Transactions list. (The two Calibration pages deliberately STAY under Transactions:
    // they are recurring work, and burying work in a config menu makes the app worse.)
    category: "Settings",
    description: "Map bank-feed accounts, check sync health & PS reconciliation",
    icon: RefreshCw,
  },

  // Settings
  {
    path: "/coa-management",
    component: COAManagement,
    label: "Chart of Accounts",
    category: "Settings",
    description: "Manage account hierarchy, types, and categories",
    icon: BookOpen,
  },
  {
    path: "/program-settings",
    component: ProgramSettings,
    label: "Program Settings",
    category: "Settings",
    description: "Configure application preferences and defaults",
    icon: Settings2,
  },
  {
    path: "/ui-preview",
    component: UIPreview,
    label: "UI Preview (CR026)",
    category: "Settings",
    description: "Non-functional mockup of the proposed new look: sidebar nav, dark mode, command palette, mobile view",
    icon: Palette,
    // Dev artifact from the CR026 design phase — route stays reachable by URL,
    // but it has no place in the user-facing nav.
    showInNav: false,
  },

  // Taxes (CR082). New top-level section; FinCEN 114 is its first form.
  {
    path: "/tax/foreign-accounts",
    component: TaxForeignAccounts,
    label: "Foreign Accounts",
    category: "Taxes",
    description:
      "Which accounts FBAR reports, their numbers and institutions — entered once, reviewed yearly",
    icon: Landmark,
  },
  {
    path: "/tax/fbar",
    component: TaxFbar,
    label: "FBAR (Form 114)",
    category: "Taxes",
    description:
      "The year's maximum account values, the $10,000 test, and the filing worksheet",
    icon: FileSpreadsheet,
  },

  // Investments (CR090). Its own top-level section, sitting BELOW Reports in the
  // sidebar (owner, 2026-09-03). Two pages: the summary, and the per-account
  // register.
  //
  // Registered by `category` rather than hand-wired into the sidebar, so it
  // appears in BOTH nav shells — the CR026 navLayout flag defaults to `legacy`
  // on prod, and a sidebar-only entry would be invisible there.
  {
    path: "/investments",
    component: Investments,
    label: "Investment Summary",
    category: "Investments",
    description: "Every account's balance, positions and reconciliation, in one table",
    icon: PieChart,
  },
  {
    // CR093 P1 — exposure, not holdings. Sits between the summary and the
    // per-account register because it answers the question they cannot: what the
    // portfolio is exposed to once funds are seen through.
    path: "/investments/exposure",
    component: InvestmentExposure,
    label: "Investment Exposure",
    category: "Investments",
    description:
      "What the portfolio is exposed to, with funds seen through to their underlying sectors",
    icon: PieChart,
  },
  {
    // A nav entry needs a STATIC path, so this one opens the first account; the
    // `:accountId` variant below is what the summary links to and what the tab
    // strip navigates between.
    path: "/investments/positions",
    component: InvestmentAccount,
    label: "Investment Positions",
    category: "Investments",
    description:
      "Every position one account holds, reconciled to the balance the custodian reports",
    icon: Layers,
  },
  {
    // Deep-linkable per account, and out of the nav: five near-identical entries
    // would say nothing the tab strip on the page does not.
    path: "/investments/positions/:accountId",
    component: InvestmentAccount,
    label: "Investment Positions",
    category: "Investments",
    showInNav: false,
    icon: Layers,
  },
];

/**
 * Converts a category name to a URL-safe path.
 */
export function getCategoryPath(categoryName) {
  return (
    "/" +
    categoryName
      .toLowerCase()
      .replace(/\s+&\s+/g, "-")
      .replace(/\s+/g, "-")
  );
}

/**
 * Returns routes for a given category name.
 */
export function getRoutesByCategory(categoryName) {
  // Nav-facing: hidden routes (showInNav: false) stay reachable by URL but
  // never appear in menus, landing pages, or the Home features grid.
  return routes.filter(
    (r) => r.category === categoryName && r.showInNav !== false
  );
}

/**
 * Generates category landing page route objects.
 */
export function getCategoryRoutes() {
  const seen = new Set();
  const result = [];

  for (const route of routes) {
    if (route.category && !seen.has(route.category)) {
      seen.add(route.category);
      result.push({
        path: getCategoryPath(route.category),
        category: route.category,
        label: route.category,
      });
    }
  }

  return result;
}

/**
 * Finds the category name for a given URL path (landing page path).
 */
export function getCategoryByPath(urlPath) {
  const catRoutes = getCategoryRoutes();
  const match = catRoutes.find((c) => c.path === urlPath);
  return match?.category || null;
}

/**
 * Gets all unique category names in order.
 */
export function getCategories() {
  const seen = new Set();
  const result = [];
  for (const route of routes) {
    if (route.category && !seen.has(route.category)) {
      seen.add(route.category);
      result.push(route.category);
    }
  }
  return result;
}

/**
 * Get all routes that should be rendered in the router.
 */
export function getRouterRoutes() {
  return routes.filter((route) => route.component !== null);
}

/* ------------------------------------------------------------------ *
 * CR026 — Sidebar information architecture (additive).
 *
 * The sidebar groups are derived from the existing per-route `category`
 * so we don't have to re-tag every route. This is purely additive: the
 * legacy top-nav (`getCategories`) and category landing pages keep working
 * unchanged. Order + labels here reflect CR026 §5 (workflow-oriented IA,
 * with Data Sources demoted below a divider).
 * ------------------------------------------------------------------ */
export const SIDEBAR_GROUPS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, path: "/", single: true },
  { key: "accounts", label: "Accounts & Transactions", icon: Receipt, category: "Transactions" },
  { key: "budget", label: "Budget", icon: Calculator, category: "Budgeting" },
  { key: "forecast", label: "Forecast", icon: TrendingUp, category: "Forecasting" },
  { key: "reports", label: "Reports", icon: BarChart3, category: "Reports & Graphs" },
  { key: "investments", label: "Investments", icon: PieChart, category: "Investments" },
  { divider: true, key: "div-admin" },
  { key: "data", label: "Data Sources", icon: HardDrive, category: "Database" },
  { key: "settings", label: "Settings", icon: Settings2, category: "Settings" },
  { key: "taxes", label: "Taxes", icon: Landmark, category: "Taxes" },
];

/**
 * Resolve the sidebar groups to their child routes (CR026).
 * Single groups (e.g. Overview) link directly via `path`; category groups
 * expand to their in-nav routes.
 */
export function getSidebarNav() {
  return SIDEBAR_GROUPS.map((group) => {
    if (group.divider || group.single) return group;
    const items = getRoutesByCategory(group.category).filter(
      (r) => r.showInNav !== false
    );
    return { ...group, items };
  });
}

export default routes;
