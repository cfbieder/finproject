import { useMemo, useState, useEffect } from "react";
import Rest from "../js/rest.js";
import { exportCashFlow } from "../utils/excelExporter.js";
import "./PageLayout.css";
import "./CashFlowByAccount.css";
import "../features/Balances/BalanceDateSelector.css";
import CashFlowReport from "../features/CashFlow/CashFlowReport.jsx";
import CashFlowDateSelectorMonthYearOne from "../features/CashFlow/CashFlowDateSelectorMonthYearOneP.jsx";
import HierarchyFilter from "../components/HierarchyFilter/HierarchyFilter.jsx";
import { useCoa } from "../hooks/useCoa.js";
import {
  buildCategoryFilterGroups,
  buildAccountFilterGroups,
} from "../utils/hierarchyFilterGroups.js";

// Recursively collect paths of collapsible nodes
const collectCollapsiblePaths = (nodes, path = [], set = new Set()) => {
  if (!Array.isArray(nodes)) return set;
  for (const node of nodes) {
    if (node && Array.isArray(node.children) && node.children.length > 0) {
      const key = [...path, node.name].join(">");
      set.add(key);
      collectCollapsiblePaths(node.children, [...path, node.name], set);
    }
  }
  return set;
};

// Add "Net cash flow" category if not present
const addNetCashFlowCategory = (nodes) => {
  if (!Array.isArray(nodes)) {
    return [];
  }

  let incomeTotal = 0;
  let expenseTotal = 0;
  let hasNetCashFlow = false;

  const result = nodes.map((node) => {
    if (!node || typeof node !== "object") {
      return node;
    }

    const name = typeof node.name === "string" ? node.name : "";
    const normalized = name.toLowerCase();

    if (normalized === "income") {
      incomeTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "expense" || normalized === "expenses") {
      expenseTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "net cash flow") {
      hasNetCashFlow = true;
    }

    return node;
  });

  if (hasNetCashFlow) {
    return result;
  }

  return [
    ...result,
    { name: "Net cash flow", total: incomeTotal + expenseTotal },
  ];
};

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const pad2 = (v) => String(v).padStart(2, "0");
const firstOfMonthIso = (year, monthIdx) => `${year}-${pad2(monthIdx + 1)}-01`;
const lastOfMonthIso = (year, monthIdx) => {
  const d = new Date(Date.UTC(year, monthIdx + 1, 0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

/**
 * Split a [fromDate, toDate] range into spans by frequency (month / quarter /
 * year). Each span is the slice of that calendar period that overlaps the
 * selected range, so the first/last span is clamped to the range bounds.
 * Returns [{ label, fromDate, toDate }].
 */
const getPeriods = (fromDate, toDate, frequency = "month") => {
  if (!fromDate || !toDate) {
    return [];
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }

  const sY = start.getUTCFullYear();
  const sM = start.getUTCMonth();
  const eY = end.getUTCFullYear();
  const eM = end.getUTCMonth();
  if (sY * 12 + sM > eY * 12 + eM) {
    return [];
  }

  const clampFrom = (iso) => (iso < fromDate ? fromDate : iso);
  const clampTo = (iso) => (iso > toDate ? toDate : iso);
  const periods = [];

  if (frequency === "year") {
    for (let y = sY; y <= eY; y += 1) {
      periods.push({
        label: String(y),
        fromDate: clampFrom(firstOfMonthIso(y, 0)),
        toDate: clampTo(lastOfMonthIso(y, 11)),
      });
    }
  } else if (frequency === "quarter") {
    const startQ = sY * 4 + Math.floor(sM / 3);
    const endQ = eY * 4 + Math.floor(eM / 3);
    for (let q = startQ; q <= endQ; q += 1) {
      const y = Math.floor(q / 4);
      const qIdx = q % 4; // 0..3
      const qStartMonth = qIdx * 3;
      const qEndMonth = qIdx * 3 + 2;
      periods.push({
        label: `Q${qIdx + 1} ${y}`,
        fromDate: clampFrom(firstOfMonthIso(y, qStartMonth)),
        toDate: clampTo(lastOfMonthIso(y, qEndMonth)),
      });
    }
  } else {
    const startAbs = sY * 12 + sM;
    const endAbs = eY * 12 + eM;
    for (let abs = startAbs; abs <= endAbs; abs += 1) {
      const y = Math.floor(abs / 12);
      const m = abs % 12;
      periods.push({
        label: MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(y, m, 1))),
        fromDate: firstOfMonthIso(y, m),
        toDate: lastOfMonthIso(y, m),
      });
    }
  }

  return periods;
};

const formatLocalDate = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

/**
 * CashFlowByAccount (CR054) — the "By Account" cash-flow tab.
 *
 * Same period-column layout as "By Period", plus the Budget-Worksheet-style
 * category/account filter chips and a USD ⇄ original-currency toggle. Filtering
 * to a single account (or a single-currency set) makes the original-currency
 * total meaningful; a mixed-currency original total is flagged with a warning
 * because it isn't a real number.
 */
export default function CashFlowByAccount() {
  const getYearStart = () => {
    const now = new Date();
    const firstOfYear = new Date(now.getFullYear(), 0, 1);
    return formatLocalDate(firstOfYear);
  };
  const getMonthEnd = () => {
    const now = new Date();
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return formatLocalDate(lastOfMonth);
  };

  const { plTree, bsTree } = useCoa();
  const categoryGroups = useMemo(
    () => buildCategoryFilterGroups(plTree),
    [plTree]
  );
  const accountGroups = useMemo(() => buildAccountFilterGroups(bsTree), [bsTree]);

  const [fromDates, setFromDates] = useState(() => [getYearStart()]);
  const [toDates, setToDates] = useState(() => [getMonthEnd()]);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());
  const [reportPeriods, setReportPeriods] = useState([]);
  const [includeUnrealizedGL, setIncludeUnrealizedGL] = useState(false);
  const [transfers, setTransfers] = useState("exclude");
  const [frequency, setFrequency] = useState("month");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [currency, setCurrency] = useState("usd");
  // Snapshot of the currency mode + distinct currencies actually fetched, so
  // the rendered figures and symbols stay consistent until the next Generate.
  const [fetched, setFetched] = useState({ currency: "usd", currencies: [] });
  const activePeriodCount = 1;

  const handleFromDateChange = (index, value) => {
    setFromDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleToDateChange = (index, value) => {
    setToDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleGenerateReport = async () => {
    setError("");
    const periods = getPeriods(fromDates[0], toDates[0], frequency);
    if (!periods.length) {
      setReports([]);
      setReportPeriods([]);
      setCollapsedPaths(new Set());
      setError(
        "Select a valid range (from date must be on or before to date) to generate the report."
      );
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        periods.map(({ fromDate, toDate }) =>
          Rest.fetchCashFlowByAccountV2({
            fromDate,
            toDate,
            transfers,
            includeUnrealizedGL,
            categories: selectedCategories,
            accounts: selectedAccounts,
            currency,
          })
        )
      );
      const processedReports = results.map((r) =>
        addNetCashFlowCategory(r.report)
      );
      const currencySet = new Set();
      for (const r of results) {
        for (const c of r.meta?.currencies || []) {
          if (c) currencySet.add(c);
        }
      }
      setReports(processedReports);
      setReportPeriods(periods);
      setFetched({ currency, currencies: [...currencySet].sort() });
      const collapsiblePaths = collectCollapsiblePaths(processedReports?.[0]);
      setCollapsedPaths(new Set(collapsiblePaths));
    } catch (err) {
      console.error("Failed to fetch cash flow data:", err);
      setError(err?.message ?? "Failed to fetch cash flow report");
      setReports([]);
      setReportPeriods([]);
      setCollapsedPaths(new Set());
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-generate on mount and whenever the frequency changes — the column
  // shape (count + headers) depends on it. Range / transfers / unrealized /
  // filters / currency changes still require an explicit Generate click.
  useEffect(() => {
    handleGenerateReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency]);

  const handleTogglePath = (pathKey) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(reports?.[0]),
    [reports]
  );
  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

  const isFullyExpanded =
    collapsiblePaths.size > 0 && collapsedPaths.size === 0;

  const periodLabels = useMemo(
    () => reportPeriods.map((period) => period.label),
    [reportPeriods]
  );

  // Currency code the report table should format with. USD mode always "USD".
  // Original mode: the single currency if the selection is single-currency,
  // otherwise null (plain decimal) — a mixed original total has no one symbol.
  const currencyCode = useMemo(() => {
    if (fetched.currency !== "original") return "USD";
    return fetched.currencies.length === 1 ? fetched.currencies[0] : null;
  }, [fetched]);

  const mixedCurrencyWarning =
    fetched.currency === "original" && fetched.currencies.length > 1;

  const handleExpandOneLayer = () => {
    setCollapsedPaths((prev) => {
      if (prev.size === 0) return prev;
      let minDepth = Infinity;
      for (const pathKey of prev) {
        const depth = pathKey.split(">").length - 1;
        if (depth < minDepth) minDepth = depth;
      }
      const next = new Set(prev);
      for (const pathKey of prev) {
        if (pathKey.split(">").length - 1 === minDepth) {
          next.delete(pathKey);
        }
      }
      return next;
    });
  };

  const handleCollapseOneLayer = () => {
    setCollapsedPaths((prev) => {
      const expandedPaths = [];
      for (const pathKey of collapsiblePaths) {
        if (!prev.has(pathKey)) expandedPaths.push(pathKey);
      }
      if (expandedPaths.length === 0) return prev;
      let maxDepth = -1;
      for (const pathKey of expandedPaths) {
        const depth = pathKey.split(">").length - 1;
        if (depth > maxDepth) maxDepth = depth;
      }
      const next = new Set(prev);
      for (const pathKey of expandedPaths) {
        if (pathKey.split(">").length - 1 === maxDepth) {
          next.add(pathKey);
        }
      }
      return next;
    });
  };

  const handleExport = () => {
    exportCashFlow(reports, periodLabels);
  };

  const hasReport =
    Array.isArray(reports?.[0]) && (reports?.[0]?.length ?? 0) > 0;

  return (
    <>
      <main className="page-main balance-grid balance-grid--single">
        <div className="report-toolbar-header">
          <div className="report-toolbar-header__text">
            <h1 className="report-toolbar-header__title">Cash Flow by Account</h1>
            <p className="report-toolbar-header__description">
              Cash flow by period, filtered by category and account, in USD or
              original currency.
            </p>
          </div>
        </div>
        <CashFlowDateSelectorMonthYearOne
          activePeriodCount={activePeriodCount}
          fromDates={fromDates}
          toDates={toDates}
          onFromDateChange={handleFromDateChange}
          onToDateChange={handleToDateChange}
          includeUnrealizedGL={includeUnrealizedGL}
          onIncludeUnrealizedChange={setIncludeUnrealizedGL}
          transfers={transfers}
          onTransfersChange={setTransfers}
          frequency={frequency}
          onFrequencyChange={setFrequency}
          onGenerateReport={handleGenerateReport}
          isLoading={isLoading}
          collapsiblePaths={collapsiblePaths}
          onExpandOneLayer={handleExpandOneLayer}
          onCollapseOneLayer={handleCollapseOneLayer}
          isFullyCollapsed={isFullyCollapsed}
          isFullyExpanded={isFullyExpanded}
          error={error}
          showPeriodSelector={false}
          onExport={handleExport}
          canExport={hasReport}
          layout="toolbar"
        />

        <section className="cash-flow-by-account__filters">
          <div className="cash-flow-by-account__filter-col">
            <HierarchyFilter
              label="Categories"
              groups={categoryGroups}
              onSelectionChange={setSelectedCategories}
            />
          </div>
          <div className="cash-flow-by-account__filter-col">
            <HierarchyFilter
              label="Accounts"
              groups={accountGroups}
              onSelectionChange={setSelectedAccounts}
            />
          </div>
          <div className="cash-flow-by-account__currency">
            <span className="report-toolbar__label">Currency</span>
            <div
              className="cash-flow-by-account__segmented"
              role="group"
              aria-label="Currency mode"
            >
              <button
                type="button"
                className={`btn btn--sm ${
                  currency === "usd" ? "btn--primary" : "btn--outline"
                }`}
                onClick={() => setCurrency("usd")}
              >
                USD
              </button>
              <button
                type="button"
                className={`btn btn--sm ${
                  currency === "original" ? "btn--primary" : "btn--outline"
                }`}
                onClick={() => setCurrency("original")}
              >
                Original
              </button>
            </div>
            <span className="cash-flow-by-account__hint">
              Click Generate to apply filters &amp; currency.
            </span>
          </div>
        </section>

        {mixedCurrencyWarning && (
          <p className="cash-flow-by-account__warning" role="alert">
            Original-currency totals mix {fetched.currencies.length} currencies (
            {fetched.currencies.join(", ")}) — filter Accounts to a single
            currency to total meaningfully.
          </p>
        )}

        <div className="balance-layout-wrapper">
          <div className="report-scroll-container">
            <CashFlowReport
              reports={reports}
              periodLabels={periodLabels}
              collapsedPaths={collapsedPaths}
              onTogglePath={handleTogglePath}
              periods={reportPeriods}
              currencyCode={currencyCode}
            />
          </div>
        </div>
      </main>
    </>
  );
}
