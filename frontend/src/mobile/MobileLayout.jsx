import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import MobileTabBar, { MOBILE_TABS } from "./MobileTabBar";
import "./mobile.css";

// Titles for non-tab mobile pages (reached via the home launcher).
const EXTRA_TITLES = { "/m/balance-trends": "Balance Trends" };

function getPageTitle(pathname) {
  if (EXTRA_TITLES[pathname]) return EXTRA_TITLES[pathname];
  // Longest-prefix match so e.g. /m/balance resolves to "Balance", not the
  // shorter "/m" Overview tab (which would otherwise match every /m/* path).
  const tab = MOBILE_TABS.filter((t) => pathname.startsWith(t.to)).sort(
    (a, b) => b.to.length - a.to.length
  )[0];
  return tab ? tab.label : null;
}

export default function MobileLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === "/m" || location.pathname === "/m/";
  const title = getPageTitle(location.pathname);

  return (
    <div className="m-shell">
      <header className="m-topbar">
        {isHome ? (
          <Link to="/m" className="m-topbar__brand">
            FI
          </Link>
        ) : (
          <button
            type="button"
            className="m-topbar__back"
            aria-label="Back to home"
            onClick={() => navigate("/m")}
          >
            <ChevronLeft size={26} />
          </button>
        )}
        <h1 className="m-topbar__title">{isHome ? "Home" : title || ""}</h1>
      </header>
      <main className="m-content" key={location.pathname}>
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
