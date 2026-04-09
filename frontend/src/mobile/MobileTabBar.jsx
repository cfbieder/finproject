import { NavLink } from "react-router-dom";
import { Wallet, ArrowLeftRight, RefreshCw, Target, BarChart3 } from "lucide-react";

export const MOBILE_TABS = [
  { to: "/m/balance", label: "Balance", icon: Wallet },
  { to: "/m/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { to: "/m/refresh-ps", label: "Refresh", icon: RefreshCw },
  { to: "/m/budget-realization", label: "Budget", icon: Target },
  { to: "/m/budget-graph", label: "Graph", icon: BarChart3 },
];

export default function MobileTabBar() {
  return (
    <nav className="m-tabbar" aria-label="Mobile navigation">
      {MOBILE_TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
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
