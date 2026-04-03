import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  Download,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Inbox,
  Loader2,
} from "lucide-react";
import BalanceReport from "../features/Balances/BalanceReport.jsx";
import Rest from "../js/rest.js";
import { exportBalanceSheet } from "../utils/excelExporter.js";
import "./BalanceV2.css";

// ── Helpers ──

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

const collectCollapsiblePaths = (accounts, path = [], result = new Set()) => {
  if (!Array.isArray(accounts)) return result;
  for (const account of accounts) {
    const hasChildren =
      Array.isArray(account.children) && account.children.length > 0;
    if (hasChildren) {
      const key = [...path, account.name].join(">");
      result.add(key);
      collectCollapsiblePaths(account.children, [...path, account.name], result);
    }
  }
  return result;
};

const computeNetWorth = (accounts) => {
  if (!Array.isArray(accounts)) return 0;
  let total = 0;
  for (const account of accounts) {
    const name = (account.name ?? "").toLowerCase();
    if (name === "assets" || name === "liabilities") {
      total += account.totalUSD ?? 0;
    }
  }
  return total;
};

const getTopLevelValue = (accounts, targetName) => {
  if (!Array.isArray(accounts)) return 0;
  const node = accounts.find(
    (a) => (a.name ?? "").toLowerCase() === targetName.toLowerCase()
  );
  return node?.totalUSD ?? 0;
};

const getToday = () => {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ── Component ──

export default function BalanceV2() {
  const [periodDates, setPeriodDates] = useState(() => {
    const today = getToday();
    return [today, today, today];
  });
  const [periodCount, setPeriodCount] = useState(1);
  const [balanceReports, setBalanceReports] = useState([]);
  const [reportError, setReportError] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set());
  const initialRequested = useRef(false);

  const activePeriodCount = useMemo(
    () => Math.min(Math.max(periodCount ?? 1, 1), 3),
    [periodCount]
  );

  // ── Data fetching ──
  const handleGenerateReport = useCallback(async () => {
    setReportError("");
    setIsFetching(true);
    const activeDates = periodDates.slice(0, activePeriodCount);
    try {
      const reports = await Promise.all(
        activeDates.map((date) => Rest.fetchBalanceReportV2(date))
      );
      setBalanceReports(reports);
      setCollapsedPaths(new Set(collectCollapsiblePaths(reports[0])));
    } catch (err) {
      setReportError(err?.message ?? "Failed to fetch balance report");
    } finally {
      setIsFetching(false);
    }
  }, [periodDates, activePeriodCount]);

  // Auto-fetch on mount
  useEffect(() => {
    if (initialRequested.current) return;
    initialRequested.current = true;
    handleGenerateReport();
  }, [handleGenerateReport]);

  // ── Collapse / Expand ──
  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(balanceReports?.[0]),
    [balanceReports]
  );

  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;
  const isFullyExpanded =
    collapsiblePaths.size > 0 && collapsedPaths.size === 0;

  const handleTogglePath = useCallback((pathKey) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  const handleExpandOneLayer = useCallback(() => {
    setCollapsedPaths((prev) => {
      if (prev.size === 0) return prev;
      let minDepth = Infinity;
      for (const pk of prev) {
        const d = pk.split(">").length - 1;
        if (d < minDepth) minDepth = d;
      }
      const next = new Set(prev);
      for (const pk of prev) {
        if (pk.split(">").length - 1 === minDepth) next.delete(pk);
      }
      return next;
    });
  }, []);

  const handleCollapseOneLayer = useCallback(() => {
    setCollapsedPaths((prev) => {
      const expanded = [];
      for (const pk of collapsiblePaths) {
        if (!prev.has(pk)) expanded.push(pk);
      }
      if (expanded.length === 0) return prev;
      let maxDepth = -1;
      for (const pk of expanded) {
        const d = pk.split(">").length - 1;
        if (d > maxDepth) maxDepth = d;
      }
      const next = new Set(prev);
      for (const pk of expanded) {
        if (pk.split(">").length - 1 === maxDepth) next.add(pk);
      }
      return next;
    });
  }, [collapsiblePaths]);

  // ── Period controls ──
  const handlePeriodDateChange = useCallback((index, value) => {
    setPeriodDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  // ── Export ──
  const handleExport = useCallback(() => {
    const activeDates = periodDates.slice(0, activePeriodCount);
    exportBalanceSheet(
      balanceReports.slice(0, activePeriodCount),
      activeDates
    );
  }, [balanceReports, periodDates, activePeriodCount]);

  // ── KPI values ──
  const kpis = useMemo(() => {
    const base = balanceReports[0];
    if (!base) return null;
    return {
      netWorth: computeNetWorth(base),
      assets: getTopLevelValue(base, "assets"),
      liabilities: getTopLevelValue(base, "liabilities"),
    };
  }, [balanceReports]);

  const hasReport = balanceReports.length > 0;
  const collapseDisabled = collapsiblePaths.size === 0 || isFetching;

  // ────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────
  return (
    <div className="balv2">
      {/* ── Header ── */}
      <div className="balv2-header">
        <h1 className="balv2-header__title">Balance Sheet</h1>
      </div>

      {/* ── KPI Cards ── */}
      {kpis && (
        <div className="balv2-kpis">
          <div className="balv2-kpi balv2-kpi--highlight">
            <span className="balv2-kpi__label">Net Worth</span>
            <span
              className={`balv2-kpi__value${
                kpis.netWorth < 0 ? " balv2-kpi__value--negative" : ""
              }`}
            >
              {formatKpi(kpis.netWorth)}
            </span>
          </div>
          <div className="balv2-kpi">
            <span className="balv2-kpi__label">Total Assets</span>
            <span className="balv2-kpi__value balv2-kpi__value--positive">
              {formatKpi(kpis.assets)}
            </span>
          </div>
          <div className="balv2-kpi">
            <span className="balv2-kpi__label">Total Liabilities</span>
            <span
              className={`balv2-kpi__value${
                kpis.liabilities < 0 ? " balv2-kpi__value--negative" : ""
              }`}
            >
              {formatKpi(kpis.liabilities)}
            </span>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="balv2-toolbar">
        {/* Period count + date inputs */}
        <div className="balv2-periods">
          <div className="balv2-period-count">
            <span className="balv2-period-count__label">Periods</span>
            <select
              className="balv2-period-count__select"
              value={activePeriodCount}
              onChange={(e) => setPeriodCount(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>

          {Array.from({ length: activePeriodCount }, (_, i) => (
            <div className="balv2-period-group" key={i}>
              <span className="balv2-period-badge">P{i + 1}</span>
              <input
                type="date"
                className="balv2-date-input"
                value={periodDates[i]}
                onChange={(e) => handlePeriodDateChange(i, e.target.value)}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          className="balv2-btn balv2-btn--primary"
          onClick={handleGenerateReport}
          disabled={isFetching}
        >
          <RefreshCw size={13} />
          {isFetching ? "Loading..." : "Generate"}
        </button>

        <div className="balv2-toolbar__sep" />

        {/* Expand / Collapse */}
        {hasReport && (
          <>
            <button
              type="button"
              className="balv2-btn balv2-btn--icon"
              onClick={handleExpandOneLayer}
              disabled={collapseDisabled || isFullyExpanded}
              title="Expand one level"
            >
              <ChevronDown size={16} />
            </button>
            <button
              type="button"
              className="balv2-btn balv2-btn--icon"
              onClick={handleCollapseOneLayer}
              disabled={collapseDisabled || isFullyCollapsed}
              title="Collapse one level"
            >
              <ChevronUp size={16} />
            </button>

            <div className="balv2-toolbar__sep" />
          </>
        )}

        <div className="balv2-toolbar__spacer" />

        {/* Export */}
        <button
          type="button"
          className="balv2-btn"
          onClick={handleExport}
          disabled={!hasReport}
        >
          <Download size={13} />
          Export
        </button>
      </div>

      {/* ── Report ── */}
      <div className="balv2-report-wrap">
        {isFetching && !hasReport && (
          <div className="balv2-state">
            <Loader2
              size={28}
              className="balv2-state__icon"
              style={{ animation: "balv2-spin 1s linear infinite" }}
            />
            <span className="balv2-state__text">Generating report...</span>
          </div>
        )}

        {!isFetching && reportError && (
          <div className="balv2-state">
            <AlertTriangle size={28} className="balv2-state__icon" />
            <span className="balv2-state__text balv2-state__text--error">
              {reportError}
            </span>
          </div>
        )}

        {!isFetching && !reportError && !hasReport && (
          <div className="balv2-state">
            <Inbox size={32} className="balv2-state__icon" />
            <span className="balv2-state__text">
              Select a date and click Generate to view balances
            </span>
          </div>
        )}

        {hasReport && (
          <div className="balv2-report-scroll">
            <BalanceReport
              balanceReports={balanceReports}
              periodDates={periodDates}
              periodCount={activePeriodCount}
              collapsedPaths={collapsedPaths}
              onTogglePath={handleTogglePath}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes balv2-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
