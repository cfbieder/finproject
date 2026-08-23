'use strict';
/**
 * CR085 P1 — the knob arithmetic, in isolation.
 *
 * These are the numbers that decide what a bar means, and every one of them was read out of the
 * engine rather than assumed. The unit errors this pins are silent: they produce a plausible bar
 * of the wrong length, in a chart whose whole claim is that the bars are ranked.
 */

const { KIND, DEFAULT_BAND, KnobError, specFor, _internals } = require('../sensitivityKnobs');
const { perturb, shiftYears } = _internals;

const spec = (entity, field) => specFor(entity, field);

describe('kind assignment follows the ENGINE, not the field name', () => {
  it('module growth_rate is a MULTIPLIER of inflation, not a rate', () => {
    // growthPctForYear returns `growthPct * inflationSeries[i]` (fcbuilder-common.js:104-118):
    // 1.0 is full CPI. Treating it as a rate and moving it ±1pp would mean 0.0/2.0 — zeroing or
    // doubling an asset's growth while calling it a small stress.
    expect(spec('module', 'growth_rate').kind).toBe(KIND.MULTIPLIER);
    expect(DEFAULT_BAND[KIND.MULTIPLIER]).toBe(0.25);
  });

  it('a stream growth_mult is the same dimensionless kind', () => {
    expect(spec('stream', 'growth_mult').kind).toBe(KIND.MULTIPLIER);
  });

  it('the rates the engine divides by 100 ARE percentage points', () => {
    // fcbuilder-module.js:629 / :635 (-rate / 100) and :500 (gross * pct / 100).
    expect(spec('module', 'loan_interest_rate').kind).toBe(KIND.RATE);
    expect(spec('module', 'tax_rate_override').kind).toBe(KIND.RATE);
    expect(spec('stream', 'tax_rate_override').kind).toBe(KIND.RATE);
    expect(spec('disposal', 'disposal_cost_pct').kind).toBe(KIND.RATE);
  });

  it('values are LEVELS and dates are TIMING', () => {
    expect(spec('module', 'market_value').kind).toBe(KIND.LEVEL);
    expect(spec('stream', 'amount').kind).toBe(KIND.LEVEL);
    expect(spec('module', 'loan_end_date').kind).toBe(KIND.TIMING);
    expect(spec('disposal', 'disposal_date').kind).toBe(KIND.TIMING);
  });
});

describe('the whitelist is closed', () => {
  it('refuses a field that is not in the catalogue', () => {
    expect(() => spec('module', 'name')).toThrow(KnobError);
    expect(() => spec('module', 'scenario_id')).toThrow(KnobError);
    // The one that matters: a field name must never reach SQL as an identifier.
    expect(() => spec('module', 'id; DROP TABLE forecast_modules')).toThrow(KnobError);
  });

  it('refuses an unknown entity', () => {
    expect(() => spec('assumption', 'inflation')).toThrow(KnobError);
  });
});

describe('perturb', () => {
  const rate = spec('module', 'loan_interest_rate');
  const mult = spec('module', 'growth_rate');
  const level = spec('module', 'market_value');

  it('a rate moves in percentage POINTS', () => {
    expect(perturb(rate, 6, 1, 'low').value).toBe(5);
    expect(perturb(rate, 6, 1, 'high').value).toBe(7);
  });

  it('a multiplier moves ABSOLUTELY — 1.0 CPI ± 0.25 is 0.75/1.25', () => {
    expect(perturb(mult, 1.0, 0.25, 'low').value).toBe(0.75);
    expect(perturb(mult, 1.0, 0.25, 'high').value).toBe(1.25);
  });

  it('a level moves RELATIVELY and reports the factor for the USD twin', () => {
    const hi = perturb(level, 1000, 10, 'high');
    expect(hi.value).toBeCloseTo(1100, 6);
    expect(hi.factor).toBeCloseTo(1.1, 9);
  });

  it('⚠️ a LIABILITY is stored negative, so the SAME factor makes the debt bigger', () => {
    // `PLN Credit Cards` lives at -24,542.66. "high" here is +10% of the stored value, which is
    // MORE debt and LESS net worth — so a bar labelled by the field's arithmetic sign would be
    // backwards for every loan in the plan. Direction is taken from the metric instead (§4.2).
    const low = perturb(level, -24542.66, 10, 'low');
    const high = perturb(level, -24542.66, 10, 'high');
    expect(low.value).toBeCloseTo(-22088.394, 3);   // less debt
    expect(high.value).toBeCloseTo(-26996.926, 3);  // more debt
    expect(high.value).toBeLessThan(low.value);
  });

  it('refuses a level knob on 0 — the bar would read "does not matter"', () => {
    expect(() => perturb(level, 0, 10, 'high')).toThrow(/nothing to move/);
  });
});

describe('NULL is load-bearing', () => {
  it('a NULL tax_rate_override perturbs from the SCENARIO rate, never from 0', () => {
    // NULL means "fall back to the scenario rate". Perturbing from 0 would quietly relabel the
    // module tax-free and then measure the sensitivity of that, not of the plan.
    const s = spec('module', 'tax_rate_override');
    expect(perturb(s, null, 1, 'high', { scenarioRate: 23 }).value).toBe(24);
    expect(perturb(s, null, 1, 'low', { scenarioRate: 23 }).value).toBe(22);
  });

  it('a NULL growth_mult reads as 1 (plain inflation) and a NULL growth_rate as 0', () => {
    expect(perturb(spec('stream', 'growth_mult'), null, 0.25, 'high').value).toBe(1.25);
    expect(perturb(spec('module', 'growth_rate'), null, 0.25, 'high').value).toBe(0.25);
  });

  it('⚠️ a NULL date is an OPEN-ENDED model and must not be materialised into one', () => {
    // `end_date` NULL means "runs forever". Turning that into 2048 because someone asked for
    // "±2 years" is a different plan, not a smaller number.
    expect(() => perturb(spec('stream', 'end_date'), null, 2, 'high'))
      .toThrow(/different MODEL/);
  });
});

describe('shiftYears reads LOCAL date components', () => {
  it('shifts whole years and keeps the day', () => {
    expect(shiftYears('2040-07-01', 2)).toBe('2042-07-01');
    expect(shiftYears('2040-07-01', -2)).toBe('2038-07-01');
  });

  it('⚠️ a Date built at LOCAL midnight does not slip a day', () => {
    // node-postgres parses a DATE column into a JS Date at LOCAL midnight; reading UTC components
    // lands on the previous day west of Greenwich. That is CR050 v3.0.110 — a DATE compared as an
    // instant — which reported three overrides for a one-field edit.
    const local = new Date(2040, 6, 1);   // 1 July 2040, local
    expect(shiftYears(local, 2)).toBe('2042-07-01');
  });

  it('keeps 29 February as a day, so a leap-day shift is visible rather than silent', () => {
    expect(shiftYears('2040-02-29', 1)).toBe('2041-02-29');   // normalised by Postgres on write
  });
});


describe("⚠️ knobs the ENGINE would never read are refused, not offered", () => {
  const { _internals } = require("../sensitivityKnobs");
  const flow = { name: "Living Expenses", has_valuation: false, setup_status: "complete" };
  const valued = { name: "Sarasota House", has_valuation: true, setup_status: "complete" };

  it("refuses growth and value on a module with NO valuation", () => {
    // fcbuilder-module.js forces all three to zero when has_valuation is false:
    //   baseValues = hasValuation ? BaseValue : 0   (:142)
    //   marketValues = hasValuation ? MarketValue : 0 (:143)
    //   growthPct  = hasValuation ? Growth : 0      (:288)
    // Twelve of thirty live modules are flow modules, so this was ~36 no-op knobs on offer, each
    // drawing a zero bar that reads "this assumption does not matter".
    for (const field of ["growth_rate", "market_value", "base_value"]) {
      expect(() => _internals.assertApplicable(spec("module", field), flow, flow))
        .toThrow(/reads its value and growth as ZERO/);
    }
  });

  it("⚠️ allows the module tax rate only where there is something to TAX", () => {
    // The column is read in exactly two places: the capital-gains rate on a disposal, and the
    // fallback for an INCOME stream's tax. An expense-only flow module has neither — the CHECK
    // `fc_stream_tax_is_income_only` guarantees its expense streams carry no tax — so the knob
    // writes, builds and moves nothing. It shipped ranking at $0 down AND $0 up on
    // `Car Expenses · Tax rate (gains)`, which reads as "does not matter" rather than "never read".
    const tax = spec("module", "tax_rate_override");

    expect(() => _internals.assertApplicable(tax, flow, flow, {
      streams: [{ direction: "expense" }], disposals: [],
    })).toThrow(/nothing this rate applies to/);

    // An income stream to tax
    expect(() => _internals.assertApplicable(tax, flow, flow, {
      streams: [{ direction: "income" }], disposals: [],
    })).not.toThrow();

    // Or a disposal on a valued module, which realises a gain
    expect(() => _internals.assertApplicable(tax, valued, valued, {
      streams: [], disposals: [{ id: 1 }],
    })).not.toThrow();

    // A valued module with NO disposal realises no gain either
    expect(() => _internals.assertApplicable(tax, valued, valued, {
      streams: [], disposals: [],
    })).toThrow(/nothing this rate applies to/);
  });

  it("refuses the loan fields on a module carrying no loan", () => {
    const noLoan = { ...valued, loan_principal: null };
    expect(() => _internals.assertApplicable(spec("module", "loan_interest_rate"), noLoan, noLoan))
      .toThrow(/carries no loan/);
  });

  it("allows them once a loan is there", () => {
    const loan = { ...valued, loan_principal: 500000 };
    expect(() => _internals.assertApplicable(spec("module", "loan_interest_rate"), loan, loan))
      .not.toThrow();
  });
});

describe("⚠️ growth_mult is only read on an `amount` stream", () => {
  const { _internals } = require("../sensitivityKnobs");
  const mod = { name: "Fidelity Fixed Income", has_valuation: true, setup_status: "complete" };

  it("refuses it on a yield stream — the eighth knob that could not move anything", () => {
    // `growth_mult` feeds exactly one thing: pct[i] = inflationSeries[idx] * mult
    // (fcbuilder-stream.js:69-80). The `yield` branch computes eff = inflation + spread and never
    // reads `pct`. Found on a real run: "Fidelity Fixed Income · Growth (× inflation)" came back
    // "moved the plan by nothing measurable".
    expect(() => _internals.assertApplicable(
      spec("stream", "growth_mult"), { mode: "yield", direction: "income" }, mod
    )).toThrow(/0 by construction|guaranteed no-op/);
  });

  it("refuses it on pct_of_value, which derives from the market value instead", () => {
    expect(() => _internals.assertApplicable(
      spec("stream", "growth_mult"), { mode: "pct_of_value", direction: "expense" }, mod
    )).toThrow(/0 by construction|guaranteed no-op/);
  });

  it("allows it on an amount stream, which is the branch that reads it", () => {
    expect(() => _internals.assertApplicable(
      spec("stream", "growth_mult"), { mode: "amount", direction: "expense", amount: 100 }, mod
    )).not.toThrow();
  });

  // ⚠️ THE CR085 SWEEP FOUND THIS ONE BY MEASURING, AND THEN FOUND THE FIRST FIX WRONG.
  //
  // A stream with no amount has nothing for a multiplier to scale — but `amount = 0` alone is NOT
  // that condition: `forecast_stream_changes` rows supply per-year figures, and `Social Security`,
  // `One-Off Items` and `Retirement Home` all sit at 0 while moving the plan through theirs.
  // Gating on the column alone hid five WORKING knobs, which the sweep caught as its `ok` count
  // falling from 129 to 124.
  it("refuses it when there is no amount AND no schedule of changes", () => {
    expect(() => _internals.assertApplicable(
      spec("stream", "growth_mult"), { mode: "amount", direction: "expense", amount: 0 }, mod,
      { changeCount: 0 }
    )).toThrow(/no amount and no schedule/);
  });

  it("⚠️ ALLOWS it at amount 0 when change rows supply the figures", () => {
    expect(() => _internals.assertApplicable(
      spec("stream", "growth_mult"), { mode: "amount", direction: "expense", amount: 0 }, mod,
      { changeCount: 1 }
    )).not.toThrow();
  });
});

describe("⚠️ knobs that could not be APPLIED used to kill the whole run", () => {
  const { _internals } = require("../sensitivityKnobs");
  const mod = { name: "m", has_valuation: true, setup_status: "include" };
  const spec = (over) => ({
    entity: "disposal", field: "disposal_cost_pct", kind: "rate", label: "Selling cost",
    nullIs: 0, min: 0, ...over,
  });

  // `feasibilityPass` applies every knob before the FIRST build and aborts the entire run on the
  // first failure, so one un-appliable knob among eight threw away the other seven — and did it
  // with a Postgres constraint name for a message. Eleven of the twenty disposals on `2026 Base`
  // carry a NULL selling cost, which this spec reads as 0, so the low side of any band is negative
  // and `CHECK (disposal_cost_pct >= 0 AND < 100)` rejects it.
  it("refuses a rate already sitting on its schema floor", () => {
    expect(() => _internals.assertApplicable(spec(), { disposal_cost_pct: null }, mod))
      .toThrow(/no down side to measure/);
    expect(() => _internals.assertApplicable(spec(), { disposal_cost_pct: 0 }, mod))
      .toThrow(/no down side to measure/);
  });

  it("allows one that has room beneath it", () => {
    expect(() => _internals.assertApplicable(spec(), { disposal_cost_pct: 6 }, mod)).not.toThrow();
  });

  it("catches a BAND wide enough to cross a floor that the value itself clears", () => {
    // ±5pp on a 4% selling cost — legal to offer, illegal to apply, and it used to surface as
    // `violates check constraint "fc_disposal_cost_pct_range"`.
    expect(() => _internals.perturb(spec(), 4, 5, "low"))
      .toThrow(/below the 0 the schema allows/);
    expect(_internals.perturb(spec(), 4, 1, "low")).toEqual({ value: 3 });
  });

  // The same shape one field over: `perturb` has always refused a LEVEL knob on a zero, but it
  // refused at APPLY time. The sweep found EIGHTEEN of them live, mostly disposals whose amount of
  // 0 is the "Full disposal" sentinel — a real disposal with no magnitude to scale.
  it("refuses a level knob on a zero in the PICKER, not on build 1 of 17", () => {
    const lvl = { entity: "disposal", field: "amount", kind: "level", label: "Disposal amount", nullIs: 0 };
    expect(() => _internals.assertApplicable(lvl, { amount: 0 }, mod)).toThrow(/nothing to move/);
    expect(() => _internals.assertApplicable(lvl, { amount: null }, mod)).toThrow(/nothing to move/);
    expect(() => _internals.assertApplicable(lvl, { amount: 250 }, mod)).not.toThrow();
  });
});

describe("⚠️ the cost basis is read for exactly one thing — the gain on a sale", () => {
  const { _internals } = require("../sensitivityKnobs");
  const spec = { entity: "module", field: "base_value", kind: "level", label: "Cost basis",
    nullIs: 0, requiresValuation: true, requiresSalePath: true };
  const mod = (over) => ({ name: "m", has_valuation: true, setup_status: "include", ...over });

  // Measured, not reasoned: lowering `Fidelity Fixed Income`'s basis changed 217 rows and every
  // one of them was downstream of `Taxes`. Fidelity is the cash-sweep PRIMARY, which is why it
  // moves while `Misc Investments`, `OCME` and `USD Credit Cards` — never sold — do not.
  it("refuses it on a module that is never sold", () => {
    expect(() => _internals.assertApplicable(spec, { base_value: 100 }, mod(), { disposals: [] }))
      .toThrow(/never sold in this plan/);
  });

  it("allows it when a disposal realises the gain", () => {
    expect(() => _internals.assertApplicable(spec, { base_value: 100 }, mod(), { disposals: [{ id: 1 }] }))
      .not.toThrow();
  });

  it("allows it when the CASH SWEEP can drain the module, with no disposal at all", () => {
    expect(() => _internals.assertApplicable(
      spec, { base_value: 100 }, mod({ cash_sweep_priority: 1 }), { disposals: [] }
    )).not.toThrow();
    expect(() => _internals.assertApplicable(
      spec, { base_value: 100 }, mod({ cash_sweep_target: true }), { disposals: [] }
    )).not.toThrow();
  });
});

describe("knobGroup classifies from the ENGINE, never from module_type", () => {
  const { knobGroup } = require("../sensitivityKnobs");
  const mod = (over) => ({
    name: "m", has_valuation: true, market_value: 100, base_value: 100,
    loan_principal: null, module_type: "Whatever The Owner Typed", ...over,
  });

  it("a valued module is an asset; a negative one is a liability", () => {
    expect(knobGroup(spec("module", "growth_rate"), mod(), mod())).toBe("asset");
    // `PLN Credit Cards` lives at -24,542.66 and moduleWrite treats market_value < 0 as debt.
    const debt = mod({ market_value: -24542.66 });
    expect(knobGroup(spec("module", "growth_rate"), debt, debt)).toBe("liability");
  });

  it("a module carrying a loan is a liability whatever its value says", () => {
    const loan = mod({ loan_principal: 500000 });
    expect(knobGroup(spec("module", "growth_rate"), loan, loan)).toBe("liability");
  });

  it("a stream is classified by its own direction", () => {
    const m = mod({ has_valuation: false });
    expect(knobGroup(spec("stream", "amount"), { direction: "income" }, m)).toBe("income");
    expect(knobGroup(spec("stream", "amount"), { direction: "expense" }, m)).toBe("expense");
  });

  it("a flow module takes the direction of its streams", () => {
    const m = mod({ has_valuation: false });
    const k = spec("module", "tax_rate_override");
    expect(knobGroup(k, m, m, [{ direction: "expense" }])).toBe("expense");
    expect(knobGroup(k, m, m, [{ direction: "income" }])).toBe("income");
    expect(knobGroup(k, m, m, [])).toBe("other");
  });

  it("⚠️ ignores module_type entirely — it is free text the owner edits", () => {
    // Prod carries both `Asset` and `Business`, and nothing constrains the column. CR070 records
    // the same rule for module capabilities.
    const liar = mod({ module_type: "Expense", market_value: 100 });
    expect(knobGroup(spec("module", "growth_rate"), liar, liar)).toBe("asset");
  });
});
