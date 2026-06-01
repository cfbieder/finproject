import { useMemo, useState, useEffect } from "react";
import Rest from "../js/rest.js";
import { exportBalanceSheet } from "../utils/excelExporter.js";
import {
  buildEndDateSeries,
  planColumns,
  getTodayIso,
  formatColumnHeader,
} from "../utils/periodHelpers.js";
import { EARLIEST_ACTUAL_YEAR } from "../utils/yearOptions";
import MonthYearPicker from "../components/MonthYearPicker";
import BalanceReport from "../features/Balances/BalanceReport.jsx";
import "./PageLayout.css";
import "../features/Balances/BalanceDateSelector.css";

const monthOptions = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

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

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;

export default function BalanceSheetPeriods() {
  const [fromMonth, setFromMonth] = useState(1);
  const [fromYear, setFromYear] = useState(CURRENT_YEAR);
  const [toMonth, setToMonth] = useState(CURRENT_MONTH);
  const [toYear, setToYear] = useState(CURRENT_YEAR);
  const [frequency, setFrequency] = useState("month");

  const [reports, setReports] = useState([]);
  const [columns, setColumns] = useState([]); // [{ label, asOf, isPartial }]
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());

  const yearOptions = useMemo(() => {
    const years = [];
    for (let y = EARLIEST_ACTUAL_YEAR; y <= CURRENT_YEAR; y += 1) {
      years.push(y);
    }
    return years;
  }, []);

  const handleGenerate = async () => {
    setError("");
    // Year is a point-in-time snapshot at 12/31, so the month selection is
    // irrelevant — always span the full calendar year for each year in range.
    const effFromMonth = frequency === "year" ? 1 : fromMonth;
    const effToMonth = frequency === "year" ? 12 : toMonth;
    const endDates = buildEndDateSeries(
      fromYear,
      effFromMonth,
      toYear,
      effToMonth,
      frequency
    );
    const planned = planColumns(endDates, frequency, getTodayIso());
    if (!planned.length) {
      setReports([]);
      setColumns([]);
      setCollapsedPaths(new Set());
      setError(
        "Select a valid range (from must be on or before to) to generate the report."
      );
      return;
    }

    setIsLoading(true);
    try {
      const rawReports = await Promise.all(
        planned.map(({ asOf }) => Rest.fetchBalanceReportV2(asOf))
      );
      setReports(rawReports);
      setColumns(planned);
      setCollapsedPaths(new Set(collectCollapsiblePaths(rawReports?.[0])));
    } catch (err) {
      console.error("Failed to fetch balance sheet periods:", err);
      setError(err?.message ?? "Failed to fetch balance sheet report");
      setReports([]);
      setColumns([]);
      setCollapsedPaths(new Set());
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-generate on mount and whenever the frequency changes — the column
  // shape (count + headers) depends on it. Range changes still require an
  // explicit Generate click.
  useEffect(() => {
    handleGenerate();
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
  const isCollapseToggleDisabled = isLoading || collapsiblePaths.size === 0;

  const periodLabels = useMemo(
    () =>
      columns.map((col) =>
        formatColumnHeader(col.label, frequency, col.isPartial)
      ),
    [columns, frequency]
  );

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

  const hasReport =
    Array.isArray(reports?.[0]) && (reports?.[0]?.length ?? 0) > 0;

  const handleExport = () => {
    exportBalanceSheet(reports, periodLabels);
  };

  return (
    <main className="page-main balance-grid balance-grid--single">
      <div className="report-toolbar-header">
        <div className="report-toolbar-header__text">
          <h1 className="report-toolbar-header__title">Balance Sheet Periods</h1>
          <p className="report-toolbar-header__description">
            Balance sheet as of the last day of each period (month, quarter, or
            year) in the selected range.
          </p>
        </div>
      </div>

      <section
        className="report-toolbar report-toolbar--stacked"
        aria-label="Report filters"
      >
        <div className="report-toolbar__control-row">
          <div className="report-toolbar__field">
            <label htmlFor="bsp-frequency" className="report-toolbar__label">
              Period
            </label>
            <select
              id="bsp-frequency"
              className="report-toolbar__select"
              value={frequency}
              onChange={(event) => setFrequency(event.target.value)}
            >
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </div>
        </div>
        <div className="report-toolbar__periods-column">
          <div className="report-toolbar__period-group">
            {frequency === "year" ? (
              <>
                <div className="report-toolbar__field">
                  <label htmlFor="bsp-from-year" className="report-toolbar__label">
                    From
                  </label>
                  <select
                    id="bsp-from-year"
                    className="report-toolbar__select"
                    value={fromYear}
                    onChange={(event) => setFromYear(Number(event.target.value))}
                  >
                    {yearOptions.map((year) => (
                      <option key={`bsp-from-year-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="report-toolbar__field">
                  <label htmlFor="bsp-to-year" className="report-toolbar__label">
                    To
                  </label>
                  <select
                    id="bsp-to-year"
                    className="report-toolbar__select"
                    value={toYear}
                    onChange={(event) => setToYear(Number(event.target.value))}
                  >
                    {yearOptions.map((year) => (
                      <option key={`bsp-to-year-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="report-toolbar__field">
                  <label
                    htmlFor="bsp-from-month"
                    className="report-toolbar__label"
                  >
                    From
                  </label>
                  <MonthYearPicker
                    monthId="bsp-from-month"
                    yearId="bsp-from-year"
                    monthValue={fromMonth}
                    yearValue={fromYear}
                    monthOptions={monthOptions}
                    yearOptions={yearOptions}
                    onMonthChange={(value) => setFromMonth(Number(value))}
                    onYearChange={(value) => setFromYear(Number(value))}
                    rowClassName="report-toolbar__month-year-row"
                    inputClassName="report-toolbar__select"
                  />
                </div>
                <div className="report-toolbar__field">
                  <label htmlFor="bsp-to-month" className="report-toolbar__label">
                    To
                  </label>
                  <MonthYearPicker
                    monthId="bsp-to-month"
                    yearId="bsp-to-year"
                    monthValue={toMonth}
                    yearValue={toYear}
                    monthOptions={monthOptions}
                    yearOptions={yearOptions}
                    onMonthChange={(value) => setToMonth(Number(value))}
                    onYearChange={(value) => setToYear(Number(value))}
                    rowClassName="report-toolbar__month-year-row"
                    inputClassName="report-toolbar__select"
                  />
                </div>
              </>
            )}
          </div>
          <div className="report-toolbar__period-actions">
            <button
              className="report-toolbar__button report-toolbar__button--primary"
              type="button"
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading ? "Generating..." : "Generate"}
            </button>
            {!isFullyExpanded && (
              <button
                className="report-toolbar__button"
                type="button"
                onClick={handleExpandOneLayer}
                disabled={isCollapseToggleDisabled}
              >
                Expand +
              </button>
            )}
            {!isFullyCollapsed && (
              <button
                className="report-toolbar__button"
                type="button"
                onClick={handleCollapseOneLayer}
                disabled={isCollapseToggleDisabled}
              >
                Collapse −
              </button>
            )}
            <button
              className="report-toolbar__button"
              type="button"
              onClick={handleExport}
              disabled={isLoading || !hasReport}
            >
              Export
            </button>
          </div>
          {error && <p className="report-toolbar__error">{error}</p>}
        </div>
      </section>

      <div className="balance-layout-wrapper">
        <div className="report-scroll-container">
          {hasReport ? (
            <BalanceReport
              balanceReports={reports}
              periodDates={periodLabels}
              periodCount={reports.length}
              maxPeriods={reports.length}
              collapsedPaths={collapsedPaths}
              onTogglePath={handleTogglePath}
            />
          ) : (
            <p className="balance-report-empty">
              {isLoading
                ? "Generating report..."
                : "Choose a range and click Generate to view balances by period."}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
