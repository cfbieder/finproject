import { Link } from "react-router-dom";
import { Wallet, ArrowLeftRight, RefreshCw, Target, BarChart3 } from "lucide-react";
import { setForceDesktop } from "./useIsMobile";

const CARDS = [
  { to: "/m/balance", label: "Balance Summary", icon: Wallet },
  { to: "/m/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { to: "/m/refresh-ps", label: "Refresh PS", icon: RefreshCw },
  { to: "/m/budget-realization", label: "Budget Realization", icon: Target },
  { to: "/m/budget-graph", label: "Budget Graph", icon: BarChart3 },
];

export default function MobileHome() {
  const handleSwitchToDesktop = () => {
    setForceDesktop(true);
    window.location.href = "/";
  };

  return (
    <div>
      <div className="m-launcher">
        {CARDS.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="m-launcher__card">
            <span className="m-launcher__icon">
              <Icon size={24} strokeWidth={2} />
            </span>
            <span className="m-launcher__label">{label}</span>
          </Link>
        ))}
      </div>
      <div className="m-foot">
        <button
          type="button"
          className="m-foot__link"
          onClick={handleSwitchToDesktop}
        >
          Switch to desktop view
        </button>
      </div>
    </div>
  );
}
