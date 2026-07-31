/**
 * CR062 — the loan rules in `fcWarnings`.
 *
 * These are derived on the client from the modules payload (`Loan*` + `Amortization`,
 * which the LIST endpoint now serves) rather than transported from the engine: the
 * engine produces the same findings during a build and logs them, but there is no
 * channel from `generateForecast` to this component, and inventing one for four
 * warnings is more machinery than the finding is worth.
 *
 * A balloon is a property of the SCHEDULE, never of arithmetic — that is the whole
 * point of the owner's decision that the end year repays the remainder. The last
 * test is the one that matters: a straight-line default must be SILENT.
 */
import { describe, test, expect } from "vitest";
import { computeLoanWarnings } from "../utils/fcWarnings.js";

const loan = (over = {}) => ({
  Name: "Mortgage",
  LoanInterestRate: 5,
  LoanPrincipal: 400000,
  LoanStartDate: "2027-07-01",
  LoanEndDate: "2036-07-01",
  Amortization: [],
  ...over,
});

/** The "Straight line" button's output: drawYear+1 … endYear−1 at 100/term. */
const straightLine = (draw, end) => {
  const pct = Number((100 / (end - draw)).toFixed(4));
  const rows = [];
  for (let y = draw + 1; y < end; y++) rows.push({ Date: `${y}-07-01`, Pct: pct });
  return rows;
};

const ids = (ws) => ws.map((w) => w.id);

describe("CR062 — loan warnings", () => {
  test("a module with no rate is not a loan and produces nothing", () => {
    expect(computeLoanWarnings([{ Name: "House", LoanInterestRate: null }])).toEqual([]);
    expect(computeLoanWarnings([])).toEqual([]);
  });

  test("a 0% loan IS a loan — 0 is a real rate, not 'unset'", () => {
    const ws = computeLoanWarnings([loan({ LoanInterestRate: 0, Amortization: [] })]);
    expect(ids(ws)).toContain("loan-bullet-Mortgage");
  });

  test("an incomplete loan is an error, and short-circuits the rest", () => {
    const ws = computeLoanWarnings([loan({ LoanPrincipal: 0 })]);
    expect(ids(ws)).toEqual(["loan-incomplete-Mortgage"]);
    expect(ws[0].severity).toBe("error");

    expect(ids(computeLoanWarnings([loan({ LoanEndDate: null })]))).toEqual([
      "loan-incomplete-Mortgage",
    ]);
  });

  test("nothing scheduled means the whole balance falls due at once", () => {
    const ws = computeLoanWarnings([loan()]);
    expect(ids(ws)).toEqual(["loan-bullet-Mortgage"]);
    expect(ws[0].years).toEqual([2036]);
    expect(ws[0].amount).toBe(-400000);
  });

  test("a schedule totalling more than 100% is flagged as over-scheduled", () => {
    const ws = computeLoanWarnings([
      loan({ Amortization: [2028, 2029, 2030].map((y) => ({ Date: `${y}-07-01`, Pct: 40 })) }),
    ]);
    expect(ids(ws)).toContain("loan-over-scheduled-Mortgage");
  });

  test("a genuinely lopsided final year is a balloon", () => {
    // 5% x 8 years leaves 60% falling due at the end.
    const ws = computeLoanWarnings([
      loan({
        Amortization: [2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035].map((y) => ({
          Date: `${y}-07-01`,
          Pct: 5,
        })),
      }),
    ]);
    expect(ids(ws)).toContain("loan-balloon-Mortgage");
  });

  test("THE test: a straight-line default is completely silent", () => {
    // 100/9 stored at 4dp sums to 99.9999%. Before the owner's decision that the end
    // year repays the REMAINDER, that left a 40-cent residual on a 400K loan — which
    // fired both the Sigma warning and the balloon warning on the one-click happy
    // path, training the reader to ignore the channel meant to surface a real balloon.
    for (const [draw, end] of [
      [2027, 2036],
      [2027, 2030],
      [2030, 2060],
      [2028, 2035],
    ]) {
      const ws = computeLoanWarnings([
        loan({
          LoanStartDate: `${draw}-07-01`,
          LoanEndDate: `${end}-07-01`,
          Amortization: straightLine(draw, end),
        }),
      ]);
      expect(ws).toEqual([]);
    }
  });

  test("each loan is reported separately, and non-loans are skipped", () => {
    const ws = computeLoanWarnings([
      loan({ Name: "A" }),
      { Name: "House", LoanInterestRate: null },
      loan({ Name: "B" }),
    ]);
    expect(ids(ws)).toEqual(["loan-bullet-A", "loan-bullet-B"]);
  });
});
