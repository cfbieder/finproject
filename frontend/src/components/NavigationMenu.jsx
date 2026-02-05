import { Link } from "react-router-dom";
import { generateMenuItems } from "../config/routes";
import banner from "../assets/banner.png";
import "./NavigationMenu.css";

/**
 * Navigation Menu Component
 *
 * Automatically generates navigation menu from routes configuration.
 * Supports nested dropdowns for hierarchical menu structure.
 */
export default function NavigationMenu() {
  const menuItems = generateMenuItems();
  const preventDropdownClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const navLinksClassName = "navbar__links navbar__links--left";
  return (
    <header className="navbar">
      <div className="navbar__inner">
        <div className="navbar__left">
          <Link className="navbar__brand" to="/">
            <div className="navbar__brand-image">
              <img src={banner} alt="Fin" />
            </div>
            <span className="navbar__title">Fin</span>
            <span className="navbar__version-badge">v2</span>
          </Link>
          <nav className={navLinksClassName}>
            <Link className="navlink" to="/">
              Home
            </Link>
            {menuItems.map((item) =>
              item.submenu ? (
                <div key={item.label} className="dropdown">
                  <button
                    type="button"
                    className="navlink navlink--dropdown"
                    onMouseDown={preventDropdownClick}
                  >
                    <span>{item.label}</span>
                    <span aria-hidden>▾</span>
                  </button>
                  <div className="dropdown__menu">
                    {item.submenu.map((subItem) =>
                      subItem.submenu ? (
                        <div key={subItem.label} className="dropdown__submenu">
                          <span className="dropdown__submenu-title">
                            {subItem.label}
                          </span>
                          {subItem.submenu.map((nestedItem) => (
                            <Link
                              key={nestedItem.label}
                              className="dropdown__link"
                              to={nestedItem.path}
                            >
                              {nestedItem.label}
                              <span className="dropdown__arrow" aria-hidden>
                                ↗
                              </span>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <Link
                          key={subItem.label}
                          className="dropdown__link"
                          to={subItem.path}
                        >
                          {subItem.label}
                          <span className="dropdown__arrow" aria-hidden>
                            ↗
                          </span>
                        </Link>
                      )
                    )}
                  </div>
                </div>
              ) : item.path ? (
                <Link key={item.label} className="navlink" to={item.path}>
                  {item.label}
                </Link>
              ) : (
                <span key={item.label} className="navlink navlink--static">
                  {item.label}
                </span>
              )
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
