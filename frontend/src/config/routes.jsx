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
  PieChart,
  LineChart,
  Target,
  PlusCircle,
  Calculator,
  Eye,
  ArrowLeftRight,
  ArrowUpDown,
  Wallet,
  Palette,
} from "lucide-react";

// Eagerly loaded pages (for fast initial render)
import Home from "../pages/Home";

// Lazy loaded pages (for code splitting)
const BackupDatabase = lazy(() => import("../pages/BackupDatabase"));
const QuickenImport = lazy(() => import("../pages/QuickenImport"));
const BankFeedDiagnostic = lazy(() => import("../pages/BankFeedDiagnostic"));
const Balance = lazy(() => import("../pages/BalanceV2"));
const BalanceChart = lazy(() => import("../pages/BalanceChart"));
const BalanceTrends = lazy(() => import("../pages/BalanceTrends"));
const BalanceSheetPeriods = lazy(() => import("../pages/BalanceSheetPeriods"));
const BudgetInput = lazy(() => import("../pages/BudgetWorksheetV2"));
const BudgetRealization = lazy(() => import("../pages/BudgetRealization"));
const BudgetRealizationGraph = lazy(() => import("../pages/BudgetRealizationGraph"));
const BudgetVariances = lazy(() => import("../pages/BudgetVariances"));
const CashFlow = lazy(() => import("../pages/CashFlow"));
const CashFlowPeriods = lazy(() => import("../pages/CashFlowPeriods"));
const FCExpSetup = lazy(() => import("../pages/FCExpSetup"));
const FCLineMapping = lazy(() => import("../pages/FCLineMapping"));
const FCModuleManage = lazy(() => import("../pages/FCModuleManage"));
const FCReview = lazy(() => import("../pages/FCReview"));
const FCCompare = lazy(() => import("../pages/FCCompare"));
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
    path: "/budget-realization",
    component: BudgetRealization,
    label: "Budget Realization",
    category: "Budgeting",
    description: "Compare budget vs actual performance",
    icon: Target,
  },
  {
    path: "/budget-graph",
    component: BudgetRealizationGraph,
    label: "Budget Graph",
    category: "Budgeting",
    description: "Visual budget analysis and variance charts",
    icon: BarChart3,
  },
  {
    path: "/budget-variances",
    component: BudgetVariances,
    label: "Budget Variances",
    category: "Budgeting",
    description: "Line items ranked by largest budget-to-actual variance",
    icon: ArrowUpDown,
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
    component: FCLineMapping,
    label: "FC Inc/Exp Mapping",
    category: "Forecasting",
    description: "Map budget categories to forecast income and expense lines",
    icon: ArrowLeftRight,
  },
  {
    path: "/forecast-scenarios",
    component: FCScenarios,
    label: "Forecast Scenarios",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Create and manage forecast scenarios with assumptions",
    icon: Layers,
  },
  {
    path: "/forecast-modules",
    component: FCModuleManage,
    label: "Forecast Modules",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Configure balance sheet forecast modules",
    icon: BookOpen,
  },
  {
    path: "/forecast-setup-exp",
    component: FCExpSetup,
    label: "Forecast Expenditures",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Set up income and expense forecast items",
    icon: DollarSign,
  },
  {
    path: "/forecast-review",
    component: FCReview,
    label: "Forecast Review",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Review and analyze generated forecasts",
    icon: Eye,
  },
  {
    path: "/forecast-compare",
    component: FCCompare,
    label: "Forecast Compare",
    category: "Forecasting",
    wrapper: ForecastProvider,
    description: "Compare two forecast scenarios: deltas, charts, and commentary",
    icon: ArrowLeftRight,
  },
  {
    path: "/fc-settings",
    component: FCSettings,
    label: "FC Settings",
    category: "Forecasting",
    description: "Birth year, module types, and FX rate assumptions",
    icon: DollarSign,
  },

  // Reports & Graphs > Reports
  {
    path: "/balance",
    component: Balance,
    label: "Balance Summary",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Balance sheet at specific dates with multi-period comparison",
    icon: Wallet,
  },
  {
    path: "/balance-trends",
    component: BalanceTrends,
    label: "Balance Trends",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Month-end USD balances of selected accounts over a period",
    icon: TrendingUp,
  },
  {
    path: "/cash-flow",
    component: CashFlow,
    label: "Cash Flow Summary",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Cash flow profit and loss analysis",
    icon: ArrowLeftRight,
  },
  {
    path: "/cash-flow-periods",
    component: CashFlowPeriods,
    label: "Cash Flow Periods",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Cash flow breakdown by month, quarter, or year",
    icon: PieChart,
  },
  {
    path: "/balance-sheet-periods",
    component: BalanceSheetPeriods,
    label: "Balance Sheet Periods",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Balance sheet as of each period end (month, quarter, or year)",
    icon: Wallet,
  },

  // Reports & Graphs > Graphs
  {
    path: "/balance-chart",
    component: BalanceChart,
    label: "Net Worth Chart",
    category: "Reports & Graphs",
    subcategory: "Graphs",
    description: "Visualize net worth and asset growth over time",
    icon: LineChart,
  },
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
    category: "Transactions",
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
  { divider: true, key: "div-admin" },
  { key: "data", label: "Data Sources", icon: HardDrive, category: "Database" },
  { key: "settings", label: "Settings", icon: Settings2, category: "Settings" },
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
