import { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { getRouterRoutes } from './config/routes';

/**
 * Loading fallback component for lazy-loaded routes.
 * Displays a simple loading message while the route component is being loaded.
 */
function RouteLoading() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontSize: '1.125rem',
      color: '#6b7280'
    }}>
      Loading...
    </div>
  );
}

/**
 * Main App Component
 *
 * Uses unified routes configuration for automatic route generation.
 * All routes are lazy-loaded (except Home) for optimal bundle splitting.
 * Routes can be wrapped with context providers as specified in config.
 */
function App() {
  const routes = getRouterRoutes();

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          {routes.map((route) => {
            const Component = route.component;
            const Wrapper = route.wrapper;

            // Create the element with optional wrapper
            const element = Wrapper ? (
              <Wrapper>
                <Component />
              </Wrapper>
            ) : (
              <Component />
            );

            return (
              <Route
                key={route.path}
                path={route.path}
                element={element}
              />
            );
          })}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
