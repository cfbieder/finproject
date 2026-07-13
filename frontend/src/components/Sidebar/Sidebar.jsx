/**
 * Sidebar — CR026 P1 collapsible left navigation (replaces the top NavigationMenu
 * when VITE_NAV_LAYOUT / localStorage navLayout === "sidebar").
 *
 * Hand-rolled (no UI lib, per CR026 §11.3). Driven by getSidebarNav() so it stays
 * in sync with the route config. Uses the global index.css design tokens (not the
 * preview's local --u-* tokens), so the planned P2 dark mode themes it for free.
 *
 * Behaviour:
 *  - Two states: expanded (label + icon) and rail (icon-only, hover tooltips).
 *    Persisted to localStorage("sidebarCollapsed").
 *  - Accordion groups; clicking a group header toggles disclosure only. The
 *    active route (and its parent group) highlight from the current URL.
 *  - The group containing the current route auto-expands on load / navigation.
 */
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  getSidebarNav,
  getCategoryPath,
  getRoutesByCategory,
} from "../../config/routes";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Contrast } from "lucide-react";
import useTheme from "../../hooks/useTheme";
import banner from "../../assets/banner.png";
import "./Sidebar.css";

const isDev = import.meta.env.DEV || import.meta.env.VITE_APP_MODE === "dev";
const version = import.meta.env.VITE_APP_VERSION || "2.0.0";

/** Which group owns the current pathname (for active highlight + auto-expand). */
function groupKeyForPath(nav, pathname) {
  for (const group of nav) {
    if (group.divider) continue;
    if (group.single && group.path === pathname) return group.key;
    if (group.category) {
      if (getCategoryPath(group.category) === pathname) return group.key;
      const inGroup = getRoutesByCategory(group.category).some(
        // Prefix match so tabbed pages (/balances/summary) keep their parent
        // (/balances) group active + auto-expanded.
        (r) => r.path === pathname || pathname.startsWith(r.path + "/")
      );
      if (inGroup) return group.key;
    }
  }
  return null;
}

export default function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const nav = getSidebarNav();
  const activeGroup = groupKeyForPath(nav, pathname);

  const { theme, toggle: toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebarCollapsed") === "true"
  );
  const [openGroup, setOpenGroup] = useState(activeGroup);

  // Keep the active group disclosed as the user navigates.
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sidebarCollapsed", String(next));
      return next;
    });
  };

  return (
    <aside className={`sidebar${collapsed ? " sidebar--rail" : ""}${isDev ? " sidebar--dev" : ""}`}>
      <Link className="sidebar__brand" to="/" title={collapsed ? "Fin — Home" : undefined}>
        <span className="sidebar__brand-mark">
          <img src={banner} alt="Fin" />
        </span>
        {!collapsed && (
          <span className="sidebar__brand-meta">
            <span className="sidebar__brand-name">Fin</span>
            <span className="sidebar__brand-ver">
              v{version}
              {isDev ? " DEV" : ""}
            </span>
          </span>
        )}
      </Link>

      <nav className="sidebar__nav" aria-label="Primary">
        {nav.map((group) => {
          if (group.divider) {
            return <div key={group.key} className="sidebar__divider" aria-hidden="true" />;
          }

          const Icon = group.icon;

          // Single-link group (Overview).
          if (group.single) {
            return (
              <NavLink
                key={group.key}
                to={group.path}
                end
                className={({ isActive }) =>
                  `sidebar__item${isActive ? " sidebar__item--active" : ""}`
                }
                title={collapsed ? group.label : undefined}
              >
                <Icon size={18} className="sidebar__icon" />
                {!collapsed && <span className="sidebar__label">{group.label}</span>}
              </NavLink>
            );
          }

          // Accordion group.
          const isOpen = openGroup === group.key && !collapsed;
          const groupActive = activeGroup === group.key;
          return (
            <div key={group.key} className="sidebar__group">
              <button
                type="button"
                className={`sidebar__item sidebar__item--group${isOpen ? " is-open" : ""}${groupActive ? " sidebar__item--active" : ""}`}
                onClick={() =>
                  // Collapsed (rail): clicking the icon jumps to the group's
                  // landing page (the flyout below handles sub-page nav on
                  // hover/focus). Expanded: toggle the accordion.
                  collapsed
                    ? navigate(getCategoryPath(group.category))
                    : setOpenGroup((g) => (g === group.key ? null : group.key))
                }
                title={collapsed ? group.label : undefined}
                aria-expanded={collapsed ? undefined : isOpen}
              >
                <Icon size={18} className="sidebar__icon" />
                {!collapsed && <span className="sidebar__label">{group.label}</span>}
                {!collapsed && (
                  <ChevronDown
                    size={15}
                    className={`sidebar__chev${isOpen ? " is-open" : ""}`}
                  />
                )}
              </button>

              {!collapsed && isOpen && (
                <div className="sidebar__children">
                  {group.items.map((route) => {
                    const ItemIcon = route.icon;
                    return (
                      <NavLink
                        key={route.path}
                        to={route.path}
                        className={({ isActive }) =>
                          `sidebar__child${isActive ? " sidebar__child--active" : ""}`
                        }
                      >
                        {ItemIcon && <ItemIcon size={15} className="sidebar__icon" />}
                        <span>
                          {/* Forecast is a numbered workflow; the sidebar shows the same
                              step numbers as the in-page FCStepNav so the two lists agree. */}
                          {route.step ? `${route.step}. ` : ""}
                          {route.label}
                        </span>
                      </NavLink>
                    );
                  })}
                </div>
              )}

              {/* Rail flyout — always rendered; CSS shows it only in rail
                  contexts (manual collapse OR the ≤900px auto-rail) on
                  hover/focus, so collapsed groups stay navigable. */}
              <div className="sidebar__flyout" role="menu" aria-label={group.label}>
                <div className="sidebar__flyout-title">{group.label}</div>
                {group.items.map((route) => {
                  const ItemIcon = route.icon;
                  return (
                    <NavLink
                      key={route.path}
                      to={route.path}
                      role="menuitem"
                      className={({ isActive }) =>
                        `sidebar__flyout-item${isActive ? " sidebar__flyout-item--active" : ""}`
                      }
                    >
                      {ItemIcon && <ItemIcon size={15} className="sidebar__icon" />}
                      <span>
                        {route.step ? `${route.step}. ` : ""}
                        {route.label}
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__railtoggle"
          onClick={toggleTheme}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <Contrast size={16} />
          {!collapsed && <span>Theme</span>}
        </button>
        <button
          type="button"
          className="sidebar__railtoggle"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
