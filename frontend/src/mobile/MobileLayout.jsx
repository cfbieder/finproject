import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import MobileTabBar, { MOBILE_TABS } from "./MobileTabBar";
import "./mobile.css";

function getPageTitle(pathname) {
  const tab = MOBILE_TABS.find((t) => pathname.startsWith(t.to));
  if (tab) return tab.label;
  return null;
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
