import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { getRouterRoutes, getCategoryRoutes } from "./config/routes";
import Layout from "./components/Layout";
import LoadingSpinner from "./components/LoadingSpinner";

const CategoryLandingPage = lazy(() => import("./pages/CategoryLandingPage"));

function App() {
  const routes = getRouterRoutes();
  const categoryRoutes = getCategoryRoutes();

  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

export default App;
