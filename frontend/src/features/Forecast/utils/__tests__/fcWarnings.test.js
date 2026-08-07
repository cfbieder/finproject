import { describe, it, expect } from "vitest";
import * as wf from "../fcWarnings.js";
import {
  computeForecastWarnings,
  computeLoanWarnings,
  computeModuleIntegrityWarnings,
  formatMoney,
  formatYearList,
} from "../fcWarnings.js";

const YEARS = [2025, 2026, 2027];

/** A healthy scenario: one ranked module, cash comfortably above the band. */
function healthy(overrides = {}) {
  return {
    years: YEARS,
    bankBalanceByYear: [400000, 410000, 420000],
    entries: [
      { Year: 2025, Account: "Fidelity Fixed Income", Amount: 1000000, Module: "FI" },
      { Year: 2026, Account: "Fidelity Fixed Income", Amount: 1050000, Module: "FI" },
      { Year: 2027, Account: "Fidelity Fixed Income", Amount: 1100000, Module: "FI" },
    ],
    modules: [
      { Name: "Fidelity Fixed Income", Account: "Fidelity Fixed Income", CashSweepPriority: 1 },
    ],
    cashSweepLow: 300000,
    ...overrides,
  };
}

const ids = (ws) => ws.map((w) => w.id);

describe("computeForecastWarnings", () => {
  it("returns nothing for a healthy scenario", () => {
    expect(computeForecastWarnings(healthy())).toEqual([]);
  });

  it("returns nothing when there are no years (nothing generated yet)", () => {
    expect(computeForecastWarnings({ ...healthy(), years: [] })).toEqual([]);
  });

  it("flags a scenario with no priority-1 module (the CR045 copy bug)", () => {
    const ws = computeForecastWarnings(
      healthy({
        modules: [
          { Name: "Fidelity Fixed Income", Account: "Fidelity Fixed Income", CashSweepPriority: null },
          { Name: "Fidelity Stocks", Account: "Fidelity Stock", CashSweepPriority: "" },
        ],
      })
    );
    expect(ids(ws)).toContain("no-sweep-module");
    expect(ws[0].severity).toBe("error");
  });

  it("does not flag a missing primary when a backup exists but no rank 1", () => {
    // Rank 2 without a rank 1 is still 'no primary' — the sweep has no deposit target.
    const ws = computeForecastWarnings(
      healthy({
        modules: [{ Name: "Stocks", Account: "Fidelity Stock", CashSweepPriority: 2 }],
      })
    );
    expect(ids(ws)).toContain("no-sweep-module");
  });

  it("stays quiet on a scenario with no modules at all", () => {
    const ws = computeForecastWarnings(healthy({ modules: [] }));
    expect(ids(ws)).not.toContain("no-sweep-module");
  });

  it("aggregates unfunded Cash Shortfall entries by year", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          ...healthy().entries,
          { Year: 2026, Account: "Cash Shortfall", Amount: -100000, Module: "_cash_sweep" },
          { Year: 2027, Account: "Cash Shortfall", Amount: -250000, Module: "_cash_sweep" },
        ],
      })
    );
    const w = ws.find((x) => x.id === "unfunded-shortfall");
    expect(w.severity).toBe("error");
    expect(w.years).toEqual([2026, 2027]);
    expect(w.amount).toBe(-350000);
  });

  it("flags years where the bank balance goes negative, reporting the worst", () => {
    const ws = computeForecastWarnings(
      healthy({ bankBalanceByYear: [400000, -50000, -900000] })
    );
    const w = ws.find((x) => x.id === "negative-cash");
    expect(w.years).toEqual([2026, 2027]);
    expect(w.amount).toBe(-900000);
  });

  it("flags cash below the low band but not years already reported as negative", () => {
    const ws = computeForecastWarnings(
      healthy({ bankBalanceByYear: [400000, 250000, -10000] })
    );
    const below = ws.find((x) => x.id === "below-low-band");
    expect(below.severity).toBe("warning");
    expect(below.years).toEqual([2026]); // 2027 is negative-cash, not double-reported
  });

  it("skips the low-band check when the band is unknown", () => {
    const ws = computeForecastWarnings(
      healthy({ bankBalanceByYear: [400000, 250000, 260000], cashSweepLow: null })
    );
    expect(ids(ws)).not.toContain("below-low-band");
  });

  it("flags a ranked module drained to zero", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          { Year: 2025, Account: "Fidelity Fixed Income", Amount: 1000000 },
          { Year: 2026, Account: "Fidelity Fixed Income", Amount: 500000 },
          { Year: 2027, Account: "Fidelity Fixed Income", Amount: 0 },
        ],
      })
    );
    const w = ws.find((x) => x.id === "sweep-source-exhausted");
    expect(w.years).toEqual([2027]);
    expect(w.detail).toContain("Fidelity Fixed Income (priority 1) is drained to zero by 2027");
  });

  it("does not call a module exhausted if it was never funded", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          { Year: 2025, Account: "Fidelity Fixed Income", Amount: 0 },
          { Year: 2026, Account: "Fidelity Fixed Income", Amount: 0 },
        ],
      })
    );
    expect(ids(ws)).not.toContain("sweep-source-exhausted");
  });

  it("nets sweep withdrawals against the module's market value (the -$2,454 artifact)", () => {
    // Mirrors prod: the builder still books MV, the sweep books a bigger withdrawal.
    const ws = computeForecastWarnings(
      healthy({
        modules: [{ Name: "Fidelity Stocks", Account: "Fidelity Stock", CashSweepPriority: 1 }],
        entries: [
          { Year: 2025, Account: "Fidelity Stock", Amount: 1369072, Module: "Fidelity Stocks" },
          { Year: 2026, Account: "Fidelity Stock", Amount: 1237933, Module: "Fidelity Stocks" },
          { Year: 2026, Account: "Fidelity Stock", Amount: -1240387, Module: "_sweep_bal" },
        ],
      })
    );
    const w = ws.find((x) => x.id === "module-over-drained");
    expect(w.severity).toBe("warning");
    expect(w.years).toEqual([2026]);
    expect(Math.round(w.amount)).toBe(-2454);
  });

  it("reproduces the prod '2026 with House Purchase' shape: errors first, all three", () => {
    const ws = computeForecastWarnings(
      healthy({
        modules: [
          { Name: "Fidelity Fixed Income", Account: "Fidelity Fixed Income", CashSweepPriority: null },
          { Name: "Fidelity Stocks", Account: "Fidelity Stock", CashSweepPriority: null },
        ],
        bankBalanceByYear: [400000, -535123, -3743004],
        entries: [
          { Year: 2026, Account: "Cash Shortfall", Amount: -935123, Module: "_cash_sweep" },
          { Year: 2027, Account: "Cash Shortfall", Amount: -3207881, Module: "_cash_sweep" },
        ],
      })
    );
    expect(ids(ws)).toEqual(["no-sweep-module", "unfunded-shortfall", "negative-cash"]);
    expect(ws.every((w) => w.severity === "error")).toBe(true);
  });
});

describe("formatMoney", () => {
  it("renders millions, thousands and units, negatives in parens", () => {
    expect(formatMoney(-3350000)).toBe("($3.4M)");
    expect(formatMoney(300000)).toBe("$300K");
    expect(formatMoney(-2454)).toBe("($2K)");
    expect(formatMoney(950)).toBe("$950");
  });

  it("renders a dash for non-numbers", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });
});

describe("formatYearList", () => {
  it("lists short runs and collapses long ones", () => {
    expect(formatYearList([2027, 2026])).toBe("2026, 2027");
    expect(formatYearList([2029, 2030, 2031, 2032, 2033])).toBe("2029–2033 (5 years)");
    expect(formatYearList([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// CR071 — where the forecast's numbers disagree with the owner's intent.
//
// Every case below is taken from a real prod configuration, because the point of these rules is
// that each is a VALID setup the engine models faithfully and the owner probably did not mean.
// A rule that only fires on invented data is a rule that has not met its subject.
//
// These are detections, never corrections: nothing here may change a number.
// ---------------------------------------------------------------------------
describe("CR071 — module integrity warnings", () => {
  const mod = (o = {}) => ({
    Name: "M",
    Type: "Real Estate",
    Currency: "USD",
    SetupStatus: "complete",
    HasValuation: true,
    Streams: [],
    Amortization: [],
    DisposeCount: 0,
    DisposeFullCount: 0,
    DisposeFirstYear: null,
    ...o,
  });
  const ids = (modules, periodStart = 2027) =>
    computeModuleIntegrityWarnings(modules, { periodStart }).map((w) => w.id);

  it("R3 — flags a loan whose interest rate is missing, which is the case the loan warnings CANNOT see", () => {
    // `House Morgage` on prod, in all five scenarios: typed Loan, 500,000 principal, 19
    // amortization rows, secured — and no rate, so the engine booked no debt at all.
    // computeLoanWarnings returns early on exactly this condition, which is why R3 exists.
    const houseMorgage = mod({
      Name: "House Morgage",
      Type: "Loan",
      LoanPrincipal: 500000,
      LoanInterestRate: null,
      Amortization: [{ Pct: 5 }],
      SecuredAssetModuleId: 170,
    });
    expect(computeLoanWarnings([houseMorgage])).toHaveLength(0); // the gap this rule closes
    expect(ids([houseMorgage])).toContain("type-data-loan-House Morgage");
  });

  it("R3 — does not fire once the rate is set", () => {
    expect(ids([mod({ Name: "L", Type: "Loan", LoanPrincipal: 500000, LoanInterestRate: 6 })]))
      .not.toContain("type-data-loan-L");
  });

  it("R3 — fires on the DATA even when the type was renamed away from 'Loan'", () => {
    // The whole reason these rules are data-keyed: `module_type` is a free-text list the owner
    // edits, so a rename must not silence a finding.
    expect(ids([mod({ Name: "X", Type: "Something Else", LoanPrincipal: 250000 })]))
      .toContain("type-data-loan-X");
  });

  it("R8 — reports a configured module that is excluded, and marks it dismissible", () => {
    const parked = mod({ Name: "House Morgage", SetupStatus: "new", MarketValue: 0, LoanPrincipal: 500000 });
    const w = computeModuleIntegrityWarnings([parked], { periodStart: 2027 })
      .find((x) => x.id === "configured-but-excluded-House Morgage");
    expect(w).toBeTruthy();
    // Dismissible because being parked is a CHOICE — the owner deliberately left this one out.
    // A warning that cannot tell a parked module from a broken one is the R3 mistake in reverse.
    expect(w.dismissible).toBe(true);
  });

  it("R8 — stays quiet for an empty draft, which is what 'new' normally means", () => {
    expect(ids([mod({ Name: "Draft", SetupStatus: "new" })]))
      .not.toContain("configured-but-excluded-Draft");
  });

  it("R6 — flags a stream with no P&L line", () => {
    // `Sarasota House` on prod: -45,000/yr for 21 years, moving cash with nothing booking it.
    const orphan = mod({
      Name: "Sarasota House",
      Streams: [{ id: 7, direction: "expense", fc_line_id: null, amount: 45000 }],
    });
    expect(ids([orphan])).toContain("stream-no-line-Sarasota House-expense-7");
  });

  it("R1 — flags foreign-currency income with no tax override, and not USD income", () => {
    const ub = mod({
      Name: "United Beverages", Currency: "PLN",
      Streams: [{ id: 1, direction: "income", fc_line_id: 3, tax_rate_override: null }],
    });
    expect(ids([ub])).toContain("foreign-income-no-tax-override-United Beverages-1");

    const usd = mod({ Name: "Salary", Currency: "USD",
      Streams: [{ id: 2, direction: "income", fc_line_id: 3, tax_rate_override: null }] });
    expect(ids([usd])).not.toContain("foreign-income-no-tax-override-Salary-2");

    const covered = mod({ Name: "UB2", Currency: "PLN",
      Streams: [{ id: 3, direction: "income", fc_line_id: 3, tax_rate_override: 3 }] });
    expect(ids([covered])).not.toContain("foreign-income-no-tax-override-UB2-3");
  });

  it("R5 — reports basis === market, but NOT a liability whose basis equals its balance", () => {
    const house = mod({ Name: "PL - Niemena", BaseValue: 4287465, MarketValue: 4287465,
      GrowthRate: 1, DisposeCount: 1, DisposeFullCount: 1 });
    expect(ids([house])).toContain("disposal-no-gain-PL - Niemena");

    // A debt's basis equals its balance BY CONSTRUCTION — reporting that would be noise, and it
    // is why the rule requires a positive market value.
    const card = mod({ Name: "PLN Credit Cards", BaseValue: -24129.55, MarketValue: -24129.55,
      DisposeCount: 1, DisposeFullCount: 1 });
    expect(ids([card])).not.toContain("disposal-no-gain-PLN Credit Cards");
  });

  it("R5 — says what the engine will ACTUALLY do, which depends on growth", () => {
    // The rule used to claim the sale "realizes no gain and pays no tax" whenever basis equalled
    // market. That reads the equality at the BASE DATE; the engine reads it at the DISPOSAL YEAR.
    // The basis is flat while the market value compounds, so by the disposal the two have
    // separated and the Full branch books `market(disposal) − basis`. Owner-found on Barkeria:
    // 1,339,163 − 1,004,870 = 334,293 realized in 2040, on a module called gain-free.
    // Measured on prod: the old wording was wrong on 30 of the 35 modules it fired on.
    const only = (m) => computeModuleIntegrityWarnings([m], 2027)
      .find((w) => w.id === `disposal-no-gain-${m.Name}`);

    // GROWS — a gain IS realized, so the copy must not promise otherwise (25 prod modules).
    const grows = only(mod({ Name: "Barkeria", BaseValue: 3918992, MarketValue: 3918992,
      GrowthRate: 0.8, DisposeCount: 1, DisposeFullCount: 1 }));
    expect(grows).toBeTruthy();
    expect(grows.title).toMatch(/growth since the base date/i);
    expect(grows.detail).not.toMatch(/realizes no gain|pays no tax/i);

    // SHRINKS — a capital LOSS, which is a different finding again (5 prod modules).
    const shrinks = only(mod({ Name: "OCME", BaseValue: 56500, MarketValue: 56500,
      GrowthRate: -20, DisposeCount: 1, DisposeFullCount: 1 }));
    expect(shrinks.title).toMatch(/sold at a loss/i);
    expect(shrinks.detail).toMatch(/capital LOSS/);
    expect(shrinks.detail).not.toMatch(/realizes no gain|pays no tax/i);

    // FLAT — the only case where the original claim was ever true (5 prod modules).
    const flat = only(mod({ Name: "SP - Panorama Mar 6", BaseValue: 250000, MarketValue: 250000,
      GrowthRate: 0, DisposeCount: 1, DisposeFullCount: 1 }));
    expect(flat.title).toMatch(/without realizing any gain/i);
    expect(flat.detail).toMatch(/realizes no gain and pays no tax/);

    // The three say different things, so a dismissal of one cannot silence another.
    const { warningFingerprint } = wf;
    expect(new Set([grows, shrinks, flat].map(warningFingerprint)).size).toBe(3);
  });

  it("R7 — flags a disposal dated before the forecast starts", () => {
    // `Tax Liabilities` on prod disposes 2026-07-01, which is the base year, not a forecast year.
    const tl = mod({ Name: "Tax Liabilities", DisposeCount: 1, DisposeFirstYear: 2026 });
    expect(ids([tl], 2027)).toContain("disposal-before-start-Tax Liabilities");
    expect(ids([mod({ Name: "Later", DisposeCount: 1, DisposeFirstYear: 2030 })], 2027))
      .not.toContain("disposal-before-start-Later");
  });

  it("reports the CVC ambiguity without resolving it", () => {
    // CVC Fund VIII pays a 4% yield AND returns capital on a schedule AND appreciates at 3.75%.
    // Whether that double-counts depends on something only the owner knows, so the rule says so
    // and stops — it must not pick an answer, because the answer moves forecast numbers.
    const cvc = mod({ Name: "CVC Fund VIII",
      Streams: [{ id: 9, direction: "income", mode: "yield", fc_line_id: 4 }],
      DisposeCount: 3 });
    const w = computeModuleIntegrityWarnings([cvc], { periodStart: 2027 })
      .find((x) => x.id === "yield-and-dispose-CVC Fund VIII");
    expect(w).toBeTruthy();
    expect(w.dismissible).toBe(true);
    expect(w.detail).toMatch(/only if the growth rate is already net/i);
  });

  it("a healthy module produces no integrity warnings at all", () => {
    expect(ids([mod({ Name: "Fine", MarketValue: 100000, BaseValue: 50000,
      Streams: [{ id: 1, direction: "income", mode: "amount", fc_line_id: 2 }] })])).toEqual([]);
  });
});
