import { Link } from "react-router-dom";
import banner from "../assets/banner.png";
import "./NavigationMenu.css";

const menuItems = [
  {
    label: "Database",
    submenu: [
      { label: "Upload PS", path: "/upload-ps" },
      { label: "Refresh PS", path: "/refresh-ps" },
    ],
  },
  {
    label: "Budgeting",
    submenu: [
      { label: "Budget Worksheet", path: "/budget-worksheet" },
      { label: "Budget Options", path: "/budget-options" },
    ],
  },
  {
    label: "Reports",
    submenu: [
      { label: "Balance Summary", path: "/balance" },
      { label: "Cash Flow Summary", path: "/cash-flow" },
      { label: "Cash Flow Monthly", path: "/cash-flow-monthly" },
      { label: "Budget Realization", path: "/budget-realization" },
    ],
  },
  {
    label: "Analytics",
    submenu: [
      { label: "Net Worth Chart", path: "/balance-chart" },
      { label: "Option Analysis", path: "/option-analysis" },
    ],
  },
  {
    label: "Transactions",
    submenu: [
      { label: "History", path: "/history" },
      { label: "Budget", path: "/trans-budget" },
    ],
  },
  { label: "Settings" },
  { label: "Help" },
];

export default function NavigationMenu() {
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
                    {item.submenu.map((subItem) => (
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
                    ))}
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
