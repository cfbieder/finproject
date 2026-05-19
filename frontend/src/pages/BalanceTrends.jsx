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

const buildMonthEndSeries = (year, fromMonthStr, toMonthStr) => {
  const fromIdx = Math.max(0, Math.min(11, Number(fromMonthStr) - 1));
  const toIdx = Math.max(fromIdx, Math.min(11, Number(toMonthStr) - 1));
  const series = [];
  for (let m = fromIdx; m <= toIdx; m += 1) {
    series.push(getMonthEndIso(year, m));
  }
  return series;
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

const formatMonthHeader = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

export default function BalanceTrends() {
  const { bsTree } = useCoa();

  // Period — default to This Year (Jan–Dec current year)
  const [fromMonth, setFromMonth] = useState("01");
  const [toMonth, setToMonth] = useState("12");
  const [actualYear, setActualYear] = useState(CURRENT_YEAR);

  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [monthEnds, setMonthEnds] = useState([]);
  const [reportsByMonth, setReportsByMonth] = useState({});
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
  }, []);

  const handleGenerate = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const series = buildMonthEndSeries(actualYear, fromMonth, toMonth);
      const reports = await Promise.all(
        series.map((date) => Rest.fetchBalanceReport(date))
      );
      const nextByMonth = {};
      series.forEach((date, idx) => {
        nextByMonth[date] = flattenBalanceLeaves(reports[idx]);
      });
      setMonthEnds(series);
      setReportsByMonth(nextByMonth);
    } catch (err) {
      console.error("[BalanceTrends] generate failed:", err);
      setError(err?.message ?? "Failed to fetch balance trends");
      setMonthEnds([]);
      setReportsByMonth({});
    } finally {
      setIsLoading(false);
    }
  }, [actualYear, fromMonth, toMonth]);

  // Auto-generate once when the page mounts (matches Balance/CashFlow behavior).
  useEffect(() => {
    handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    if (!selectedAccounts.length || !monthEnds.length) return [];
    return selectedAccounts.map((name) => {
      const values = monthEnds.map((date) => {
        const entry = reportsByMonth[date]?.get(name);
        return entry ? entry.balanceInUSD : 0;
      });
      // Pick the most recent currency we saw for this account
      let currency = null;
      for (let i = monthEnds.length - 1; i >= 0; i -= 1) {
        const entry = reportsByMonth[monthEnds[i]]?.get(name);
        if (entry?.currency) {
          currency = entry.currency;
          break;
        }
      }
      return { name, currency, values };
    });
  }, [selectedAccounts, monthEnds, reportsByMonth]);

  const totals = useMemo(() => {
    if (!rows.length) return [];
    return monthEnds.map((_, colIdx) =>
      rows.reduce((sum, row) => sum + (row.values[colIdx] || 0), 0)
    );
  }, [rows, monthEnds]);

  const hasTable = rows.length > 0 && monthEnds.length > 0;

  const handleExport = useCallback(() => {
    if (!hasTable) return;
    const header = ["Account", "Currency", ...monthEnds];
    const data = [header];
    for (const row of rows) {
      data.push([row.name, row.currency ?? "", ...row.values.map((v) => Math.round(v * 100) / 100)]);
    }
    data.push(["Total (selected, USD)", "", ...totals.map((v) => Math.round(v * 100) / 100)]);
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = header.map((_, i) => (i === 0 ? { wch: 36 } : { wch: 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance Trends");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-trends-${actualYear}-${fromMonth}-${toMonth}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [hasTable, monthEnds, rows, totals, actualYear, fromMonth, toMonth]);

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
            defaultPreset="this-year"
            hideBudgetYear
          />
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
                  {monthEnds.map((date) => (
                    <th key={date} className="balance-trends-table__th-month" title={date}>
                      {formatMonthHeader(date)}
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
                        key={monthEnds[idx]}
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
                      key={monthEnds[idx]}
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
              {monthEnds.length === 0
                ? "Choose a period and click Generate to load month-end balances."
                : "Select one or more accounts above to see their month-end balance trend."}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
