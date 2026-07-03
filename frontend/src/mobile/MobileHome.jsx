import { Link } from "react-router-dom";
import {
  Wallet,
  ArrowLeftRight,
  Target,
  BarChart3,
  TrendingUp,
  TrendingDown,
  LineChart,
  BookOpen,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useOverview, formatOverviewKpi } from "../hooks/useOverview.js";
import { setForceDesktop, isCoarsePointer } from "./useIsMobile";

const CARDS = [
  { to: "/m/balance", label: "Balance Summary", icon: Wallet },
  { to: "/m/balance-trends", label: "Balance Trends", icon: LineChart },
  { to: "/m/ledger", label: "Ledger", icon: BookOpen },
  { to: "/m/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { to: "/m/budget-realization", label: "Budget Realization", icon: Target },
  { to: "/m/budget-graph", label: "Budget Graph", icon: BarChart3 },
  { to: "/m/refresh-feeds", label: "Refresh Feeds", icon: RefreshCw },
];

const formatKpi = formatOverviewKpi;

export default function MobileHome() {
  const { data, isLoading, failed } = useOverview();

  const handleSwitchToDesktop = () => {
    setForceDesktop(true);
    window.location.href = "/";
  };

  const up = (data?.delta ?? 0) >= 0;

  return (
    <div>
      {/* Live overview */}
      {isLoading && !data && (
        <div className="m-state">
          <Loader2 size={28} className="m-spin" />
          <span>Loading overview…</span>
        </div>
      )}

      {data && (
        <>
          <div className="m-kpis">
            <div className="m-kpi m-kpi--hero">
              <span className="m-kpi__label">Net Worth</span>
              <span
                className={
                  "m-kpi__value" +
                  (data.netWorth < 0 ? " m-kpi__value--negative" : "")
                }
              >
                {formatKpi(data.netWorth)}
              </span>
              <span className={"m-kpi__sub m-kpi__sub--" + (up ? "up" : "down")}>
                {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {formatKpi(Math.abs(data.delta))} vs last month
              </span>
            </div>
          </div>

          <h2 className="m-section-h">This Month</h2>
          <div className="m-kpis m-kpis--grid">
            <div className="m-kpi">
              <span className="m-kpi__label">Net Cash Flow</span>
              <span
                className={
                  "m-kpi__value" +
                  (data.net < 0
                    ? " m-kpi__value--negative"
                    : " m-kpi__value--positive")
                }
              >
                {formatKpi(data.net)}
              </span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Income</span>
              <span className="m-kpi__value m-kpi__value--positive">
                {formatKpi(data.income)}
              </span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Expenses</span>
              <span
                className={
                  "m-kpi__value" +
                  (data.expense < 0 ? " m-kpi__value--negative" : "")
                }
              >
                {formatKpi(data.expense)}
              </span>
            </div>
          </div>
        </>
      )}

      {failed && !data && (
        <div className="m-page-meta">
          <span className="m-pill">Overview data unavailable</span>
        </div>
      )}

      {/* Quick links */}
      <h2 className="m-section-h">Go to</h2>
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

      {/* Desktop view is only offered on mouse (fine-pointer) devices — on a
          touch phone the desktop sidebar rail is unusable and forceDesktop is
          ignored, so the toggle would be a confusing no-op. */}
      {!isCoarsePointer() && (
        <div className="m-foot">
          <button type="button" className="m-foot__link" onClick={handleSwitchToDesktop}>
            Switch to desktop view
          </button>
        </div>
      )}
    </div>
  );
}
