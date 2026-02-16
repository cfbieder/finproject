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
  Calculator,
  Eye,
  ArrowLeftRight,
  ArrowUpDown,
  Wallet,
} from "lucide-react";

// Eagerly loaded pages (for fast initial render)
import Home from "../pages/Home";

// Lazy loaded pages (for code splitting)
const BackupDatabase = lazy(() => import("../pages/BackupDatabase"));
const Balance = lazy(() => import("../pages/Balance"));
const BalanceChart = lazy(() => import("../pages/BalanceChart"));
const BudgetInput = lazy(() => import("../pages/BudgetInput"));
const BudgetRealization = lazy(() => import("../pages/BudgetRealization"));
const BudgetRealizationGraph = lazy(() => import("../pages/BudgetRealizationGraph"));
const BudgetVariances = lazy(() => import("../pages/BudgetVariances"));
const CashFlow = lazy(() => import("../pages/CashFlow"));
const CashFlowMonthly = lazy(() => import("../pages/CashFlowMonthly"));
const FCExpSetup = lazy(() => import("../pages/FCExpSetup"));
const FCModuleManage = lazy(() => import("../pages/FCModuleManage"));
const FCReview = lazy(() => import("../pages/FCReview"));
const FCScenarios = lazy(() => import("../pages/FCScenarios"));
const FXOptions = lazy(() => import("../pages/FXOptions"));
const RefreshPS = lazy(() => import("../pages/RefreshPS"));
const TransActual = lazy(() => import("../pages/TransActual"));
const TransBudget = lazy(() => import("../pages/TransBudget"));
const UploadPS = lazy(() => import("../pages/UploadPS"));
const COAManagement = lazy(() => import("../pages/COAManagement"));

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
    description: "Configure exchange rates, chart of accounts, and preferences",
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
    path: "/refresh-ps",
    component: RefreshPS,
    label: "Refresh PS",
    category: "Database",
    description: "Refresh and sync data from staging tables",
    icon: RefreshCw,
  },
  {
    path: "/backup-database",
    component: BackupDatabase,
    label: "Backup Database",
    category: "Database",
    description: "Create and manage database backups",
    icon: HardDrive,
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

  // Forecasting (wrapped in ForecastProvider)
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
    path: "/cash-flow",
    component: CashFlow,
    label: "Cash Flow Summary",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Cash flow profit and loss analysis",
    icon: ArrowLeftRight,
  },
  {
    path: "/cash-flow-monthly",
    component: CashFlowMonthly,
    label: "Cash Flow Monthly",
    category: "Reports & Graphs",
    subcategory: "Reports",
    description: "Monthly cash flow breakdown by category",
    icon: PieChart,
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

  // Transactions
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

  // Settings
  {
    path: "/fx-options",
    component: FXOptions,
    label: "FX Options",
    category: "Settings",
    description: "Configure foreign exchange rate settings",
    icon: DollarSign,
  },
  {
    path: "/coa-management",
    component: COAManagement,
    label: "Chart of Accounts",
    category: "Settings",
    description: "Manage account hierarchy, types, and categories",
    icon: BookOpen,
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
  return routes.filter((r) => r.category === categoryName);
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

export default routes;
