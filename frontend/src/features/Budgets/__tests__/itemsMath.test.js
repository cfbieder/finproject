import { describe, expect, test } from "vitest";
import { MAX_ITEMS, applyPaste, categoryReference, factor, lineSign, parseAmount, summarise } from "../itemsMath.js";

const FX = { USD: { rate: 1 }, PLN: { rate: 4 }, EUR: { rate: 0.9 } };
const blank = () => Array(12).fill("");
const row = (description, currency, pairs) => {
  const months = blank();
  for (const [i, v] of Object.entries(pairs)) months[i] = String(v);
  return { description, currency, months };
};
const expense = { currency: "PLN", leFy: -1644, accountType: "expense" };

describe("itemsMath — CR100", () => {
  test("parseAmount: blank is 0, plain numbers only, at most two decimals", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(" 12.5 ")).toBe(12.5);
    expect(parseAmount("-6055")).toBe(-6055);
    expect(parseAmount("1.005")).toBeNaN();
    expect(parseAmount("12abc")).toBeNaN();
  });

  test("lineSign: the estimate's sign, else expense negative and income positive", () => {
    expect(lineSign({ leFy: 50, accountType: "expense" })).toBe(1);
    expect(lineSign({ leFy: 0, accountType: "expense" })).toBe(-1);
    expect(lineSign({ leFy: 0, accountType: "income" })).toBe(1);
  });

  test("factor converts through USD; same currency needs no rate; a missing rate is null", () => {
    expect(factor("USD", "PLN", FX)).toBe(4);
    expect(factor("PLN", "PLN", {})).toBe(1);
    expect(factor("EUR", "PLN", { PLN: { rate: 4 } })).toBeNull();
  });

  test("positives on an expense line come out negative, converted and rounded per month (as the server)", () => {
    const s = summarise([
      row("Lisbon", "PLN", { 0: 500, 2: 1234.57 }),
      row("NYC", "USD", { 1: 100 }),
      row("Rome", "EUR", { 2: 50.55 }),
    ], expense, FX);
    expect(s.problem).toBeNull();
    expect(s.months.slice(0, 3)).toEqual([-500, -400, -1459.24]);
    expect(s.annual).toBe(-2359.24);
    expect(s.rowTotals[1]).toEqual({ own: -100, line: -400 });
  });

  test("typed negatives stay negative — the v3.84.0 defect was a walk that typed positives only", () => {
    const s = summarise([row("Lease", "PLN", { 0: -6055, 1: -6055 })], expense, FX);
    expect(s.problem).toBeNull();
    expect(s.annual).toBe(-12110);
    const income = summarise([row("Fee", "USD", { 0: 10 })], { currency: "USD", leFy: 0, accountType: "income" }, FX);
    expect(income.annual).toBe(10);
  });

  test("each refusal names its reason", () => {
    expect(summarise([], expense, FX).problem).toMatch(/at least one item/);
    expect(summarise([row("", "PLN", { 0: 1 })], expense, FX).problem).toMatch(/description/);
    const income = { currency: "USD", leFy: 100, accountType: "income" };
    expect(summarise([row("x", "USD", { 0: 1, 1: -1 })], income, FX).problem).toMatch(/both signs/);
    expect(summarise([row("x", "PLN", { 0: "1e15" })], expense, FX).problem).toMatch(/not a number/);
    expect(summarise([row("x", "PLN", { 0: "1.234" })], expense, FX).problem).toMatch(/not a number/);
    expect(summarise([row("x", "PLN", {})], expense, FX).problem).toMatch(/an amount/);
  });

  test("a re-opened expense line (rows shown negative) takes a new positive row — the result has one sign", () => {
    const s = summarise([row("Saved", "PLN", { 0: -500 }), row("New", "PLN", { 1: 300 })], expense, FX);
    expect(s.problem).toBeNull();
    expect(s.months.slice(0, 2)).toEqual([-500, -300]);
  });

  test("an unconvertible item leaves the line's months unknown, not 0", () => {
    const s = summarise([row("x", "EUR", { 0: 1 })], expense, { PLN: { rate: 4 } });
    expect(s.months).toBeNull();
    expect(s.annual).toBeNull();
    expect(s.rowTotals[0].line).toBeNull();
  });

  test("the reference sums every currency line of the category, converted; a not-yet-actual month stays null", () => {
    const lines = [{ id: 1, currency: "PLN" }, { id: 2, currency: "USD" }];
    const reference = {
      1: { priorActual: [-100, ...Array(11).fill(null)], thisYearMonths: [-40, ...Array(11).fill(0)] },
      2: { priorActual: [-10, -5, ...Array(10).fill(null)], thisYearMonths: Array(12).fill(0) },
    };
    const r = categoryReference(lines, "PLN", FX, reference);
    expect(r.actual.slice(0, 3)).toEqual([-140, -20, null]);
    expect(r.budget[0]).toBe(-40);
  });
});

describe("applyPaste (CR103 P0)", () => {
  const tsv = (...cells) => cells.join("\t");
  const twelve = (v = "100") => Array(12).fill(v);
  const empty = () => [{ description: "", currency: "USD", months: blank() }];
  const filled = () => [row("Existing", "USD", { 0: 5 })];

  test("a single value is left to the browser", () => {
    expect(applyPaste(empty(), 0, "1820.50", "USD")).toBeNull();
    expect(applyPaste(empty(), 0, "1820.50\r\n", "USD")).toBeNull(); // one spreadsheet cell
  });

  test("14 cells: description, currency, Jan–Dec replace a blank row", () => {
    const r = applyPaste(empty(), 0, tsv("Fidelity Bond — coupons", "usd", ...twelve("1820.5")), "PLN");
    expect(r.rows).toEqual([{ description: "Fidelity Bond — coupons", currency: "USD", months: twelve("1820.5") }]);
  });

  test("13 cells take the line's currency", () => {
    const r = applyPaste(empty(), 0, tsv("Trip", ...twelve()), "PLN");
    expect(r.rows[0].currency).toBe("PLN");
    expect(r.rows[0].months).toEqual(twelve());
  });

  test("several rows: the first fills the blank row, the rest append, CRLF and trailing blank lines ignored", () => {
    const text = [tsv("A", "USD", ...twelve("1")), tsv("B", "EUR", ...twelve("2")), ""].join("\r\n") + "\r\n\r\n";
    const r = applyPaste(empty(), 0, text, "USD");
    expect(r.rows.map((x) => [x.description, x.currency])).toEqual([["A", "USD"], ["B", "EUR"]]);
  });

  test("a non-blank target row is kept and the paste appends", () => {
    const r = applyPaste(filled(), 0, tsv("New", "USD", ...twelve()), "USD");
    expect(r.rows.map((x) => x.description)).toEqual(["Existing", "New"]);
  });

  test("12 cells fill the target row's months, whichever month received them, keeping its description", () => {
    const r = applyPaste(filled(), 0, tsv(...twelve("7")), "USD");
    expect(r.rows).toEqual([{ description: "Existing", currency: "USD", months: twelve("7") }]);
  });

  test("12 amounts plus a trailing tab still read as 12", () => {
    const r = applyPaste(filled(), 0, tsv(...twelve("7"), ""), "USD");
    expect(r.rows[0].months).toEqual(twelve("7"));
  });

  test("12-cell rows in a multi-row paste reject", () => {
    expect(applyPaste(empty(), 0, [tsv(...twelve()), tsv(...twelve())].join("\n"), "USD").error).toMatch(/12 amounts/);
  });

  test("thousands separators are stripped; empty cells stay empty", () => {
    const cells = twelve(""); cells[0] = "1,820.50"; cells[5] = " 12,000 ";
    const r = applyPaste(empty(), 0, tsv("X", "USD", ...cells), "USD");
    expect(r.rows[0].months[0]).toBe("1820.50");
    expect(r.rows[0].months[5]).toBe("12000");
    expect(r.rows[0].months[1]).toBe("");
  });

  test.each([["1820,50"], ["$5"], ["(5)"], ["1\u00a0820"], ["1.005"], ["abc"]])("%s rejects the whole paste", (bad) => {
    const cells = twelve(); cells[3] = bad;
    const r = applyPaste(empty(), 0, [tsv("Good", "USD", ...twelve()), tsv("Bad", "USD", ...cells)].join("\n"), "USD");
    expect(r.error).toMatch(/^Row 2, Apr: /);
    expect(r.rows).toBeUndefined();
  });

  test("an unknown currency or a wrong cell count rejects", () => {
    expect(applyPaste(empty(), 0, tsv("X", "GBP", ...twelve()), "USD").error).toMatch(/currency "GBP"/);
    expect(applyPaste(empty(), 0, tsv("X", "1", "2"), "USD").error).toMatch(/has 3 cells/);
  });

  test("more than MAX_ITEMS rejects", () => {
    const text = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => tsv(`I${i}`, "USD", ...twelve())).join("\n");
    expect(applyPaste(empty(), 0, text, "USD").error).toMatch(/at most 100/);
  });

  test("a pasted row flows through summarise to the cent", () => {
    const cells = ["1820.50", "0", "0", "1820.50", "0", "0", "1820.50", "0", "0", "1820.51", "0", "0"];
    const r = applyPaste(empty(), 0, tsv("Coupons", "USD", ...cells), "USD");
    const s = summarise(r.rows, { currency: "USD", leFy: 40000, accountType: "income" }, FX);
    expect(s.problem).toBeNull();
    expect(s.annual).toBe(7282.01);
  });
});
