import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Loader2 } from "lucide-react";
import HierarchyFilter from "../components/HierarchyFilter/HierarchyFilter.jsx";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import { useCoa } from "../hooks/useCoa.js";
import Rest from "../js/rest.js";
import {
  INTERVALS,
  buildEndDateSeries,
  planColumns,
  getTodayIso,
  formatColumnHeader,
} from "../utils/periodHelpers.js";
import "./PageLayout.css";
import "./BalanceTrends.css";

const CURRENT_YEAR = new Date().getFullYear();

const flattenBalanceLeaves = (nodes, out = new Map()) => {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (!n) continue;
    const hasChildren = Array.isArray(n.children) && n.children.length > 0;
    if (hasChildren) {
      flattenBalanceLeaves(n.children, out);
    } else if (n.name) {
      const balanceInUSD = Number.isFinite(Number(n.totalUSD)) ? Number(n.totalUSD) : 0;
      out.set(n.name, {
        currency: n.currency ?? null,
        balanceInUSD,
        // Native-currency balance (`total`); falls back to USD if the node
        // carries no native figure (e.g. USD-denominated accounts).
        balanceNative: Number.isFinite(Number(n.total)) ? Number(n.total) : balanceInUSD,
      });
    }
  }
  return out;
};

const CURRENCY_MODES = [
  { key: "usd", label: "USD" },
  { key: "local", label: "Local" },
  { key: "both", label: "Both" },
];

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const formatUSD = (v) => usdFormatter.format(Number.isFinite(v) ? v : 0);

// Native-currency formatters, cached per ISO code. Uses currencyDisplay:"code"
// so mixed-currency columns read unambiguously (e.g. "PLN 153,300").
const nativeFormatters = new Map();
const formatNative = (v, code) => {
  const amount = Number.isFinite(v) ? v : 0;
  if (!code) return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
  let fmt = nativeFormatters.get(code);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        currencyDisplay: "code",
        maximumFractionDigits: 0,
      });
    } catch {
      fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    }
    nativeFormatters.set(code, fmt);
  }
  return fmt.format(amount);
};

export default function BalanceTrends() {
  const { bsTree } = useCoa();

  // Period — default to This Year (Jan–Dec current year)
  const [fromMonth, setFromMonth] = useState("01");
  const [toMonth, setToMonth] = useState("12");
  const [actualYear, setActualYear] = useState(CURRENT_YEAR);
  const [toYear, setToYear] = useState(CURRENT_YEAR);

  const [intervalKey, setIntervalKey] = useState("month");
  const [currencyKey, setCurrencyKey] = useState("usd"); // usd | local | both
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [columns, setColumns] = useState([]); // [{ label, asOf, isPartial }]
  const [reportsByLabel, setReportsByLabel] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Build BS COA groups exactly like TransActual: every child under Assets/Liabilities.
  const accountGroups = useMemo(() => {
    if (!bsTree?.length) return [];
    const groups = [];
    for (const topNode of bsTree) {
      if (topNode.children?.length) {
        for (const child of topNode.children) {
          groups.push({ key: child.name, label: child.name, node: child });
        }
      } else {
        groups.push({ key: topNode.name, label: topNode.name, node: topNode });
      }
    }
    return groups;
  }, [bsTree]);

  const handlePeriodChange = useCallback((next) => {
    if (next.fromMonth !== undefined) setFromMonth(next.fromMonth);
    if (next.toMonth !== undefined) setToMonth(next.toMonth);
    if (next.actualYear !== undefined) setActualYear(Number(next.actualYear));
    if (next.toYear !== undefined) setToYear(Number(next.toYear));
  }, []);

  const handleGenerate = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const rawSeries = buildEndDateSeries(
        actualYear,
        fromMonth,
        toYear,
        toMonth,
        intervalKey
      );
      const planned = planColumns(rawSeries, intervalKey, getTodayIso());
      const reports = await Promise.all(
        planned.map(({ asOf }) => Rest.fetchBalanceReport(asOf))
      );
      const nextByLabel = {};
      planned.forEach(({ label }, idx) => {
        nextByLabel[label] = flattenBalanceLeaves(reports[idx]);
      });
      setColumns(planned);
      setReportsByLabel(nextByLabel);
    } catch (err) {
      console.error("[BalanceTrends] generate failed:", err);
      setError(err?.message ?? "Failed to fetch balance trends");
      setColumns([]);
      setReportsByLabel({});
    } finally {
      setIsLoading(false);
    }
  }, [actualYear, fromMonth, toYear, toMonth, intervalKey]);

  // Auto-generate on mount and whenever the interval changes — the column
  // shape (count + headers) depends on it, so re-running keeps the table in
  // sync without the user having to click Generate just for an interval flip.
  // Year / month dropdowns still require an explicit Generate click.
  useEffect(() => {
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalKey]);

  const rows = useMemo(() => {
    if (!selectedAccounts.length || !columns.length) return [];
    return selectedAccounts.map((name) => {
      const values = [];
      const nativeValues = [];
      for (const { label } of columns) {
        const entry = reportsByLabel[label]?.get(name);
        values.push(entry ? entry.balanceInUSD : 0);
        nativeValues.push(entry ? entry.balanceNative : 0);
      }
      // Pick the most recent currency we saw for this account
      let currency = null;
      for (let i = columns.length - 1; i >= 0; i -= 1) {
        const entry = reportsByLabel[columns[i].label]?.get(name);
        if (entry?.currency) {
          currency = entry.currency;
          break;
        }
      }
      return { name, currency, values, nativeValues };
    });
  }, [selectedAccounts, columns, reportsByLabel]);

  const totals = useMemo(() => {
    if (!rows.length) return [];
    return columns.map((_, colIdx) =>
      rows.reduce((sum, row) => sum + (row.values[colIdx] || 0), 0)
    );
  }, [rows, columns]);

  const hasTable = rows.length > 0 && columns.length > 0;

  const handleExport = useCallback(() => {
    if (!hasTable) return;
    const round2 = (v) => Math.round((v || 0) * 100) / 100;
    let header;
    let currRow;
    const bodyRows = [];
    if (currencyKey === "both") {
      // Two value columns per account (native + USD); Total stays USD.
      header = ["Period"];
      currRow = [""];
      for (const r of rows) {
        header.push(r.name, `${r.name} (USD)`);
        currRow.push(r.currency ?? "", "USD");
      }
      header.push("Total (selected, USD)");
      currRow.push("USD");
      columns.forEach((col, colIdx) => {
        const row = [formatColumnHeader(col.label, intervalKey, col.isPartial)];
        for (const r of rows) row.push(round2(r.nativeValues[colIdx]), round2(r.values[colIdx]));
        row.push(round2(totals[colIdx]));
        bodyRows.push(row);
      });
    } else {
      const useNative = currencyKey === "local";
      header = ["Period", ...rows.map((r) => r.name), "Total (selected, USD)"];
      currRow = ["", ...rows.map((r) => r.currency ?? ""), "USD"];
      columns.forEach((col, colIdx) => {
        bodyRows.push([
          formatColumnHeader(col.label, intervalKey, col.isPartial),
          ...rows.map((r) => round2(useNative ? r.nativeValues[colIdx] : r.values[colIdx])),
          round2(totals[colIdx]),
        ]);
      });
    }
    const data = [header, currRow, ...bodyRows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = header.map((_, i) => (i === 0 ? { wch: 12 } : { wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Trends");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-trends-${actualYear}${fromMonth}-${toYear}${toMonth}-${intervalKey}-${currencyKey}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [hasTable, columns, rows, totals, actualYear, fromMonth, toYear, toMonth, intervalKey, currencyKey]);

  return (
    <main className="page-main balance-grid balance-grid--single">
      <div className="report-toolbar-header">
        <div className="report-toolbar-header__text">
          <h1 className="report-toolbar-header__title">Balance Trends</h1>
          <p className="report-toolbar-header__description">
            Month-end USD balances of selected balance sheet accounts across a period.
          </p>
        </div>
      </div>

      <div className="balance-trends-toolbar">
        <section className="balance-trends-toolbar__section balance-trends-toolbar__section--accounts">
          <h2 className="balance-trends-toolbar__label">Accounts</h2>
          {accountGroups.length > 0 ? (
            <HierarchyFilter
              groups={accountGroups}
              onSelectionChange={setSelectedAccounts}
            />
          ) : (
            <p className="balance-trends-toolbar__hint">Loading account groups…</p>
          )}
          <p className="balance-trends-toolbar__hint">
            Pick a group, then check accounts. Right-click an item to select only that one.
          </p>
        </section>

        <section className="balance-trends-toolbar__section balance-trends-toolbar__section--period">
          <h2 className="balance-trends-toolbar__label">Period</h2>
          <PeriodSelector
            onChange={handlePeriodChange}
            fromMonth={fromMonth}
            toMonth={toMonth}
            actualYear={actualYear}
            toYear={toYear}
            defaultPreset="this-year"
            hideBudgetYear
            enableYearRange
          />
          <div className="balance-trends-toolbar__interval">
            <span className="balance-trends-toolbar__interval-label">Interval</span>
            <div className="balance-trends-toolbar__interval-pills" role="radiogroup" aria-label="Interval">
              {INTERVALS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={intervalKey === opt.key}
                  className={`balance-trends-toolbar__interval-pill${
                    intervalKey === opt.key ? " is-active" : ""
                  }`}
                  onClick={() => setIntervalKey(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="balance-trends-toolbar__interval">
            <span className="balance-trends-toolbar__interval-label">Currency</span>
            <div className="balance-trends-toolbar__interval-pills" role="radiogroup" aria-label="Currency">
              {CURRENCY_MODES.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={currencyKey === opt.key}
                  className={`balance-trends-toolbar__interval-pill${
                    currencyKey === opt.key ? " is-active" : ""
                  }`}
                  onClick={() => setCurrencyKey(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="balance-trends-toolbar__actions">
            <button
              type="button"
              className="balance-trends-toolbar__btn balance-trends-toolbar__btn--primary"
              onClick={handleGenerate}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 size={16} className="spin" /> : null}
              {isLoading ? "Generating…" : "Generate"}
            </button>
            <button
              type="button"
              className="balance-trends-toolbar__btn"
              onClick={handleExport}
              disabled={!hasTable}
            >
              <Download size={16} /> Export
            </button>
          </div>
          {error && <p className="balance-trends-toolbar__error">{error}</p>}
        </section>
      </div>

      <div className="balance-layout-wrapper">
        <div className="report-scroll-container">
          {hasTable ? (
            <table className="balance-trends-table">
              <thead>
                <tr>
                  <th className="balance-trends-table__th-account balance-trends-table__th-period">
                    Period
                  </th>
                  {rows.map((row) => (
                    <th
                      key={row.name}
                      className="balance-trends-table__th-account-col"
                      title={row.name}
                    >
                      <span className="balance-trends-table__acct-name">{row.name}</span>
                      {row.currency ? (
                        <span className="balance-trends-table__acct-curr">{row.currency}</span>
                      ) : null}
                    </th>
                  ))}
                  <th className="balance-trends-table__th-account-col is-total-col">
                    <span className="balance-trends-table__acct-name">Total (selected)</span>
                    <span className="balance-trends-table__acct-curr">USD</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col, colIdx) => (
                  <tr key={col.label}>
                    <td
                      className={`balance-trends-table__td-account${col.isPartial ? " is-partial" : ""}`}
                      title={col.isPartial ? `As of ${col.asOf}` : col.label}
                    >
                      {formatColumnHeader(col.label, intervalKey, col.isPartial)}
                    </td>
                    {rows.map((row) => {
                      const usd = row.values[colIdx];
                      const nat = row.nativeValues[colIdx];
                      if (currencyKey === "both") {
                        return (
                          <td key={row.name} className="balance-trends-table__td-value">
                            <span
                              className={`balance-trends-table__val-native${nat < 0 ? " is-negative" : ""}`}
                            >
                              {formatNative(nat, row.currency)}
                            </span>
                            <span
                              className={`balance-trends-table__val-usd${usd < 0 ? " is-negative" : ""}`}
                            >
                              {formatUSD(usd)}
                            </span>
                          </td>
                        );
                      }
                      const useNative = currencyKey === "local";
                      const v = useNative ? nat : usd;
                      return (
                        <td
                          key={row.name}
                          className={`balance-trends-table__td-value${v < 0 ? " is-negative" : ""}`}
                        >
                          {useNative ? formatNative(v, row.currency) : formatUSD(v)}
                        </td>
                      );
                    })}
                    <td
                      className={`balance-trends-table__td-value is-total${
                        totals[colIdx] < 0 ? " is-negative" : ""
                      }`}
                    >
                      {formatUSD(totals[colIdx])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="balance-trends-empty">
              {columns.length === 0
                ? "Choose a period and click Generate to load balances."
                : "Select one or more accounts above to see their balance trend."}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
