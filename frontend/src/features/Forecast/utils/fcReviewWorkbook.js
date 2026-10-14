/**
 * fcReviewWorkbook.js — the Forecast Review page as an .xlsx workbook.
 *
 * The export used to hand-build its own HTML copy of the table and save it as `.xls`. That
 * copy read `getCellValue` directly, which returns null for every P&L row in the two
 * pre-forecast columns (the table overlays actuals and budget on top via resolveCashValue),
 * so the Actual and Budget columns came out blank; and it stopped at the balance sheet, so
 * Net Assets, the Cash Flow Summary and the Change in Net Assets bridge were missing.
 *
 * This builds the rows from the SAME resolvers the table renders with — resolveCashValue
 * for P&L cells, the page's balance series, computeEquityBridge for the bridge — in the
 * page's order, as real numbers rather than formatted strings.
 *
 * Nominal by design: CR079's banner tells the owner "the Excel export stays nominal".
 */
import * as XLSX from "xlsx";
import { downloadWorkbook } from "../../../utils/excelExporter.js";
import { computeEquityBridge, bridgeHasResidual } from "./fcEquityBridge.js";

const round2 = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// The bridge table prints "—" for anything within 50 cents of zero; the workbook leaves
// those cells blank for the same reason.
const bridgeValue = (v) => (v != null && Math.abs(Number(v)) > 0.5 ? round2(v) : null);

/**
 * The page's rows, in the page's order.
 *
 * @returns {Array<{ type: 'section'|'row'|'blank', label?: string, depth?: number,
 *                   values?: Array<number|null>, bold?: boolean }>}
 */
export function buildForecastReviewRows({
  sortedYears,
  cashRowsWithNet,
  resolveCashValue,
  balanceAccounts,
  balanceDisplayValues,
  totalAssetsByYear,
  netAssetsByYear,
  transferDetailRows,
  balanceAccountMap,
  bankAccountLabels,
  getCellValue,
}) {
  const rows = [];
  const depthOf = (level) => Math.max(0, (Number(level) || 1) - 1);
  const series = (fn) => sortedYears.map((y, i) => round2(fn(y, i)));

  // ── Cash flow (P&L) — actuals and budget overlaid, exactly as the table does ──
  if (cashRowsWithNet?.length) {
    rows.push({ type: "section", label: "Cash Flow" });
    for (const row of cashRowsWithNet) {
      const synthetic = row.isNet || row.isCashFlow;
      rows.push({
        type: "row",
        label: row.isNet ? "Net Cash Flow" : row.isCashFlow ? "Cash Flow" : row.label,
        depth: synthetic ? 0 : depthOf(row.level),
        bold: synthetic || row.level === 1,
        values: series((y) => resolveCashValue(row, y)),
      });
    }
    rows.push({ type: "blank" });
  }

  // ── Net Assets + balance sheet ──
  if (balanceAccounts?.length) {
    rows.push({
      type: "row", label: "Net Assets", depth: 0, bold: true,
      values: series((_, i) => netAssetsByYear?.[i] ?? 0),
    });
    rows.push({ type: "blank" });
    rows.push({ type: "section", label: "Balance Sheet" });
    for (const row of balanceAccounts) {
      const values = row.label === "Assets" ? totalAssetsByYear : balanceDisplayValues?.get(row.label);
      rows.push({
        type: "row",
        label: row.label,
        depth: depthOf(row.level),
        bold: row.level === 1,
        values: series((y, i) => values?.[i] ?? getCellValue(row, y, false)),
      });
    }
    rows.push({ type: "blank" });
  }

  if (!cashRowsWithNet?.length) return rows;

  // ── Cash Flow Summary ──
  rows.push({ type: "section", label: "Cash Flow Summary" });
  rows.push({ type: "row", label: "Income", depth: 0, bold: true,
    values: series((y) => resolveCashValue({ label: "Income", level: 1 }, y)) });
  rows.push({ type: "row", label: "Expense", depth: 0, bold: true,
    values: series((y) => resolveCashValue({ label: "Expense", level: 1 }, y)) });
  rows.push({ type: "row", label: "Transfers", depth: 1,
    values: series((y) => resolveCashValue({ label: "Transfers", level: 2 }, y)) });
  for (const detail of (transferDetailRows || [])) {
    rows.push({ type: "row", label: detail.module, depth: 2,
      values: series((_, i) => detail.values?.[i]) });
  }
  rows.push({ type: "row", label: "Net Cash Flow", depth: 0, bold: true,
    values: series((y) => resolveCashValue({ isNet: true }, y)) });
  rows.push({ type: "blank" });

  // ── Change in Net Assets ──
  const bridge = computeEquityBridge({
    sortedYears, resolveCashValue, transferDetailRows, netAssetsByYear,
    balanceDisplayValues, balanceAccountMap, bankAccountLabels, balanceAccounts,
  });
  const bridgeRow = (label, values, depth, bold = false) =>
    rows.push({ type: "row", label, depth, bold, values: values.map(bridgeValue) });
  rows.push({ type: "section", label: "Change in Net Assets" });
  bridgeRow("Operating Cash Flow", bridge.operating, 1);
  bridgeRow("Unrealized Gains / (Losses)", bridge.unrealTotal, 1);
  for (const line of bridge.lineRows) bridgeRow(line.label, line.values, 2);
  if (bridgeHasResidual(bridge)) bridgeRow("Other (unattributed)", bridge.residual, 2);
  bridgeRow("Total Change in Net Assets", bridge.totalChange, 0, true);

  return rows;
}

const NUM_FMT = "#,##0;(#,##0)";

/** Rows → worksheet: title block, year header, basis row, optional age row, then the rows. */
export function forecastReviewSheet({ scenario, sortedYears, yearBasis, birthYear, rows }) {
  const aoa = [
    [`Forecast Review — ${scenario}`],
    [`Years ${sortedYears[0]}–${sortedYears[sortedYears.length - 1]} · nominal dollars`],
    [],
    ["Account", ...sortedYears.map(Number)],
    ["Basis", ...sortedYears.map((y) => yearBasis?.[y] || "Forecast")],
  ];
  if (birthYear) aoa.push(["Age", ...sortedYears.map((y) => Number(y) - birthYear)]);
  const firstDataRow = aoa.length;

  for (const row of rows) {
    if (row.type === "blank") aoa.push([]);
    else if (row.type === "section") aoa.push([row.label.toUpperCase()]);
    else aoa.push([`${"    ".repeat(row.depth || 0)}${row.label}`, ...row.values]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Number format on the money cells only — the header, basis and age rows stay plain.
  for (let r = firstDataRow; r < aoa.length; r++) {
    for (let c = 1; c <= sortedYears.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = NUM_FMT;
    }
  }
  ws["!cols"] = [{ wch: 40 }, ...sortedYears.map(() => ({ wch: 14 }))];
  return ws;
}

/** The Cash Health panel, both tabs, one row per warning. */
export function forecastWarningsSheet(warnings = []) {
  const aoa = [
    ["Section", "Severity", "Issue", "Detail", "Years", "Amount"],
    ...warnings.map((w) => [
      w.kind === "advisory" ? "Assumptions to consider" : "Integrity",
      w.severity || "",
      w.title || "",
      w.detail || "",
      (w.years || []).join(", "),
      w.amount == null ? null : round2(w.amount),
    ]),
  ];
  if (!warnings.length) aoa.push(["", "", "No issues"]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 50 }, { wch: 90 }, { wch: 18 }, { wch: 14 }];
  return ws;
}

export function exportForecastReview({ scenario, warnings, ...ctx }) {
  const rows = buildForecastReviewRows(ctx);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, forecastReviewSheet({ scenario, rows, ...ctx }), "Forecast Review");
  XLSX.utils.book_append_sheet(wb, forecastWarningsSheet(warnings), "Cash Health");
  const safe = String(scenario || "export")
    .replace(/[^a-z0-9\-._\s]/gi, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  downloadWorkbook(wb, `ForecastReview-${safe || "export"}.xlsx`);
}
