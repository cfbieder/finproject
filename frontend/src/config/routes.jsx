/**
 * Unified Routes Configuration
 *
 * Single source of truth for all application routes.
 * Used to generate both the router and navigation menu.
 */

import { lazy } from 'react';
import { ForecastProvider } from '../contexts';

// Eagerly loaded pages (for fast initial render)
import Home from '../pages/Home';

// Lazy loaded pages (for code splitting)
const Balance = lazy(() => import('../pages/Balance'));
const BalanceChart = lazy(() => import('../pages/BalanceChart'));
const BudgetInput = lazy(() => import('../pages/BudgetInput'));
const BudgetRealization = lazy(() => import('../pages/BudgetRealization'));
const CashFlow = lazy(() => import('../pages/CashFlow'));
const CashFlowMonthly = lazy(() => import('../pages/CashFlowMonthly'));
const FCExpSetup = lazy(() => import('../pages/FCExpSetup'));
const FCModuleManage = lazy(() => import('../pages/FCModuleManage'));
const FCReview = lazy(() => import('../pages/FCReview'));
const FCScenarios = lazy(() => import('../pages/FCScenarios'));
const FXOptions = lazy(() => import('../pages/FXOptions'));
const RefreshPS = lazy(() => import('../pages/RefreshPS'));
const TransActual = lazy(() => import('../pages/TransActual'));
const TransBudget = lazy(() => import('../pages/TransBudget'));
const UploadPS = lazy(() => import('../pages/UploadPS'));
const COAManagement = lazy(() => import('../pages/COAManagement'));

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
 * - exact: Exact path matching (default: true)
 */
export const routes = [
  // Home
  {
    path: '/',
    component: Home,
    label: 'Home',
    showInNav: true,
    category: null, // Shows at root level in nav
  },

  // Database
  {
    path: '/upload-ps',
    component: UploadPS,
    label: 'Upload PS',
    category: 'Database',
  },
  {
    path: '/refresh-ps',
    component: RefreshPS,
    label: 'Refresh PS',
    category: 'Database',
  },

  // Budgeting
  {
    path: '/budget-worksheet',
    component: BudgetInput,
    label: 'Budget Worksheet',
    category: 'Budgeting',
  },
  {
    path: '/budget-realization',
    component: BudgetRealization,
    label: 'Budget Realization',
    category: 'Budgeting',
  },

  // Forecasting (wrapped in ForecastProvider)
  {
    path: '/forecast-scenarios',
    component: FCScenarios,
    label: 'Forecast Scenarios',
    category: 'Forecasting',
    wrapper: ForecastProvider,
  },
  {
    path: '/forecast-modules',
    component: FCModuleManage,
    label: 'Forecast Modules',
    category: 'Forecasting',
    wrapper: ForecastProvider,
  },
  {
    path: '/forecast-setup-exp',
    component: FCExpSetup,
    label: 'Forecast Expenditures Setup',
    category: 'Forecasting',
    wrapper: ForecastProvider,
  },
  {
    path: '/forecast-review',
    component: FCReview,
    label: 'Forecast Review',
    category: 'Forecasting',
    wrapper: ForecastProvider,
  },

  // Reports & Graphs > Reports
  {
    path: '/balance',
    component: Balance,
    label: 'Balance Summary',
    category: 'Reports & Graphs',
    subcategory: 'Reports',
  },
  {
    path: '/cash-flow',
    component: CashFlow,
    label: 'Cash Flow Summary',
    category: 'Reports & Graphs',
    subcategory: 'Reports',
  },
  {
    path: '/cash-flow-monthly',
    component: CashFlowMonthly,
    label: 'Cash Flow Monthly',
    category: 'Reports & Graphs',
    subcategory: 'Reports',
  },

  // Reports & Graphs > Graphs
  {
    path: '/balance-chart',
    component: BalanceChart,
    label: 'Net Worth Chart',
    category: 'Reports & Graphs',
    subcategory: 'Graphs',
  },

  // Analytics
  {
    path: '/option-analysis',
    component: null, // Not implemented yet
    label: 'Option Analysis',
    category: 'Analytics',
    showInNav: true,
  },

  // Transactions
  {
    path: '/trans-actual',
    component: TransActual,
    label: 'History',
    category: 'Transactions',
  },
  {
    path: '/trans-budget',
    component: TransBudget,
    label: 'Budget',
    category: 'Transactions',
  },

  // Settings
  {
    path: '/fx-options',
    component: FXOptions,
    label: 'FX Options',
    category: 'Settings',
  },
  {
    path: '/coa-management',
    component: COAManagement,
    label: 'Chart of Account Management',
    category: 'Settings',
  },
];

/**
 * Generates navigation menu structure from routes configuration.
 *
 * @returns {Array} Hierarchical menu structure
 */
export function generateMenuItems() {
  const menuMap = new Map();

  // Group routes by category
  routes.forEach(route => {
    if (route.showInNav === false) return;

    // Home route (no category)
    if (!route.category) {
      return; // Home is handled separately in navigation
    }

    // Get or create category
    if (!menuMap.has(route.category)) {
      menuMap.set(route.category, {
        label: route.category,
        submenu: [],
        subcategories: new Map(),
      });
    }

    const category = menuMap.get(route.category);

    // Handle subcategories
    if (route.subcategory) {
      if (!category.subcategories.has(route.subcategory)) {
        category.subcategories.set(route.subcategory, {
          label: route.subcategory,
          submenu: [],
        });
      }

      const subcategory = category.subcategories.get(route.subcategory);
      subcategory.submenu.push({
        label: route.label,
        path: route.path,
      });
    } else {
      // Direct category item
      category.submenu.push({
        label: route.label,
        path: route.path,
      });
    }
  });

  // Convert to array and flatten subcategories
  const menuItems = Array.from(menuMap.values()).map(category => {
    const submenu = [...category.submenu];

    // Add subcategories to submenu
    category.subcategories.forEach(subcategory => {
      submenu.push({
        label: subcategory.label,
        submenu: subcategory.submenu,
      });
    });

    return {
      label: category.label,
      submenu,
    };
  });

  // Add Help at the end
  menuItems.push({ label: 'Help' });

  return menuItems;
}

/**
 * Get all routes that should be rendered in the router.
 *
 * @returns {Array} Array of route objects
 */
export function getRouterRoutes() {
  return routes.filter(route => route.component !== null);
}

export default routes;
