import { describe, test, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildFbarWorkbook, fbarExportBlockers } from "../fbarWorkbook";

/**
 * CR082 §10 — the two gates on the export.
 *
 * The defect being guarded is not a crash, it is a NUMBER: `excelExporter.js`'s
 * `formatNum` returns 0 for anything non-finite, so reusing it would have put
 * `0.00` in the Maximum column of every line nobody has a figure for. In a
 * spreadsheet handed to a preparer that reads as "this account held nothing all
 * year", which is a claim. So the assertions here are about cell CONTENTS, not
 * about a file being produced.
 */

const complete = {
  tax_year: 2025,
  aggregate_usd: 175843,
  aggregate_is_floor: false,
  threshold_exceeded: true,
  rates: [
    { currency: "PLN", rate_to_usd: 0.278373, source: "treasury", note: null },
    { currency: "USD", rate_to_usd: 1, source: "treasury", note: null },
  ],
  needs_attention: [],
  unknown_15a: [],
  warnings: [],
  lines: [
    {
      designation_id: 1, label: "PKO", institution_name: "PKO BP",
      institution_country: "PL", currency: "PLN", fbar_part: "III",
      max_native: 631678.72, max_on: "2025-12-23", rate_to_usd: 0.278373,
      rate_source: "treasury", max_usd: 175843, source: "computed",
      warning: null, warning_detail: null, detail: null, max_unknown: false,
    },
  ],
};

const sheetRows = (wb, name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });

describe("fbarExportBlockers", () => {
  test("a complete year has none", () => {
    expect(fbarExportBlockers(complete)).toEqual([]);
  });

  test("a line with no figure blocks the export and is named", () => {
    const report = {
      ...complete,
      needs_attention: [
        { designation_id: 2, label: "Erste 1791", reason: "report_only_needs_typed_figure" },
      ],
    };
    const blockers = fbarExportBlockers(report);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("Erste 1791");
  });

  test("a currency with no stored rate blocks the export", () => {
    const report = {
      ...complete,
      rates: [{ currency: "USD", rate_to_usd: 1, source: "treasury", note: null }],
    };
    expect(fbarExportBlockers(report).join(" ")).toMatch(/no PLN rate stored for 2025/);
  });

  test("15a is an answer, not a hole — it does not block", () => {
    // The form provides for "maximum value unknown". Treating it as outstanding
    // would mean the only way to file one was to override the guard protecting
    // every other line.
    const report = {
      ...complete,
      aggregate_is_floor: true,
      unknown_15a: [{ designation_id: 3, label: "Company account" }],
      lines: [
        ...complete.lines,
        {
          designation_id: 3, label: "Company account", currency: "PLN",
          fbar_part: "IV", max_native: null, max_usd: null, max_unknown: true,
          source: "unknown_15a", warning: null, detail: null,
        },
      ],
    };
    expect(fbarExportBlockers(report)).toEqual([]);
  });
});

describe("buildFbarWorkbook", () => {
  test("refuses to build while a line has no figure", () => {
    const report = {
      ...complete,
      needs_attention: [{ designation_id: 2, label: "Erste 1791", reason: "engine_refused" }],
    };
    expect(() => buildFbarWorkbook(report, 2025)).toThrow(/Erste 1791/);
  });

  test("a 15a line exports with an EMPTY maximum cell, never 0", () => {
    const report = {
      ...complete,
      aggregate_is_floor: true,
      unknown_15a: [{ designation_id: 3, label: "Company account" }],
      lines: [
        ...complete.lines,
        {
          designation_id: 3, label: "Company account", institution_name: "OCME",
          institution_country: "PL", currency: "PLN", fbar_part: "IV",
          max_native: null, max_on: null, rate_to_usd: null, rate_source: null,
          max_usd: null, max_unknown: true, source: "unknown_15a",
          warning: null, warning_detail: null, detail: null,
        },
      ],
    };
    const wb = buildFbarWorkbook(report, 2025);
    const rows = sheetRows(wb, "FBAR 2025");
    const line = rows.find((r) => r && r[1] === "Company account");
    expect(line).toBeDefined();

    // Maximum (native) is column 5, Maximum (USD) is column 9. Both must be
    // empty — this is the whole test.
    expect(line[5]).not.toBe(0);
    expect(line[9]).not.toBe(0);
    expect(line[5] === "" || line[5] === null).toBe(true);
    expect(line[9] === "" || line[9] === null).toBe(true);
    expect(line[10]).toMatch(/item 15a/);

    // And the computed line still carries its real figures.
    const pko = rows.find((r) => r && r[1] === "PKO");
    expect(pko[5]).toBe(631678.72);
    expect(pko[9]).toBe(175843);
  });

  test("a genuine zero maximum is still written as 0", () => {
    // The other direction, and the reason this cannot just blank every falsy
    // value: a credit card that was never in credit reports 0, and that 0 is a
    // measured answer the form carries.
    const report = {
      ...complete,
      lines: [{ ...complete.lines[0], label: "PKO Visa", max_native: 0, max_usd: 0 }],
    };
    const rows = sheetRows(buildFbarWorkbook(report, 2025), "FBAR 2025");
    const line = rows.find((r) => r && r[1] === "PKO Visa");
    expect(line[5]).toBe(0);
    expect(line[9]).toBe(0);
  });

  test("the rate sheet names the source, and flags a prefill as not-Treasury", () => {
    const report = {
      ...complete,
      rates: [
        { currency: "PLN", rate_to_usd: 0.278373, source: "frankfurter-prefill", note: null },
      ],
    };
    const rows = sheetRows(buildFbarWorkbook(report, 2025), "FX rates");
    const pln = rows.find((r) => r && r[0] === "PLN");
    expect(pln[2]).toBe("frankfurter-prefill");
    expect(pln[3]).toMatch(/NOT the Treasury rate/);
  });

  test("the header states the aggregate is a floor when any line lacks a figure", () => {
    const report = {
      ...complete,
      aggregate_is_floor: true,
      unknown_15a: [{ designation_id: 3, label: "Company account" }],
      lines: [
        ...complete.lines,
        {
          designation_id: 3, label: "Company account", currency: "PLN",
          max_native: null, max_usd: null, max_unknown: true, source: "unknown_15a",
        },
      ],
    };
    const rows = sheetRows(buildFbarWorkbook(report, 2025), "FBAR 2025");
    expect(rows.flat().join(" ")).toMatch(/FLOOR/);
  });

  test("the sheet says it is not a filable form", () => {
    const rows = sheetRows(buildFbarWorkbook(complete, 2025), "FBAR 2025");
    expect(rows.flat().join(" ")).toMatch(/NOT a filable Form 114/);
  });
});
