import { describe, expect, test } from "vitest";
import { categoryReference, factor, lineSign, parseAmount, summarise } from "../itemsMath.js";

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
