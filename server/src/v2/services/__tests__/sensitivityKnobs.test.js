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

  it("still allows the module tax rate on a flow module", () => {
    // It is the FALLBACK for a stream's income tax, so it is live even with no valuation.
    expect(() => _internals.assertApplicable(spec("module", "tax_rate_override"), flow, flow))
      .not.toThrow();
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
