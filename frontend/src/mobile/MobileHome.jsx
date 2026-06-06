import { useEffect, useState } from "react";
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
  Loader2,
} from "lucide-react";
import Rest from "../js/rest.js";
import { getPreset } from "./periodPresets.js";
import { setForceDesktop } from "./useIsMobile";

const CARDS = [
  { to: "/m/balance", label: "Balance Summary", icon: Wallet },
  { to: "/m/balance-trends", label: "Balance Trends", icon: LineChart },
  { to: "/m/ledger", label: "Ledger", icon: BookOpen },
  { to: "/m/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
  { to: "/m/budget-realization", label: "Budget Realization", icon: Target },
  { to: "/m/budget-graph", label: "Budget Graph", icon: BarChart3 },
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatKpi = (value) => {
  const n = value ?? 0;
  return n < 0
    ? `(${currencyFormatter.format(Math.abs(n))})`
    : currencyFormatter.format(n);
};

const pad = (v) => String(v).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const findTopLevel = (nodes, name) => {
  if (!Array.isArray(nodes)) return null;
  return nodes.find((n) => (n.name ?? "").toLowerCase() === name.toLowerCase()) || null;
};

const netWorthOf = (report) => {
  const assets = findTopLevel(report, "assets")?.totalUSD ?? 0;
  const liabilities = findTopLevel(report, "liabilities")?.totalUSD ?? 0;
  return assets + liabilities; // liabilities stored negative
};

export default function MobileHome() {
  const [data, setData] = useState(null); // { netWorth, delta, income, expense, net }
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const today = fmtDate(now);
    const priorMonthEnd = fmtDate(new Date(now.getFullYear(), now.getMonth(), 0));
    const thisMonth = getPreset("this-month").range();

    setIsLoading(true);
    setFailed(false);
    Promise.all([
      Rest.fetchBalanceReportV2(today),
      Rest.fetchBalanceReportV2(priorMonthEnd),
      Rest.fetchCashFlowReportV2({
        fromDate: thisMonth.fromDate,
        toDate: thisMonth.toDate,
        transfers: "exclude",
        includeUnrealizedGL: false,
      }),
    ])
      .then(([balNow, balPrior, cf]) => {
        if (cancelled) return;
        const income = findTopLevel(cf, "income")?.total ?? 0;
        const expense =
          (findTopLevel(cf, "expense") || findTopLevel(cf, "expenses"))?.total ?? 0;
        const netWorth = netWorthOf(balNow);
        setData({
          netWorth,
          delta: netWorth - netWorthOf(balPrior),
          income,
          expense,
          net: income + expense,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

      <div className="m-foot">
        <button type="button" className="m-foot__link" onClick={handleSwitchToDesktop}>
          Switch to desktop view
        </button>
      </div>
    </div>
  );
}
