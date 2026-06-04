import { useLocation } from "react-router-dom";
import NavigationMenu from "./NavigationMenu";
import Breadcrumbs from "./Breadcrumbs";
import Sidebar from "./Sidebar/Sidebar";
import TopStrip from "./TopStrip";
import Footer from "./Footer";
import "./Layout.css";
import "./DataTable.css";
import "./buttons.css";

/**
 * CR026 P1 — navigation layout flag. Defaults to the legacy top bar so prod is
 * unaffected. Opt in per-browser with `localStorage.navLayout = "sidebar"`
 * (then reload), or globally via the VITE_NAV_LAYOUT build env.
 */
const navLayout =
  (typeof localStorage !== "undefined" && localStorage.getItem("navLayout")) ||
  import.meta.env.VITE_NAV_LAYOUT ||
  "legacy";
const useSidebar = navLayout === "sidebar";

export default function Layout({ children }) {
  const { pathname } = useLocation();

  if (useSidebar) {
    return (
      <div className="app-layout app-layout--sidebar">
        <Sidebar />
        <div className="app-main">
          <TopStrip />
          <div className="page-content-area" key={pathname}>
            <div className="page-shell">{children}</div>
          </div>
          <Footer />
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <NavigationMenu />
      <Breadcrumbs />
      <div className="page-content-area" key={pathname}>
        <div className="page-shell">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
