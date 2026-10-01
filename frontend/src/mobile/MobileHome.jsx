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
  Receipt,
  Scale,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useState } from "react";
import { useOverview, formatOverviewKpi } from "../hooks/useOverview.js";
import NetWorthBridgeModal from "../components/NetWorthHero/NetWorthBridgeModal.jsx";
import { setForceDesktop, isCoarsePointer } from "./useIsMobile";

const CARDS = [
  { to: "/m/transactions", label: "Transactions", icon: Receipt },
  { to: "/m/balance", label: "Balance Summary", icon: Wallet },
  { to: "/m/balance-trends", label: "Balance Trends", icon: LineChart },
  { to: "/m/ledger", label: "Ledger", icon: BookOpen },
  { to: "/m/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { to: "/m/budget-realization", label: "Budget Realization", icon: Target },
  { to: "/m/budget-graph", label: "Budget Graph", icon: BarChart3 },
  { to: "/m/refresh-feeds", label: "Refresh Feeds", icon: RefreshCw },
  { to: "/m/reconcile", label: "Reconcile", icon: Scale },
];

const formatKpi = formatOverviewKpi;

export default function MobileHome() {
  const { data, isLoading, failed } = useOverview();
  const [explaining, setExplaining] = useState(false);
  // The headline is HIDDEN until asked for, every time Home opens (owner,
  // 2026-10-01: the phone is opened in public). Deliberately not remembered —
  // a remembered "shown" would make the next public opening show it again.
  const [revealed, setRevealed] = useState(false);

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
              <button
                type="button"
                className="m-kpi__reveal"
                onClick={() => setRevealed((v) => !v)}
                aria-pressed={revealed}
                aria-label={revealed ? "Hide net worth" : "Show net worth"}
              >
                {revealed ? (
                  <span
                    className={
                      "m-kpi__value" +
                      (data.netWorth < 0 ? " m-kpi__value--negative" : "")
                    }
                  >
                    {formatKpi(data.netWorth)}
                  </span>
                ) : (
                  <span className="m-kpi__value m-kpi__value--masked">••••••</span>
                )}
                {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {!revealed && <span className="m-kpi__hint">Tap to show</span>}
              {revealed && (
              <span className={"m-kpi__sub m-kpi__sub--" + (up ? "up" : "down")}>
                {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {formatKpi(Math.abs(data.delta))} vs last month
              </span>
              )}
              {/* CR092. Mobile's delta is month-over-month, NOT the desktop
                  hero's 12 months — so it passes its own window rather than
                  reusing the hero's, or the phone would explain a change it is
                  not showing. */}
              {revealed && (
              <button
                type="button"
                className="m-kpi__explain"
                onClick={() => setExplaining(true)}
              >
                What changed?
              </button>
              )}
            </div>
          </div>

          {explaining && (
            <NetWorthBridgeModal
              open
              onClose={() => setExplaining(false)}
              fromDate={data.deltaFrom}
              toDate={data.deltaTo}
            />
          )}

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
