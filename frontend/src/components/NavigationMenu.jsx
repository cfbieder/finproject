import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getCategories, getCategoryPath, routes } from "../config/routes";
import { Menu, X, Download } from "lucide-react";
import useInstallPrompt from "../hooks/useInstallPrompt";
import banner from "../assets/banner.png";
import "./NavigationMenu.css";

const isDev = import.meta.env.DEV || import.meta.env.VITE_APP_MODE === 'dev';

export default function NavigationMenu() {
  const { pathname } = useLocation();
  const categories = getCategories();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { canInstall, install } = useInstallPrompt();

  // Determine which category is active based on current path
  const currentRoute = routes.find((r) => r.path === pathname);
  const activeCategory = currentRoute?.category || null;

  // Also check if we're on a category landing page
  const activeCatFromLanding = categories.find(
    (cat) => getCategoryPath(cat) === pathname
  );

  const isActive = (cat) =>
    cat === activeCategory || cat === activeCatFromLanding;

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className={`navbar${isDev ? ' navbar--dev' : ''}`}>
      <div className="navbar__inner">
        <div className="navbar__left">
          <Link className="navbar__brand" to="/" onClick={closeMobile}>
            <div className="navbar__brand-image">
              <img src={banner} alt="Fin" />
            </div>
            <span className="navbar__title">Fin</span>
            <span className="navbar__version-badge">v{import.meta.env.VITE_APP_VERSION || '2.0.0'}{isDev ? ' DEV' : ''}</span>
          </Link>

          {canInstall && (
            <button
              type="button"
              className="navbar__install-btn"
              onClick={install}
              aria-label="Install app"
            >
              <Download size={16} />
              <span className="navbar__install-label">Install</span>
            </button>
          )}

          <button
            type="button"
            className="navbar__hamburger"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <nav
            className={`navbar__links${mobileOpen ? " navbar__links--open" : ""}`}
          >
            <Link
              className={`navlink${pathname === "/" ? " navlink--active" : ""}`}
              to="/"
              onClick={closeMobile}
            >
              Home
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                className={`navlink${isActive(cat) ? " navlink--active" : ""}`}
                to={getCategoryPath(cat)}
                onClick={closeMobile}
              >
                {cat}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="navbar__overlay"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}
    </header>
  );
}
