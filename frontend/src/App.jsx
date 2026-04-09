import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { getRouterRoutes, getCategoryRoutes } from "./config/routes";
import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";
import useIsMobile from "./mobile/useIsMobile";
import MobileLayout from "./mobile/MobileLayout";
import MobileHome from "./mobile/MobileHome";

const CategoryLandingPage = lazy(() => import("./pages/CategoryLandingPage"));
const MobileBalance = lazy(() => import("./mobile/pages/MobileBalance"));
const MobileCashFlow = lazy(() => import("./mobile/pages/MobileCashFlow"));
const MobileRefreshPS = lazy(() => import("./mobile/pages/MobileRefreshPS"));
const MobileBudgetRealization = lazy(() =>
  import("./mobile/pages/MobileBudgetRealization")
);
const MobileBudgetGraph = lazy(() => import("./mobile/pages/MobileBudgetGraph"));

// Maps desktop URLs to their mobile equivalents (and vice-versa) so that
// a user landing on /balance on a phone is redirected to /m/balance and
// a user pasting /m/balance into a desktop browser is redirected back.
const DESKTOP_TO_MOBILE = {
  "/": "/m",
  "/balance": "/m/balance",
  "/cash-flow": "/m/cash-flow",
  "/refresh-ps": "/m/refresh-ps",
  "/budget-realization": "/m/budget-realization",
  "/budget-graph": "/m/budget-graph",
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
        <Suspense fallback={<LoadingSpinner size="lg" label="Loading..." />}>
          <Routes>
            <Route path="/m" element={<MobileHome />} />
            <Route path="/m/balance" element={<MobileBalance />} />
            <Route path="/m/cash-flow" element={<MobileCashFlow />} />
            <Route path="/m/refresh-ps" element={<MobileRefreshPS />} />
            <Route
              path="/m/budget-realization"
              element={<MobileBudgetRealization />}
            />
            <Route path="/m/budget-graph" element={<MobileBudgetGraph />} />
          </Routes>
        </Suspense>
      </MobileLayout>
    );
  }

  const routes = getRouterRoutes();
  const categoryRoutes = getCategoryRoutes();

  return (
    <Layout>
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
        </Routes>
      </Suspense>
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
