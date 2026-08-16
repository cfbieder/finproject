import * as XLSX from "xlsx";
import { downloadWorkbook } from "./excelExporter";

/**
 * fbarWorkbook.js — CR082 P3. The FinCEN Form 114 worksheet as .xlsx.
 *
 * Not a filable Form 114 and it says so on the sheet. FinCEN's own form is an
 * Adobe-only XFA document that standard tooling cannot fill, and a look-alike
 * would look official while being worth exactly what this worksheet is worth.
 * This is a transcription aid: the figures, their provenance, and the rate each
 * one was converted at.
 *
 * ── Two things it refuses to do ──
 *
 * 1. **Write a 0 for a figure nobody has.** `excelExporter.js`'s `formatNum`
 *    returns `0` for anything non-finite. Reused as-is here, every "needs a
 *    figure" line would export as `0.00` — a number in a money column, in a
 *    spreadsheet handed to a preparer, claiming the account held nothing. The
 *    CR flagged this before the code existed (§7); the formatter below leaves
 *    the cell EMPTY and puts the reason in its own column.
 *
 * 2. **Export at all while a reportable line has no figure.** A worksheet is
 *    transcribed from, so a hole in it becomes a hole in the filing or, worse, a
 *    zero. The pre-flight refuses and names the lines. Item 15a ("maximum value
 *    unknown") is NOT a hole — it is an answer the form provides for — so it
 *    exports, marked, and does not block.
 *
 * The CSV on the same page deliberately does neither: it is the working dump you
 * export precisely to see what is still outstanding, and it labels holes
 * "NEEDS FIGURE — not zero" rather than refusing. The two exports have different
 * jobs and the difference is intentional.
 */

/**
 * A money cell. `null`/`undefined` becomes an EMPTY cell, never 0 — the whole
 * point of not reusing the shared formatter.
 */
const cell = (n) => (n === null || n === undefined || !Number.isFinite(Number(n))
  ? ""
  : Math.round(Number(n) * 100) / 100);

const SOURCE_LABEL = {
  computed: "computed from the ledger",
  typed: "typed from a statement",
  unknown_15a: "unknown — Form 114 item 15a",
};

/**
 * Reasons a year cannot be exported, as sentences. Empty array ⇒ good to go.
 */
export function fbarExportBlockers(report) {
  if (!report) return ["The report has not loaded."];
  const out = [];
  for (const n of report.needs_attention || []) {
    out.push(`${n.label} — no figure (${n.reason})`);
  }
  // Every currency in play must have a stored rate. This is already covered per
  // line by `no_fx_rate_for_currency_year` above, and is restated as its own
  // check because a rate can be missing for a currency whose only line is
  // separately blocked, and the two would then resolve in the wrong order.
  const haveRate = new Set(
    (report.rates || []).map((r) => String(r.currency).trim())
  );
  for (const l of report.lines || []) {
    if (l.currency && !haveRate.has(l.currency) && !l.max_unknown) {
      out.push(`${l.label} — no ${l.currency} rate stored for ${report.tax_year}`);
    }
  }
  return Array.from(new Set(out));
}

/**
 * Build the workbook. Throws with the blockers listed if the year is not
 * exportable — the caller shows the message rather than a silent no-op.
 *
 * Separate from the download so the sheet's CONTENTS can be asserted. A test
 * that only checks a file appeared cannot see the defect this module exists to
 * prevent, which is a cell reading 0.
 */
export function buildFbarWorkbook(report, taxYear) {
  const blockers = fbarExportBlockers(report);
  if (blockers.length) {
    throw new Error(
      `${blockers.length} line(s) are not ready to export:\n\n${blockers.join("\n")}`
    );
  }

  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-`
    + `${String(today.getDate()).padStart(2, "0")}`;

  const notTreasury = (report.rates || []).filter(
    (r) => r.source !== "treasury" && String(r.currency).trim() !== "USD"
  );

  // ── Sheet 1: the lines ──
  const head = [
    [`FinCEN Form 114 (FBAR) — tax year ${taxYear} working papers`],
    ["NOT a filable Form 114. A transcription worksheet, exported from fin on " + stamp + "."],
    ["MAXIMUM = the highest END-OF-DAY balance across the whole calendar year,"],
    ["including the balance carried in on 1 January. An empty cell is NOT zero."],
    [`Aggregate USD: ${report.aggregate_usd}`
      + (report.aggregate_is_floor
        ? " — a FLOOR: at least one line carries no figure."
        : " — complete.")],
    [report.threshold_exceeded === true
      ? "Over $10,000: every foreign account is reportable, including the zero ones."
      : report.threshold_exceeded === false
        ? "Under $10,000 across a complete set: no FBAR required for this year."
        : "No verdict — the aggregate is a floor, so 'under $10,000' cannot be concluded."],
    [notTreasury.length
      ? `WARNING: ${notTreasury.length} rate(s) are still the ECB prefill, not the `
        + `Treasury 31 December rate FinCEN requires.`
      : "All rates are the Treasury 31 December rates."],
    [],
  ];

  const cols = [
    "Part", "Account", "Institution", "Country", "Currency",
    "Maximum (native)", "Peaked on", "FX rate (USD per 1 unit)", "FX source",
    "Maximum (USD)", "Source", "Warning", "Note",
  ];

  const body = (report.lines || []).map((l) => [
    l.fbar_part || "",
    l.label || "",
    l.institution_name || "",
    l.institution_country || "",
    l.currency || "",
    cell(l.max_native),
    l.max_on || "",
    cell(l.rate_to_usd),
    l.rate_source || "",
    cell(l.max_usd),
    SOURCE_LABEL[l.source] || l.source || "",
    l.warning ? l.warning_detail || l.warning : "",
    l.detail || "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([...head, cols, ...body]);
  ws["!cols"] = [
    { wch: 5 }, { wch: 30 }, { wch: 24 }, { wch: 8 }, { wch: 9 },
    { wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 12 },
    { wch: 16 }, { wch: 26 }, { wch: 46 }, { wch: 30 },
  ];

  // ── Sheet 2: the rates, and where each came from ──
  // On its own sheet rather than in a corner of the first, because the rate and
  // its SOURCE are what a preparer questions first, and "the app said so" is not
  // an answer. The direction is spelled out in the column header: EUR and GBP are
  // plausible numbers in either direction and Treasury publishes the reciprocal.
  const rateRows = (report.rates || [])
    .filter((r) => String(r.currency).trim() !== "USD")
    .map((r) => [
      String(r.currency).trim(),
      cell(r.rate_to_usd),
      r.source,
      r.source === "treasury"
        ? "Treasury 31 December rate — the rate FinCEN requires."
        : "NOT the Treasury rate. Replace before filing.",
      r.note || "",
    ]);
  const wsRates = XLSX.utils.aoa_to_sheet([
    [`Exchange rates applied to tax year ${taxYear}`],
    ["Every figure on the first sheet was converted ONCE, at the rate below."],
    [],
    ["Currency", "USD per 1 unit", "Source", "Status", "Note"],
    ...rateRows,
  ]);
  wsRates["!cols"] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 46 }, { wch: 30 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `FBAR ${taxYear}`);
  XLSX.utils.book_append_sheet(wb, wsRates, "FX rates");
  return wb;
}

/** Build, then hand the file to the browser. */
export function exportFbarWorkbook(report, taxYear) {
  downloadWorkbook(
    buildFbarWorkbook(report, taxYear),
    `fbar-${taxYear}-working-papers.xlsx`
  );
}
