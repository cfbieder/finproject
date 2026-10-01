import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { desktopRouteFor } from "./desktopPages";
// The desktop shell loads these; a desktop page rendered here relies on them.
// All three are scoped to their own class names, so they cannot restyle the
// mobile shell.
import "../components/Layout.css";
import "../components/DataTable.css";
import "../components/buttons.css";

/**
 * Any desktop page, inside the mobile shell — the rarely-used escape from the
 * phone's own pages (owner, 2026-10-01). Not `forceDesktop`: below 640px that
 * is deliberately ignored, because the desktop sidebar's hover-only rail cannot
 * be worked by a finger. Here the mobile top bar and tab bar stay, and only the
 * page body is the desktop one, scrolling sideways where it is wider than the
 * phone.
 */
export default function MobileDesktopPage() {
  const location = useLocation();
  const route = desktopRouteFor(location.pathname);
  if (!route) return <Navigate to="/m" replace />;

  const Component = route.component;
  const Wrapper = route.wrapper;
  // A nested route carrying the page's OWN pattern (relative to /m/d/*), so a
  // page that reads `useParams()` — `/budget-vs-actual/:view` — still gets them.
  return (
    <div className="m-desktop-page">
      <Routes>
        <Route
          path={route.path === "/" ? "" : route.path.slice(1)}
          element={Wrapper ? <Wrapper><Component /></Wrapper> : <Component />}
        />
      </Routes>
    </div>
  );
}
