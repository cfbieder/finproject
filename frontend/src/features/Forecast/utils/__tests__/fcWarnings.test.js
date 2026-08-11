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

  // CR076 §3 — the shortfall is CUMULATIVE and must not be summed.
  //
  // `cash-sweep.js` declares `runningCash` once outside the year loop and never tops it up from
  // the shortfall entry, so each row is the gap to the band on a balance that already carries
  // every prior unfunded year. The old test asserted the SUM (-350000) and passed for a year,
  // which is how prod came to display $1.2M for a plan whose real terminal gap was 1,017,119.
  //
  // The figures below are prod's actual SRQ rows, so this test fails against the old code with
  // exactly the number the owner was shown.
  it("reports the WORST year's shortfall, never the sum (it is cumulative)", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          ...healthy().entries,
          { Year: 2026, Account: "Cash Shortfall", Amount: -169573.32, Module: "_cash_sweep" },
          { Year: 2027, Account: "Cash Shortfall", Amount: -1017119.05, Module: "_cash_sweep" },
        ],
      })
    );
    const w = ws.find((x) => x.id === "unfunded-shortfall");
    expect(w.severity).toBe("error");
    expect(w.years).toEqual([2026, 2027]);
    // The terminal gap — NOT -1186692.37, which double-counts 2026 inside 2027.
    expect(w.amount).toBe(-1017119.05);
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

  it("computeForecastWarnings passes the REAL PeriodStart down, not years[0]", () => {
    // Found 2026-08-07 by a new rule printing a visibly wrong year. FCReview unshifts
    // PeriodStart−1 AND PeriodStart−2 onto `sortedYears` for the actual and budget columns, so
    // `years[0]` is PeriodStart−2 — and R7 was comparing disposal dates against that. On prod
    // it silently missed **20 disposals dated 2026-07-01** across all five scenarios: Full
    // disposals in the budget year that the engine never executes, so the balances they were
    // meant to clear stay on the books for the whole plan with nothing saying so.
    //
    // The same class as CR071 §8: a rule fed a value that is not what its name says.
    const disposer = { Name: "Tax Liabilities", Type: "liability", Currency: "USD",
      SetupStatus: "complete", HasValuation: true, Streams: [], Amortization: [],
      DisposeCount: 1, DisposeFullCount: 0, DisposeFirstYear: 2026 };
    const args = {
      years: [2025, 2026, 2027, 2028],          // as the Review builds them
      bankBalanceByYear: [1, 1, 1, 1],
      entries: [{ Year: 2027, Account: "Bank Accounts", Amount: 1 }],
      modules: [disposer],
      cashSweepLow: null,
    };
    // CR076 §3 — the plumbing fix above was right; the SENTENCE it enabled was not, and this
    // test pinned the wrong one. The engine indexes a disposal against the MODULE'S OWN base
    // year, not PeriodStart, so a 2026 disposal on a 2025-based module executes: prod showed
    // `US - Nokomis` booking 394,875 of proceeds and leaving NO balance row behind.
    //
    // What the real PeriodStart still buys is telling the base year apart from a forecast year.
    // Without it, years[0] = 2025 and a 2026 disposal cannot be identified as base-year at all.
    expect(computeForecastWarnings(args).map((w) => w.id))
      .not.toContain("disposal-in-base-year-Tax Liabilities");
    // With it, the base-year sale is identified — and reported for what it is, not as a sale
    // that "never happens".
    const withStart = computeForecastWarnings({ ...args, periodStart: 2027 });
    expect(withStart.map((w) => w.id)).toContain("disposal-in-base-year-Tax Liabilities");
    expect(withStart.map((w) => w.id)).not.toContain("disposal-before-start-Tax Liabilities");
  });

  // CR076 §5 — `growth_rate` is a MULTIPLIER of inflation, so −20 is −50%/yr at a 2.5%
  // assumption, not −20%/yr. The values below are prod's real distribution: every module sits
  // in [−1, 1.5] except `OCME Sp. z o.o.` at −20, which decays 56,500 PLN to 113 by 2032 with
  // nothing reporting it.
  it("R10 — flags a growth multiplier that reads like a typed percentage", () => {
    const ocme = mod({ Name: "OCME Sp. z o.o.", Growth: -20 });
    const w = computeModuleIntegrityWarnings([ocme], { periodStart: 2027 })
      .find((x) => x.id === "growth-multiplier-outlier-OCME Sp. z o.o.");
    expect(w).toBeTruthy();
    expect(w.severity).toBe("warning");
    expect(w.detail).toMatch(/MULTIPLIER of inflation/);
  });

  it("R10 — stays silent on every multiplier the owner actually uses", () => {
    // The whole live range, so a widened threshold cannot start firing on real choices.
    for (const g of [-1, 0, 0.25, 0.5, 0.8, 0.85, 1, 1.5]) {
      expect(ids([mod({ Name: `M${g}`, Growth: g })], 2027))
        .not.toContain(`growth-multiplier-outlier-M${g}`);
    }
    // A flow module has no valuation to grow, so it is not this rule's business.
    expect(ids([mod({ Name: "Flow", Growth: -20, HasValuation: false })], 2027))
      .not.toContain("growth-multiplier-outlier-Flow");
  });

  it("R9 — a module earning in the budget year with nothing budgeted on its line", () => {
    // CR075: year −1 is the BUDGET and nothing else contributes to it, so an unbudgeted cost
    // reads as a real zero. This rule is what makes that gap visible — it is the price of the
    // owner's budget-only decision, paid deliberately.
    const yielder = mod({ Name: "Fidelity Fixed Income", MarketValue: 1241052,
      Streams: [{ id: 9, direction: "income", mode: "yield", amount: 0, fc_line_name: "Interest Income" }] });

    // Budget carries the line ⇒ silent.
    expect(computeModuleIntegrityWarnings([yielder], { periodStart: 2027, baseYearValues: { "Interest Income": 46000 } })
      .map((w) => w.id)).not.toContain("unbudgeted-base-year-Fidelity Fixed Income");

    // Budget carries nothing ⇒ reported. A yield stream's amount is 0 by construction, so a
    // rule keyed on the amount alone would miss exactly the case that caused CR075.
    const warned = computeModuleIntegrityWarnings([yielder], { periodStart: 2027, baseYearValues: { Travel: -91805 } });
    const w = warned.find((x) => x.id === "unbudgeted-base-year-Fidelity Fixed Income");
    expect(w).toBeTruthy();
    expect(w.detail).toMatch(/"Interest Income"/);
    expect(w.detail).toMatch(/2026/);
  });

  it("R9 — an unbudgeted LOAN's interest is reported, since nothing derives it any more", () => {
    // The case the old code special-cased with a rate × balance derivation. CR075 deleted that
    // (owner: budget only, no fallback), so this warning is the whole of its replacement.
    const loan = mod({ Name: "House Morgage", LoanInterestRate: 6, MarketValue: -500000,
      Streams: [{ id: 3, direction: "expense", mode: "derived", amount: 0, fc_line_name: "Financial Expenses" }] });
    expect(computeModuleIntegrityWarnings([loan], { periodStart: 2027, baseYearValues: {} })
      .map((w) => w.id)).toContain("unbudgeted-base-year-House Morgage");
    expect(computeModuleIntegrityWarnings([loan], { periodStart: 2027, baseYearValues: { "Financial Expenses": -3448 } })
      .map((w) => w.id)).not.toContain("unbudgeted-base-year-House Morgage");
  });

  it("R9 — stays SILENT when the budget map was not supplied at all", () => {
    // Absent is not empty. Warning on every module because a fetch failed would be worse than
    // not warning, and would train the owner to ignore the panel.
    const yielder = mod({ Name: "M", MarketValue: 100000,
      Streams: [{ id: 1, direction: "income", mode: "yield", amount: 0, fc_line_name: "Interest Income" }] });
    expect(computeModuleIntegrityWarnings([yielder], { periodStart: 2027 })
      .map((w) => w.id)).not.toContain("unbudgeted-base-year-M");
  });

  it("R9 — a stream with NO line is R6's finding, not this one", () => {
    // Otherwise the same module is reported twice for one problem.
    const orphan = mod({ Name: "Car Purchase Chris",
      Streams: [{ id: 4, direction: "expense", mode: "amount", amount: 5000, fc_line_id: null, fc_line_name: null }] });
    const ids = computeModuleIntegrityWarnings([orphan], { periodStart: 2027, baseYearValues: {} }).map((w) => w.id);
    expect(ids).not.toContain("unbudgeted-base-year-Car Purchase Chris");
    expect(ids.some((i) => i.startsWith("stream-no-line-"))).toBe(true);
  });

  // CR076 §3 — R7 asserted that a disposal before PeriodStart "never happens" and that the
  // balance "stays on the books for the whole plan". Both halves were false for the only rows it
  // fired on. The engine's disposal index is `disposalYear − module.base_date year`
  // (`fcbuilder-module.js`), so a 2026 sale on a 2025-based module is index 1 and executes; the
  // frame's first column IS the base year, so the cleared balance is written.
  //
  // Falsified against prod before this was changed: `US - Nokomis` 2026-2029 carries
  // `Bank Accounts 394,875` and `Transfer - Bank 394,875` and NO balance row at all.
  it("R7 — a base-year disposal is reported as executed, not as never happening", () => {
    // `Tax Liabilities` on prod disposes 2026-07-01 — the base year, with PeriodStart 2027.
    const tl = mod({ Name: "Tax Liabilities", DisposeCount: 1, DisposeFirstYear: 2026 });
    const got = ids([tl], 2027);
    expect(got).not.toContain("disposal-before-start-Tax Liabilities");
    expect(got).toContain("disposal-in-base-year-Tax Liabilities");
    const w = computeModuleIntegrityWarnings([tl], { periodStart: 2027 })
      .find((x) => x.id === "disposal-in-base-year-Tax Liabilities");
    expect(w.severity).toBe("info");
    expect(w.detail).toMatch(/opening cash/);
    expect(w.detail).toMatch(/2027/);          // the CGT year
  });

  it("R7 — a disposal before the BASE year does still strand the balance", () => {
    // The original claim is true only here: outside every column the engine builds.
    // Prod has 0 such rows, which is why the live firings were all false positives.
    expect(ids([mod({ Name: "Ancient", DisposeCount: 1, DisposeFirstYear: 2024 })], 2027))
      .toContain("disposal-before-start-Ancient");
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

// ─────────────────────────────────────────────────────────────────────────────────────
// CR077 — integrity vs. assumptions.
//
// The panel mixed two kinds of statement under one severity scale: a DEFECT to fix beside
// a JUDGEMENT to record. They are counted and dismissed separately now, so accepting six
// assumptions cannot bury one real defect — CR045 §1's failure mode in a new shape.
// ─────────────────────────────────────────────────────────────────────────────────────
const crMod = (o = {}) => ({
  Name: "M", Type: "Real Estate", Currency: "USD", SetupStatus: "complete",
  HasValuation: true, Streams: [], Amortization: [],
  DisposeCount: 0, DisposeFullCount: 0, DisposeFirstYear: null, ...o,
});

describe("CR077 — warning classification", () => {
  const kindOf = (mods, id) =>
    computeModuleIntegrityWarnings(mods, { periodStart: 2027 }).find((w) => w.id === id)?.kind;

  it("an unlisted id defaults to INTEGRITY, the louder of the two", () => {
    // The default matters: a new rule that forgets to classify itself must land in the tab
    // that gets read, not the one that gets accepted.
    expect(wf.classifyWarning({ id: "some-brand-new-rule" }).kind).toBe("integrity");
  });

  it("a defect is integrity; a judgement is advisory", () => {
    const excluded = crMod({ Name: "Parked", SetupStatus: "exclude", Streams: [
      { id: 1, direction: "expense", mode: "amount", amount: 100, fc_line_id: 4 },
    ] });
    expect(kindOf([excluded], "configured-but-excluded-Parked")).toBe("integrity");

    const outlier = crMod({ Name: "Collapsing", Growth: -30 });
    expect(kindOf([outlier], "growth-multiplier-outlier-Collapsing")).toBe("advisory");
  });

  it("every warning carries a kind — none can reach the panel unclassified", () => {
    // The panel routes on `kind`; an undefined one would silently land in integrity by the
    // `!== "advisory"` fallback, which is safe but hides a missing classification.
    const ws = computeForecastWarnings({
      years: [2026, 2027],
      bankBalanceByYear: [-5, -5],
      entries: [{ Year: 2027, Account: "Cash Shortfall", Amount: -100, Module: "_cash_sweep" }],
      modules: [crMod({ Name: "M", Growth: -30 })],
      cashSweepLow: 200000,
      periodStart: 2027,
    });
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.every((w) => w.kind === "integrity" || w.kind === "advisory")).toBe(true);
  });
});

describe("CR077 A1 — a flow that loses ground to inflation", () => {
  const ids = (mods) =>
    computeModuleIntegrityWarnings(mods, { periodStart: 2027 }).map((w) => w.id);
  const find = (mods, id) =>
    computeModuleIntegrityWarnings(mods, { periodStart: 2027 }).find((w) => w.id === id);

  it("an EXPENSE below inflation is flagged as making the plan look better", () => {
    // The dangerous direction: nothing else on the page flags optimism.
    const m = crMod({ Name: "Household", Streams: [
      { id: 7, direction: "expense", mode: "amount", amount: 50000, growth_mult: 0.5, fc_line_id: 4, fc_line_name: "Purchases" },
    ] });
    const w = find([m], "escalation-below-inflation-Household-expense-7");
    expect(w.kind).toBe("advisory");
    expect(w.detail).toMatch(/LOOK BETTER/);
    expect(w.detail).toMatch(/only 50%/);
  });

  it("an INCOME below inflation is flagged as buying less each year", () => {
    const m = crMod({ Name: "Pension", Streams: [
      { id: 9, direction: "income", mode: "amount", amount: 20000, growth_mult: 0.25, fc_line_id: 4 },
    ] });
    const w = find([m], "escalation-below-inflation-Pension-income-9");
    expect(w.title).toMatch(/buys less every year/);
  });

  it("1 and above never fire — tracking or beating inflation is not a finding", () => {
    for (const g of [1, 1.1, 2]) {
      expect(ids([crMod({ Name: `M${g}`, Streams: [
        { id: 3, direction: "expense", mode: "amount", amount: 100, growth_mult: g, fc_line_id: 4 },
      ] })])).not.toContain(`escalation-below-inflation-M${g}-expense-3`);
    }
  });

  it("a BLANK multiplier never fires — blank means 1", () => {
    // `fcbuilder-stream` reads null/'' as 1. Firing on blank would report the default as a
    // finding on most streams in the plan.
    expect(ids([crMod({ Name: "Blank", Streams: [
      { id: 3, direction: "expense", mode: "amount", amount: 100, growth_mult: null, fc_line_id: 4 },
    ] })])).not.toContain("escalation-below-inflation-Blank-expense-3");
  });

  it("an amount-mode stream of ZERO never fires — nothing cannot erode", () => {
    // Found live 2026-08-10: `New Business` sits at amount 0.00 with 0.9× in all five scenarios
    // and produced an advisory about the escalation of nothing. Same shape as `idle-cash-unpriced`,
    // which CR077 deleted for firing where it carried no information.
    expect(ids([crMod({ Name: "Empty", Streams: [
      { id: 3, direction: "income", mode: "amount", amount: 0, growth_mult: 0.9, fc_line_id: 4 },
    ] })])).not.toContain("escalation-below-inflation-Empty-income-3");
  });

  it("a stream RETIRED by a -100% change never fires — it is not in the plan", () => {
    // Found live 2026-08-10: `Tax` ($55,103, account `Taxes PL`) is zeroed from 2027 by a
    // -100% row, superseded by the per-stream tax_rate_override. It produces NO forecast entries,
    // and the advisory was still reasoning about what its escalation implied over 36 years.
    expect(ids([crMod({ Name: "Retired", Streams: [
      { id: 3, direction: "expense", mode: "amount", amount: 55103, growth_mult: 0, fc_line_id: 4,
        changes: [{ change_date: "2027-12-31", amount: -100, flag: "Percent %" }] },
    ] })])).not.toContain("escalation-below-inflation-Retired-expense-3");
  });

  it("a REVIVED stream fires again — Fixed $ adds to the level, it does not scale it", () => {
    // The reason this is not simply "does a -100 row exist": a later Fixed $ puts money back, so
    // the stream is live from that year and its escalation matters again.
    expect(ids([crMod({ Name: "Revived", Streams: [
      { id: 3, direction: "expense", mode: "amount", amount: 55103, growth_mult: 0.5, fc_line_id: 4,
        changes: [
          { change_date: "2027-12-31", amount: -100, flag: "Percent %" },
          { change_date: "2035-12-31", amount: 20000, flag: "Fixed $" },
        ] },
    ] })])).toContain("escalation-below-inflation-Revived-expense-3");
  });

  it("a YIELD stream still fires at zero — its typed amount is dead, not its money", () => {
    // All 20 yield streams and all 10 derived ones store amount 0.00 while paying real money
    // (CVC Fund IX distributes ~4.2% from a stream typed 0.00). Applying the zero test to those
    // modes would silence live streams, so the guard is amount-mode only.
    expect(ids([crMod({ Name: "Fund", Streams: [
      { id: 3, direction: "income", mode: "yield", amount: 0, growth_mult: 0.9, fc_line_id: 4 },
    ] })])).toContain("escalation-below-inflation-Fund-income-3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// Known Issue #19 — R11: the module's currency disagrees with its account's.
//
// The third shape of the currency defect, and the only one no engine guard can catch.
// CR064 P13 fires when a USD-labelled module's two VALUE columns disagree; the #19 engine
// guard fires on a currency with no FX series. Neither sees values that AGREE because both
// were typed in local currency under a USD label — self-consistent, and simply wrong.
//
// The linked account is the only independent witness. `PLN Credit Cards` is the worked
// example: account 65 said USD, its four PKO children said PLN, the module copied the
// parent, and 18,250 of liability that did not exist rode every forecast year.
// ─────────────────────────────────────────────────────────────────────────────────────
describe("Known Issue #19 — R11: module currency vs account currency", () => {
  const ccyMod = (o = {}) => ({
    Name: "M", Type: "Liability", Currency: "USD", SetupStatus: "complete",
    HasValuation: true, Streams: [], Amortization: [],
    DisposeCount: 0, DisposeFullCount: 0, DisposeFirstYear: null, ...o,
  });
  const warn = (m, id) =>
    computeModuleIntegrityWarnings([m], { periodStart: 2027 }).find((w) => w.id === id);

  it("flags a USD module on a PLN account — the shape that actually shipped", () => {
    const w = warn(
      ccyMod({ Name: "PLN Credit Cards", Currency: "USD", AccountCurrency: "PLN" }),
      "currency-usd-over-account-PLN Credit Cards"
    );
    expect(w).toBeTruthy();
    expect(w.severity).toBe("warning");
    // Integrity, not advice: if this is true, something IS wrong.
    expect(w.kind).toBe("integrity");
  });

  it("treats one non-USD currency over another as a JUDGEMENT, not a defect", () => {
    const w = warn(
      ccyMod({ Name: "Spanish Flat", Currency: "EUR", AccountCurrency: "PLN" }),
      "currency-differs-from-account-Spanish Flat"
    );
    expect(w).toBeTruthy();
    expect(w.kind).toBe("advisory");
  });

  it("stays silent when the two agree — this is what keeps it dormant", () => {
    for (const c of ["USD", "PLN", "EUR"]) {
      const ws = computeModuleIntegrityWarnings(
        [ccyMod({ Currency: c, AccountCurrency: c })], { periodStart: 2027 }
      ).filter((w) => w.id.startsWith("currency-"));
      expect(ws).toHaveLength(0);
    }
  });

  it("stays silent when the account currency is unknown, rather than guessing", () => {
    // An unlinked module has no witness. Reporting one would be a false positive on every
    // module the API has not joined an account onto.
    const ws = computeModuleIntegrityWarnings(
      [ccyMod({ Currency: "PLN", AccountCurrency: null })], { periodStart: 2027 }
    ).filter((w) => w.id.startsWith("currency-"));
    expect(ws).toHaveLength(0);
  });

  it("is case-insensitive, so a lower-cased label is not reported as a mismatch", () => {
    const ws = computeModuleIntegrityWarnings(
      [ccyMod({ Currency: "pln", AccountCurrency: "PLN" })], { periodStart: 2027 }
    ).filter((w) => w.id.startsWith("currency-"));
    expect(ws).toHaveLength(0);
  });
});
