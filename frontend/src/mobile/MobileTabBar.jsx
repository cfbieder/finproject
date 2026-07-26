import { NavLink } from "react-router-dom";
import { LayoutDashboard, Wallet, ArrowLeftRight, Target, BarChart3 } from "lucide-react";

// Bottom tabs = the 5 highest-frequency destinations. Overview (the data home)
// leads; Refresh PS is periodic (not daily) so it lives on the home launcher,
// not as a permanent tab (CR026 §7.3).
export const MOBILE_TABS = [
  { to: "/m", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/m/balance", label: "Balance", icon: Wallet },
  { to: "/m/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { to: "/m/budget-realization", label: "Budget", icon: Target },
  { to: "/m/budget-graph", label: "Graph", icon: BarChart3 },
];

export default function MobileTabBar() {
  return (
    <nav className="m-tabbar" aria-label="Mobile navigation">
      {MOBILE_TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            "m-tabbar__item" + (isActive ? " m-tabbar__item--active" : "")
          }
        >
          <Icon strokeWidth={2} />
          <span className="m-tabbar__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
