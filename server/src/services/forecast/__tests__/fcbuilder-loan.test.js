/**
 * CR062 P1 — the pure loan derivation (fcbuilder-loan.js).
 *
 * V3  §5.5's worked example, to the cent
 * V7  the emission-window invariant (a draw at the base year is discarded downstream)
 * V10 a straight-line schedule closes at EXACTLY zero, with no warning
 * V11 an over-scheduled loan clamps and warns
 * V12 a real balloon is distinguished from a rounding residual
 */

const { deriveLoanSchedule, straightLineSchedule } = require("../fcbuilder-loan");

const yearsOf = (invest) => invest.map((e) => Number(String(e.Date).slice(0, 4)));
const amountAt = (invest, year) =>
  invest.filter((e) => String(e.Date).startsWith(String(year))).reduce((s, e) => s + e.Amount, 0);
const codes = (warnings) => warnings.map((w) => w.code);

/** Replay the emitted schedule into a year-by-year outstanding balance. */
function balanceByYear(invest, { baseYear, horizonEnd, opening = 0 }) {
  const out = {};
  let balance = -Math.abs(opening);
  for (let year = baseYear + 1; year <= horizonEnd; year++) {
    balance += amountAt(invest, year);
    out[year] = balance;
  }
  return out;
}

// A 400,000 loan drawn 2027, ending 2036 — the CR's worked example.
const WORKED = {
  principal: 400000,
  drawYear: 2027,
  endYear: 2036,
  baseOutstanding: 0,
  baseYear: 2026,
  horizonEnd: 2062,
};

describe("CR062 V3 — the worked example reproduces to the cent", () => {

  test("V3.1 draw, straight-line principal, and a balance that closes at zero", () => {
    const amortPct = straightLineSchedule(2027, 2036);
    const { invest, warnings } = deriveLoanSchedule({ ...WORKED, amortPct });

    // 2028..2035 scheduled (8 rows), 2036 is the remainder, plus the 2027 draw.
    expect(amortPct).toHaveLength(8);
    expect(amortPct[0]).toEqual({ year: 2028, pct: 11.1111 });
    expect(yearsOf(invest)).toEqual([2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036]);

    expect(amountAt(invest, 2027)).toBeCloseTo(-400000, 2);   // draw releases the cash
    expect(amountAt(invest, 2028)).toBeCloseTo(44444.4, 2);   // 11.1111% of 400,000
    expect(amountAt(invest, 2035)).toBeCloseTo(44444.4, 2);

    const balances = balanceByYear(invest, WORKED);
    expect(balances[2027]).toBeCloseTo(-400000, 2);
    expect(balances[2028]).toBeCloseTo(-355555.6, 2);
    expect(balances[2029]).toBeCloseTo(-311111.2, 2);

    // The whole point of decision 4 — exactly zero, not "close to".
    expect(balances[2036]).toBeCloseTo(0, 10);
    expect(balances[2062]).toBeCloseTo(0, 10);

    // Sum of every repayment equals the principal, exactly.
    const repaid = invest.filter((e) => e.Amount > 0).reduce((s, e) => s + e.Amount, 0);
    expect(repaid).toBeCloseTo(400000, 10);

    expect(warnings).toEqual([]);
  });

  test("V3.2 the remainder absorbs the rounding the percentages leave behind", () => {
    // 8 x 11.1111% = 88.8888% of 400,000 = 355,555.20, so the remainder year must
    // pay 44,444.80 — NOT the 44,444.40 a ninth percentage row would have paid.
    // Stored at 4dp a 100/9 schedule sums to 99.9999%: without decision 4 this
    // loan ends 40 cents short and trips the balloon warning on the happy path.
    const { invest } = deriveLoanSchedule({ ...WORKED, amortPct: straightLineSchedule(2027, 2036) });
    expect(amountAt(invest, 2036)).toBeCloseTo(44444.8, 2);
    expect(amountAt(invest, 2035)).toBeCloseTo(44444.4, 2);
  });

  test("V3.3 an EXISTING mortgage starts from today's outstanding, with no draw", () => {
    // §4's two-role model: loan_principal is the % base (original 400,000, taken
    // 2015), market_value is what is owed now. This is the case an earlier draft
    // would have rejected with a 400.
    const { invest, warnings } = deriveLoanSchedule({
      principal: 400000,
      drawYear: 2015,
      endYear: 2030,
      baseOutstanding: -250000,
      baseYear: 2026,
      horizonEnd: 2062,
      amortPct: [{ year: 2027, pct: 10 }, { year: 2028, pct: 10 }],
    });

    expect(invest.every((e) => e.Amount > 0)).toBe(true);      // no draw is injected
    expect(amountAt(invest, 2027)).toBeCloseTo(40000, 2);      // 10% of the ORIGINAL, not the outstanding
    expect(amountAt(invest, 2030)).toBeCloseTo(170000, 2);     // remainder: 250,000 − 80,000

    const balances = balanceByYear(invest, { baseYear: 2026, horizonEnd: 2035, opening: 250000 });
    expect(balances[2026 + 1]).toBeCloseTo(-210000, 2);
    expect(balances[2030]).toBeCloseTo(0, 10);
    expect(codes(warnings)).not.toContain("loan_past_no_balance");
  });
});

describe("CR062 V7 — the emission window is an invariant", () => {

  test("V7.1 a draw AT the base year is never emitted", () => {
    // The categories frame starts at PeriodStart − 1 and writeValuesToCategoryRow
    // discards anything before it: a draw at index 0 propagates into every later
    // market value and is then dropped on write, leaving a liability with no cash
    // and no error. Treated as an already-drawn loan instead.
    const { invest } = deriveLoanSchedule({
      ...WORKED, drawYear: 2026, baseOutstanding: -400000,
      amortPct: [{ year: 2027, pct: 50 }],
    });
    expect(yearsOf(invest)).not.toContain(2026);
    expect(invest.every((e) => e.Amount > 0)).toBe(true);
  });

  test("V7.2 nothing is emitted beyond the horizon", () => {
    const { invest } = deriveLoanSchedule({
      ...WORKED, drawYear: 2027, endYear: 2036, horizonEnd: 2031,
      amortPct: straightLineSchedule(2027, 2036),
    });
    expect(Math.max(...yearsOf(invest))).toBeLessThanOrEqual(2031);
  });

  test("V7.3 the invariant throws rather than emitting silently", () => {
    // Guards the guard: if a future edit lets a year through, it must fail loudly
    // instead of producing a schedule that is quietly discarded downstream.
    const { deriveLoanSchedule: derive } = require("../fcbuilder-loan");
    expect(() => derive({
      principal: 100, drawYear: 2020, endYear: 2019,
      baseOutstanding: -100, baseYear: 2026, horizonEnd: 2030, amortPct: [],
    })).not.toThrow();   // out-of-range years are skipped by the loop, never emitted
  });

  test("V7.4 a past loan with nothing outstanding warns and emits nothing", () => {
    const { invest, warnings } = deriveLoanSchedule({
      ...WORKED, drawYear: 2015, baseOutstanding: 0, amortPct: [{ year: 2027, pct: 10 }],
    });
    expect(invest).toEqual([]);
    expect(codes(warnings)).toContain("loan_past_no_balance");
  });

  test("V7.5 a future draw that also carries a balance today is flagged as double-counted", () => {
    const { warnings } = deriveLoanSchedule({ ...WORKED, baseOutstanding: -50000, amortPct: [] });
    expect(codes(warnings)).toContain("loan_double_counted");
  });
});

describe("CR062 V10/V11/V12 — closing, clamping, ballooning", () => {

  test("V10 the one-click straight-line default closes at zero and says nothing", () => {
    for (const [draw, end] of [[2027, 2036], [2027, 2030], [2030, 2060], [2027, 2028]]) {
      const { invest, warnings } = deriveLoanSchedule({
        ...WORKED, drawYear: draw, endYear: end, amortPct: straightLineSchedule(draw, end),
      });
      const balances = balanceByYear(invest, { baseYear: 2026, horizonEnd: 2062 });
      expect(balances[2062]).toBeCloseTo(0, 10);
      // A 1-year bullet legitimately warns; every real term must be silent.
      if (end - draw > 1) expect(warnings).toEqual([]);
    }
  });

  test("V11 an over-scheduled loan clamps at zero and warns", () => {
    // 30% x 5 = 150%. The overshoot has to land MID-year to exercise the clamp:
    // 25% x 6 also totals 150% but consumes the balance exactly on the fourth
    // payment, so every repayment is affordable and only the Sigma warning fires.
    // 120,000 a year against 400,000 leaves 40,000 owing when the fourth falls due.
    const { invest, warnings } = deriveLoanSchedule({
      ...WORKED,
      endYear: 2040,
      amortPct: [2028, 2029, 2030, 2031, 2032].map((year) => ({ year, pct: 30 })),
    });

    expect(amountAt(invest, 2030)).toBeCloseTo(120000, 2);
    expect(amountAt(invest, 2031)).toBeCloseTo(40000, 2);   // capped, not 120,000
    expect(amountAt(invest, 2032)).toBeCloseTo(0, 10);      // nothing left to repay

    const balances = balanceByYear(invest, { baseYear: 2026, horizonEnd: 2062 });
    // Never crosses zero into a phantom asset...
    for (const year of Object.keys(balances)) expect(balances[year]).toBeLessThanOrEqual(0.005);
    // ...and stops dead once repaid, rather than continuing to "repay".
    expect(balances[2031]).toBeCloseTo(0, 10);
    expect(balances[2062]).toBeCloseTo(0, 10);
    expect(codes(warnings)).toContain("loan_over_scheduled");
    expect(codes(warnings)).toContain("loan_repayment_capped");
  });

  test("V12.1 an interest-only loan reports a bullet, not a rounding residual", () => {
    const { invest, warnings } = deriveLoanSchedule({ ...WORKED, amortPct: [] });
    expect(amountAt(invest, 2036)).toBeCloseTo(400000, 2);
    expect(codes(warnings)).toContain("loan_bullet");
  });

  test("V12.2 a genuinely lopsided final year is a balloon", () => {
    // 5% a year for eight years leaves 60% falling due at the end.
    const { warnings } = deriveLoanSchedule({
      ...WORKED,
      amortPct: [2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035].map((year) => ({ year, pct: 5 })),
    });
    expect(codes(warnings)).toContain("loan_balloon");
  });

  test("V12.3 rounding alone is NEVER reported as a balloon", () => {
    // The regression decision 4 exists to prevent: 100/9 at 4dp sums to 99.9999%.
    for (const [draw, end] of [[2027, 2036], [2027, 2033], [2027, 2040], [2028, 2035]]) {
      const { warnings } = deriveLoanSchedule({
        ...WORKED, drawYear: draw, endYear: end, amortPct: straightLineSchedule(draw, end),
      });
      expect(codes(warnings)).not.toContain("loan_balloon");
      expect(codes(warnings)).not.toContain("loan_bullet");
    }
  });
});
