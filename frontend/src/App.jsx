import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { getRouterRoutes, getCategoryRoutes } from "./config/routes";
import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";
import ErrorBoundary from "./components/ErrorBoundary";
import useIsMobile from "./mobile/useIsMobile";
import MobileLayout from "./mobile/MobileLayout";
import MobileHome from "./mobile/MobileHome";

const CategoryLandingPage = lazy(() => import("./pages/CategoryLandingPage"));
const MobileBalance = lazy(() => import("./mobile/pages/MobileBalance"));
const MobileCashFlow = lazy(() => import("./mobile/pages/MobileCashFlow"));
const MobileBudgetRealization = lazy(() =>
  import("./mobile/pages/MobileBudgetRealization")
);
const MobileBudgetGraph = lazy(() => import("./mobile/pages/MobileBudgetGraph"));
const MobileBalanceTrends = lazy(() => import("./mobile/pages/MobileBalanceTrends"));
const MobileLedger = lazy(() => import("./mobile/pages/MobileLedger"));
const MobileRefreshFeeds = lazy(() => import("./mobile/pages/MobileRefreshFeeds"));
const MobileReconcile = lazy(() => import("./mobile/pages/MobileReconcile"));

// Maps desktop URLs to their mobile equivalents (and vice-versa) so that
// a user landing on /balance on a phone is redirected to /m/balance and
// a user pasting /m/balance into a desktop browser is redirected back.
const DESKTOP_TO_MOBILE = {
  "/": "/m",
  "/balance": "/m/balance",
  "/cash-flow": "/m/cash-flow",
  "/budget-realization": "/m/budget-realization",
  "/budget-graph": "/m/budget-graph",
  "/balance-trends": "/m/balance-trends",
  "/ledger": "/m/ledger",
  "/refresh-feeds": "/m/refresh-feeds",
  "/balance-calibration": "/m/reconcile",
};

const MOBILE_TO_DESKTOP = Object.fromEntries(
  Object.entries(DESKTOP_TO_MOBILE).map(([d, m]) => [m, d])
);

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isMobilePath = location.pathname === "/m" || location.pathname.startsWith("/m/");

  useEffect(() => {
    if (isMobile && !isMobilePath) {
      const target = DESKTOP_TO_MOBILE[location.pathname] ?? "/m";
      navigate(target, { replace: true });
    } else if (!isMobile && isMobilePath) {
      const target = MOBILE_TO_DESKTOP[location.pathname] ?? "/";
      navigate(target, { replace: true });
    }
  }, [isMobile, isMobilePath, location.pathname, navigate]);

  if (isMobilePath) {
    return (
      <MobileLayout>
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<LoadingSpinner size="lg" label="Loading..." />}>
            <Routes>
            <Route path="/m" element={<MobileHome />} />
            <Route path="/m/balance" element={<MobileBalance />} />
            <Route path="/m/cash-flow" element={<MobileCashFlow />} />
            <Route
              path="/m/budget-realization"
              element={<MobileBudgetRealization />}
            />
            <Route path="/m/budget-graph" element={<MobileBudgetGraph />} />
            <Route path="/m/balance-trends" element={<MobileBalanceTrends />} />
            <Route path="/m/ledger" element={<MobileLedger />} />
              <Route path="/m/refresh-feeds" element={<MobileRefreshFeeds />} />
              <Route path="/m/reconcile" element={<MobileReconcile />} />
          </Routes>
          </Suspense>
        </ErrorBoundary>
      </MobileLayout>
    );
  }

  const routes = getRouterRoutes();
  const categoryRoutes = getCategoryRoutes();

  return (
    <Layout>
      <ErrorBoundary key={location.pathname}>
        <Suspense fallback={<LoadingSpinner size="lg" label="Loading page..." />}>
        <Routes>
          {routes.map((route) => {
            const Component = route.component;
            const Wrapper = route.wrapper;

            const element = Wrapper ? (
              <Wrapper>
                <Component />
              </Wrapper>
            ) : (
              <Component />
            );

            return (
              <Route key={route.path} path={route.path} element={element} />
            );
          })}
          {categoryRoutes.map((cat) => (
            <Route
              key={cat.path}
              path={cat.path}
              element={<CategoryLandingPage />}
            />
          ))}
          {/* Legacy URL — the page was renamed once it became feeds-only */}
          <Route
            path="/refresh-ps"
            element={<Navigate to="/refresh-feeds" replace />}
          />
          {/* CR042 U5 — the four balance pages merged into /balances tabs */}
          <Route path="/balance" element={<Navigate to="/balances/summary" replace />} />
          <Route
            path="/balance-sheet-periods"
            element={<Navigate to="/balances/periods" replace />}
          />
          <Route
            path="/balance-trends"
            element={<Navigate to="/balances/trends" replace />}
          />
          <Route
            path="/balance-chart"
            element={<Navigate to="/balances/chart" replace />}
          />
        </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
