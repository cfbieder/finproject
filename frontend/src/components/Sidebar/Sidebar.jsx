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
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  getSidebarNav,
  getCategoryPath,
  getRoutesByCategory,
} from "../../config/routes";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
        (r) => r.path === pathname
      );
      if (inGroup) return group.key;
    }
  }
  return null;
}

export default function Sidebar() {
  const { pathname } = useLocation();
  const nav = getSidebarNav();
  const activeGroup = groupKeyForPath(nav, pathname);

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
                  setOpenGroup((g) => (g === group.key ? null : group.key))
                }
                title={collapsed ? group.label : undefined}
                aria-expanded={isOpen}
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

              {isOpen && (
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
                        <span>{route.label}</span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__footer">
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
