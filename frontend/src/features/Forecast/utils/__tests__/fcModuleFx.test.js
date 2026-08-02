import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fxRateOnRow, resolveFxRate, localToUsd } from "../fcModuleFx.js";

// The live document's shape, copied from prod's `forecast_assumptions` FX row.
const LIVE_FX = [
  { Year: 2026, Rates: { EUR: 0.86, PLN: 3.9 }, Scenario: "2026 Base" },
  { Year: 2026, Rates: { EUR: 0.86, PLN: 3.9 }, Scenario: "2026 Downside" },
  { Year: 2027, Rates: { EUR: 0.9, PLN: 4.5 }, Scenario: "2026 Downside" },
];

// The retired FCAssump.json spelling, which is all the editor used to read.
const LEGACY_FX = [
  { Year: 2026, Rates: { USDEUR: 0.86, USDPLN: 3.9 }, Scenario: "2026 Base" },
];

describe("fxRateOnRow", () => {
  it("reads the live PLN/EUR spelling", () => {
    expect(fxRateOnRow(LIVE_FX[0], "PLN")).toBe(3.9);
    expect(fxRateOnRow(LIVE_FX[0], "EUR")).toBe(0.86);
  });

  it("still reads the legacy USDPLN/USDEUR spelling", () => {
    expect(fxRateOnRow(LEGACY_FX[0], "PLN")).toBe(3.9);
    expect(fxRateOnRow(LEGACY_FX[0], "EUR")).toBe(0.86);
  });

  it("reports a missing or zero rate as absent, never as 1", () => {
    expect(fxRateOnRow({ Rates: {} }, "PLN")).toBeNull();
    expect(fxRateOnRow({}, "PLN")).toBeNull();
    expect(fxRateOnRow(undefined, "PLN")).toBeNull();
    // Zero would divide to Infinity here, exactly as it fails loud in the engine (CR051 F1).
    expect(fxRateOnRow({ Rates: { PLN: 0 } }, "PLN")).toBeNull();
  });
});

describe("resolveFxRate", () => {
  const forScenario = (scenario, currency, year) =>
    resolveFxRate({ fxRows: LIVE_FX, scenario, currency, year });

  it("returns 1 for USD without consulting the document", () => {
    expect(resolveFxRate({ fxRows: [], scenario: "x", currency: "USD", year: 2026 })).toBe(1);
  });

  it("takes the latest row at or before the year", () => {
    expect(forScenario("2026 Downside", "PLN", 2026)).toBe(3.9);
    expect(forScenario("2026 Downside", "PLN", 2027)).toBe(4.5);
    expect(forScenario("2026 Downside", "PLN", 2030)).toBe(4.5);
  });

  it("does not read another scenario's rates", () => {
    expect(forScenario("2026 Base", "PLN", 2030)).toBe(3.9);
    expect(forScenario("No Such Scenario", "PLN", 2026)).toBeNull();
  });

  it("falls back to the earliest defined rate for a year before every row", () => {
    expect(forScenario("2026 Downside", "EUR", 2020)).toBe(0.86);
  });

  it("returns null — not 1 — when the scenario has no usable rate", () => {
    expect(resolveFxRate({ fxRows: LIVE_FX, scenario: "2026 Base", currency: "GBP", year: 2026 }))
      .toBeNull();
    expect(resolveFxRate({ fxRows: undefined, scenario: "2026 Base", currency: "PLN", year: 2026 }))
      .toBeNull();
  });
});

describe("localToUsd", () => {
  it("divides by the scenario rate for an unmatched module", () => {
    // The regression this whole file exists for: 390,000 EUR at 0.86 is ~$453,488,
    // not $390,000. The old code found no rate, fell back to 1, and multiplied.
    const usd = localToUsd({
      localNumber: 390000,
      isMatched: false,
      accountValueRatio: null,
      fxRate: resolveFxRate({
        fxRows: LIVE_FX,
        scenario: "2026 Base",
        currency: "EUR",
        year: 2026,
      }),
    });
    expect(usd).toBeCloseTo(453488.37, 2);
    expect(usd).not.toBe(390000);
  });

  it("multiplies by the balance-sheet ratio for a matched module", () => {
    // Barkeria: 3,918,992 PLN / 1,090,942 USD in prod — the ledger's own ratio,
    // which is USD per unit and so multiplies. Both rates are present here to prove
    // the matched branch ignores the scenario rate rather than compounding the two.
    expect(
      localToUsd({
        localNumber: 3918992,
        isMatched: true,
        accountValueRatio: 1090942 / 3918992,
        fxRate: 3.9,
      })
    ).toBeCloseTo(1090942, 0);
  });

  it("falls back to the scenario rate when a matched module's balance has not loaded", () => {
    expect(
      localToUsd({ localNumber: 3900, isMatched: true, accountValueRatio: null, fxRate: 3.9 })
    ).toBe(1000);
  });

  it("returns '' when there is nothing to convert", () => {
    expect(localToUsd({ localNumber: null, isMatched: false, accountValueRatio: null, fxRate: 3.9 })).toBe("");
    expect(localToUsd({ localNumber: "", isMatched: false, accountValueRatio: null, fxRate: 3.9 })).toBe("");
  });

  it("returns undefined — leave the stored value alone — when there is no rate", () => {
    expect(
      localToUsd({ localNumber: 390000, isMatched: false, accountValueRatio: null, fxRate: null })
    ).toBeUndefined();
  });
});

describe("the three FX readers agree on the key spelling", () => {
  // The bug was not the fallback logic, it was that this file was the only reader
  // of the FX document that did not accept the live spelling. Assert the other two
  // still read both, so a future edit cannot re-open the gap from the other side.
  const repoFile = (rel) =>
    fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..", rel),
      "utf8"
    );

  it("the engine reads PLN ?? USDPLN", () => {
    const src = repoFile("server/src/services/forecast/fcbuilder-setup.js");
    expect(src).toMatch(/Rates\.PLN\s*\?\?\s*entry\.Rates\.USDPLN/);
    expect(src).toMatch(/Rates\.EUR\s*\?\?\s*entry\.Rates\.USDEUR/);
  });

  it("the expenses page reads PLN ?? USDPLN", () => {
    const src = repoFile("frontend/src/pages/FCExpSetup.jsx");
    expect(src).toMatch(/PLN\s*\?\?\s*rates\.USDPLN/);
    expect(src).toMatch(/EUR\s*\?\?\s*rates\.USDEUR/);
  });
});
