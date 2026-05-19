import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Loader2 } from "lucide-react";
import HierarchyFilter from "../components/HierarchyFilter/HierarchyFilter.jsx";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import { useCoa } from "../hooks/useCoa.js";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./BalanceTrends.css";

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");

const pad2 = (v) => String(v).padStart(2, "0");

const getMonthEndIso = (year, monthIdx) => {
  const d = new Date(Date.UTC(year, monthIdx + 1, 0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

const getTodayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const INTERVALS = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

const PARTIAL_SUFFIX = { month: "MTD", quarter: "QTD", year: "YTD" };

// Quarter-end months are Mar (2), Jun (5), Sep (8), Dec (11).
const isQuarterEnd = (monthIdx) => monthIdx === 2 || monthIdx === 5 || monthIdx === 8 || monthIdx === 11;

// First day of the period that ends on `endIso`, for the given interval.
const getPeriodStartIso = (endIso, interval) => {
  const d = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return endIso;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (interval === "year") return `${y}-01-01`;
  if (interval === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    return `${y}-${pad2(qStartMonth + 1)}-01`;
  }
  return `${y}-${pad2(m + 1)}-01`;
};

const buildEndDateSeries = (fromYear, fromMonthStr, toYear, toMonthStr, interval) => {
  const fromIdx = Math.max(0, Math.min(11, Number(fromMonthStr) - 1));
  const toIdx = Math.max(0, Math.min(11, Number(toMonthStr) - 1));
  const fromAbs = Number(fromYear) * 12 + fromIdx;
  const toAbs = Number(toYear) * 12 + toIdx;
  if (!Number.isFinite(fromAbs) || !Number.isFinite(toAbs) || toAbs < fromAbs) return [];
  const series = [];
  for (let abs = fromAbs; abs <= toAbs; abs += 1) {
    const y = Math.floor(abs / 12);
    const m = abs % 12;
    if (interval === "quarter" && !isQuarterEnd(m)) continue;
    if (interval === "year" && m !== 11) continue;
    series.push(getMonthEndIso(y, m));
  }
  return series;
};

/**
 * Drop columns whose period is entirely in the future; for a column whose
 * period has started but whose end-date is still in the future, fetch the
 * snapshot as of today instead of the period end.
 *
 * Returns [{ label, asOf, isPartial }] where `label` is the original period
 * end-date (used for the column header) and `asOf` is the date passed to
 * the balance endpoint.
 */
const planColumns = (endDates, interval, todayIso) => {
  const planned = [];
  for (const endIso of endDates) {
    if (endIso <= todayIso) {
      planned.push({ label: endIso, asOf: endIso, isPartial: false });
      continue;
    }
    const startIso = getPeriodStartIso(endIso, interval);
    if (startIso <= todayIso) {
      planned.push({ label: endIso, asOf: todayIso, isPartial: true });
    }
    break;
  }
  return planned;
};

const flattenBalanceLeaves = (nodes, out = new Map()) => {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (!n) continue;
    const hasChildren = Array.isArray(n.children) && n.children.length > 0;
    if (hasChildren) {
      flattenBalanceLeaves(n.children, out);
    } else if (n.name) {
      out.set(n.name, {
        currency: n.currency ?? null,
        balanceInUSD: Number.isFinite(Number(n.totalUSD)) ? Number(n.totalUSD) : 0,
      });
    }
  }
  return out;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const formatUSD = (v) => usdFormatter.format(Number.isFinite(v) ? v : 0);

const formatColumnHeader = (iso, interval, isPartial) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const year = d.getUTCFullYear();
  const monthIdx = d.getUTCMonth();
  let base;
  if (interval === "year") {
    base = String(year);
  } else if (interval === "quarter") {
    const q = Math.floor(monthIdx / 3) + 1;
    base = `Q${q} ${String(year).slice(-2)}`;
  } else {
    base = d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return isPartial ? `${base} (${PARTIAL_SUFFIX[interval] ?? "PTD"})` : base;
};

export default function BalanceTrends() {
  const { bsTree } = useCoa();

  // Period — default to This Year (Jan–Dec current year)
  const [fromMonth, setFromMonth] = useState("01");
  const [toMonth, setToMonth] = useState("12");
  const [actualYear, setActualYear] = useState(CURRENT_YEAR);
  const [toYear, setToYear] = useState(CURRENT_YEAR);

  const [intervalKey, setIntervalKey] = useState("month");
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

  // Auto-generate once when the page mounts (matches Balance/CashFlow behavior).
  useEffect(() => {
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    if (!selectedAccounts.length || !columns.length) return [];
    return selectedAccounts.map((name) => {
      const values = columns.map(({ label }) => {
        const entry = reportsByLabel[label]?.get(name);
        return entry ? entry.balanceInUSD : 0;
      });
      // Pick the most recent currency we saw for this account
      let currency = null;
      for (let i = columns.length - 1; i >= 0; i -= 1) {
        const entry = reportsByLabel[columns[i].label]?.get(name);
        if (entry?.currency) {
          currency = entry.currency;
          break;
        }
      }
      return { name, currency, values };
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
    const headers = columns.map(({ label, isPartial }) =>
      `${label}${isPartial ? ` (${PARTIAL_SUFFIX[intervalKey] ?? "PTD"})` : ""}`
    );
    const data = [["Account", "Currency", ...headers]];
    for (const row of rows) {
      data.push([row.name, row.currency ?? "", ...row.values.map((v) => Math.round(v * 100) / 100)]);
    }
    data.push(["Total (selected, USD)", "", ...totals.map((v) => Math.round(v * 100) / 100)]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 36 }, { wch: 8 }, ...headers.map(() => ({ wch: 14 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Trends");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-trends-${actualYear}${fromMonth}-${toYear}${toMonth}-${intervalKey}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [hasTable, columns, rows, totals, actualYear, fromMonth, toYear, toMonth, intervalKey]);

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
                  <th className="balance-trends-table__th-account" rowSpan={1}>
                    Account
                  </th>
                  <th className="balance-trends-table__th-currency">Curr</th>
                  {columns.map((col) => (
                    <th
                      key={col.label}
                      className={`balance-trends-table__th-month${col.isPartial ? " is-partial" : ""}`}
                      title={col.isPartial ? `As of ${col.asOf}` : col.label}
                    >
                      {formatColumnHeader(col.label, intervalKey, col.isPartial)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td className="balance-trends-table__td-account">{row.name}</td>
                    <td className="balance-trends-table__td-currency">
                      {row.currency ?? ""}
                    </td>
                    {row.values.map((v, idx) => (
                      <td
                        key={columns[idx].label}
                        className={`balance-trends-table__td-value${v < 0 ? " is-negative" : ""}`}
                      >
                        {formatUSD(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="balance-trends-table__td-account is-total">
                    Total (selected, USD)
                  </td>
                  <td className="balance-trends-table__td-currency is-total">USD</td>
                  {totals.map((v, idx) => (
                    <td
                      key={columns[idx].label}
                      className={`balance-trends-table__td-value is-total${v < 0 ? " is-negative" : ""}`}
                    >
                      {formatUSD(v)}
                    </td>
                  ))}
                </tr>
              </tfoot>
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
