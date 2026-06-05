import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import NavigationMenu from "./NavigationMenu";
import Breadcrumbs from "./Breadcrumbs";
import Sidebar from "./Sidebar/Sidebar";
import TopStrip from "./TopStrip";
import CommandPalette from "./CommandPalette/CommandPalette";
import HelpPanel from "./HelpPanel/HelpPanel";
import Footer from "./Footer";
import "./Layout.css";
import "./DataTable.css";
import "./buttons.css";

/**
 * CR026 navigation layout flag. Defaults to the legacy top bar so prod is
 * unaffected. Opt in per-browser with `localStorage.navLayout = "sidebar"`
 * (then reload), or globally via the VITE_NAV_LAYOUT build env.
 */
const navLayout =
  (typeof localStorage !== "undefined" && localStorage.getItem("navLayout")) ||
  import.meta.env.VITE_NAV_LAYOUT ||
  "legacy";
const useSidebar = navLayout === "sidebar";

/** CR026 P1+P3 — sidebar shell with the ⌘K palette + help drawer. */
function SidebarLayout({ children }) {
  const { pathname } = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Global ⌘K / Ctrl-K toggles the command palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-layout app-layout--sidebar">
      <Sidebar />
      <div className="app-main">
        <TopStrip
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
        />
        <div className="page-content-area" key={pathname}>
          <div className="page-shell">{children}</div>
        </div>
        <Footer />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

/** Legacy top-bar shell (unchanged). */
function LegacyLayout({ children }) {
  const { pathname } = useLocation();
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

export default function Layout({ children }) {
  return useSidebar ? (
    <SidebarLayout>{children}</SidebarLayout>
  ) : (
    <LegacyLayout>{children}</LegacyLayout>
  );
}
