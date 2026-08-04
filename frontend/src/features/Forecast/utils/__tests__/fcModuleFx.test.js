import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fxRateOnRow, resolveFxRate, localToUsd, allocateBudget,
  resolveInflationRate, firstForecastYearAmount,
} from "../fcModuleFx.js";

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

  // RETIRED by CR069 P3 — "the expenses page reads PLN ?? USDPLN".
  //
  // CR064 P0 found THREE readers of the FX assumptions and one using the wrong spelling; this
  // test pinned the third. `FCExpSetup.jsx` is deleted (an Expenditure item is a module now),
  // so there are two readers left and both are covered: the engine by the test above, and
  // `resolveFxRate` by every case in this file. Deleting the page deletes its obligation —
  // keeping an assertion against a file that cannot exist would just fail for the wrong reason.
});

describe("allocateBudget", () => {
  // Prod's live rates, and the module that proves the bug.
  const rateFor = (ccy) => ({ USD: 1, PLN: 3.9, EUR: 0.86 }[ccy] ?? null);

  it("shows a USD budget in the module's own currency", () => {
    // United Beverages: the UB Dividend budget is 690,000 PLN = 192,266 USD, and the
    // hint used to print the USD figure beside a field the engine reads as PLN. The
    // owner matched the digits and the hint said "Remaining: -0".
    const a = allocateBudget({
      budgetUSD: 192266, moduleCurrency: "PLN", others: [], thisAmount: 0, rateFor,
    });
    expect(a.budget).toBeCloseTo(749837.4, 1);   // ≈ the 690,000 PLN budget at 3.9
    expect(a.budgetUSD).toBe(192266);
    expect(a.canConvert).toBe(true);
  });

  it("does NOT reconcile when a USD figure is typed into a PLN field", () => {
    const a = allocateBudget({
      budgetUSD: 192266, moduleCurrency: "PLN", others: [], thisAmount: 192266, rateFor,
    });
    // The old hint made this exactly 0. It is really about three quarters unallocated.
    expect(Math.round(a.remaining)).toBe(557571);
    expect(a.remaining).toBeGreaterThan(0);
  });

  it("reconciles to zero when the PLN amount really does match the budget", () => {
    const a = allocateBudget({
      budgetUSD: 192266, moduleCurrency: "PLN", others: [], thisAmount: 749837.4, rateFor,
    });
    expect(Math.round(a.remaining)).toBe(0);
  });

  it("is unchanged for a USD module — the common case must not move", () => {
    const a = allocateBudget({
      budgetUSD: 100000, moduleCurrency: "USD",
      others: [{ amount: 30000, currency: "USD" }], thisAmount: 20000, rateFor,
    });
    expect(a.budget).toBe(100000);
    expect(a.others).toBe(30000);
    expect(a.remaining).toBe(50000);
  });

  it("converts each other module from ITS OWN currency, not the current one", () => {
    // The four properties share one expense line: 20,000 PLN + 2,500 + 5,000 + 2,500 EUR.
    // Adding those digits together (the old behaviour) gives a meaningless 30,000.
    const a = allocateBudget({
      budgetUSD: 64704, moduleCurrency: "EUR",
      others: [
        { amount: 20000, currency: "PLN" },   // ≈ 5,128 USD
        { amount: 5000, currency: "EUR" },    // ≈ 5,814 USD
        { amount: 2500, currency: "EUR" },    // ≈ 2,907 USD
      ],
      thisAmount: 2500, rateFor,
    });
    expect(a.others / 0.86).toBeCloseTo(5128.2 + 5813.95 + 2906.98, 1);
    expect(Math.round(a.remaining / 0.86)).toBe(Math.round(64704 - 13849.13 - 2906.98));
  });

  it("EXCLUDES a row it cannot convert and says how many", () => {
    // Adding it in as though it were USD is the same bug one level down.
    const a = allocateBudget({
      budgetUSD: 100000, moduleCurrency: "USD",
      others: [{ amount: 50000, currency: "GBP" }, { amount: 10000, currency: "USD" }],
      thisAmount: 0, rateFor,
    });
    expect(a.unconvertible).toBe(1);
    expect(a.others).toBe(10000);
    expect(a.remaining).toBe(90000);
  });

  it("reports canConvert=false rather than inventing a rate", () => {
    const a = allocateBudget({
      budgetUSD: 100000, moduleCurrency: "GBP", others: [], thisAmount: 5000, rateFor,
    });
    expect(a.canConvert).toBe(false);
    expect(a.budget).toBeNull();
    expect(a.remaining).toBeNull();
    expect(a.budgetUSD).toBe(100000);
  });

  it("treats the amount's sign as immaterial — expenses are stored negative", () => {
    const pos = allocateBudget({ budgetUSD: 1000, moduleCurrency: "USD", thisAmount: 400, rateFor });
    const neg = allocateBudget({ budgetUSD: 1000, moduleCurrency: "USD", thisAmount: -400, rateFor });
    expect(neg.remaining).toBe(pos.remaining);
  });
});

describe("resolveInflationRate", () => {
  // Prod's shape: one row per scenario, carried forward for the whole horizon.
  const ROWS = [
    { Rate: 2.5, Year: 2026, Scenario: "2026 Base" },
    { Rate: 2.5, Year: 2026, Scenario: "2026 Downside" },
    { Rate: 4, Year: 2030, Scenario: "2026 Downside" },
  ];

  it("carries the base-year rate forward, like the engine's buildRates", () => {
    expect(resolveInflationRate({ inflationRows: ROWS, scenario: "2026 Base", year: 2027 })).toBe(2.5);
    expect(resolveInflationRate({ inflationRows: ROWS, scenario: "2026 Base", year: 2062 })).toBe(2.5);
  });

  it("takes the latest entry at or before the year", () => {
    expect(resolveInflationRate({ inflationRows: ROWS, scenario: "2026 Downside", year: 2029 })).toBe(2.5);
    expect(resolveInflationRate({ inflationRows: ROWS, scenario: "2026 Downside", year: 2031 })).toBe(4);
  });

  it("falls back to the earliest rate for a year before every row", () => {
    expect(resolveInflationRate({ inflationRows: ROWS, scenario: "2026 Base", year: 2020 })).toBe(2.5);
  });

  it("returns null — never 0% — when the scenario has no inflation path", () => {
    // A rename used to strand exactly this (CR064 §2); reading it as 0% is the bug.
    expect(resolveInflationRate({ inflationRows: ROWS, scenario: "Renamed", year: 2027 })).toBeNull();
    expect(resolveInflationRate({ inflationRows: [], scenario: "x", year: 2027 })).toBeNull();
  });
});

describe("firstForecastYearAmount", () => {
  it("grows a base-year amount by inflation", () => {
    expect(firstForecastYearAmount({ baseAmount: 500000, inflationPct: 2.5 })).toBeCloseTo(512500, 6);
  });

  it("applies the income growth multiplier", () => {
    expect(firstForecastYearAmount({ baseAmount: 500000, inflationPct: 2.5, growthMultiplier: 0.5 }))
      .toBeCloseTo(506250, 6);
    expect(firstForecastYearAmount({ baseAmount: 500000, inflationPct: 2.5, growthMultiplier: 0 }))
      .toBeCloseTo(500000, 6);
  });

  it("treats a blank multiplier as 1", () => {
    for (const m of [null, undefined, ""]) {
      expect(firstForecastYearAmount({ baseAmount: 100, inflationPct: 10, growthMultiplier: m })).toBeCloseTo(110, 9);
    }
  });

  it("returns null when there is nothing to derive from", () => {
    expect(firstForecastYearAmount({ baseAmount: 0, inflationPct: 2.5 })).toBeNull();
    expect(firstForecastYearAmount({ baseAmount: null, inflationPct: 2.5 })).toBeNull();
    // No inflation path is not 0% growth — it is "cannot say".
    expect(firstForecastYearAmount({ baseAmount: 500000, inflationPct: null })).toBeNull();
  });
});
