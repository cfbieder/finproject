import { Link, useLocation } from "react-router-dom";
import { routes, getCategoryPath } from "../config/routes";
import "./Breadcrumbs.css";

export default function Breadcrumbs() {
  const { pathname } = useLocation();

  // Don't show breadcrumbs on home page
  if (pathname === "/") return null;

  // Find current route in config
  const currentRoute = routes.find((r) => r.path === pathname);

  // Build breadcrumb chain
  const crumbs = [{ label: "Home", path: "/" }];

  if (currentRoute?.category) {
    const catPath = getCategoryPath(currentRoute.category);
    crumbs.push({ label: currentRoute.category, path: catPath });
  }

  if (currentRoute) {
    crumbs.push({ label: currentRoute.label, path: null });
  } else {
    // Category landing page or unknown route
    const pageTitle = pathname
      .slice(1)
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (pageTitle) {
      crumbs.push({ label: pageTitle, path: null });
    }
  }

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs__list">
        {crumbs.map((crumb, i) => (
          <li key={crumb.label} className="breadcrumbs__item">
            {crumb.path ? (
              <Link to={crumb.path} className="breadcrumbs__link">
                {crumb.label}
              </Link>
            ) : (
              <span className="breadcrumbs__current" aria-current="page">
                {crumb.label}
              </span>
            )}
            {i < crumbs.length - 1 && (
              <span className="breadcrumbs__separator" aria-hidden="true">
                /
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
