import { describe, it, expect } from "vitest";
import { evaluateAmountFormula, isFormula } from "../amountFormula";

const val = (s) => {
  const r = evaluateAmountFormula(s);
  if (!r.ok) throw new Error(`expected "${s}" to parse, got: ${r.error}`);
  return r.value;
};
const err = (s) => {
  const r = evaluateAmountFormula(s);
  if (r.ok) throw new Error(`expected "${s}" to be rejected, got ${r.value}`);
  return r.error;
};

describe("evaluateAmountFormula", () => {
  it("still parses every plain amount that worked before", () => {
    expect(val("0")).toBe(0);
    expect(val("450.75")).toBe(450.75);
    expect(val("-450.75")).toBe(-450.75);
    expect(val("+12")).toBe(12);
    expect(val(".5")).toBe(0.5);
    expect(val("  97342.11  ")).toBe(97342.11);
  });

  it("evaluates the owner's case", () => {
    expect(val("11,000-9,600")).toBe(1400);
    expect(val("11000 - 9600")).toBe(1400);
  });

  it("honours operator precedence and brackets", () => {
    expect(val("2+3*4")).toBe(14);
    expect(val("(2+3)*4")).toBe(20);
    expect(val("10-2-3")).toBe(5); // left-associative, not 11
    expect(val("100/4/5")).toBe(5);
    expect(val("-(3+4)")).toBe(-7);
    expect(val("2*-3")).toBe(-6);
  });

  it("accepts commas only in a real thousands position", () => {
    expect(val("1,250.00")).toBe(1250);
    expect(val("1,234,567")).toBe(1234567);
    expect(val("11,000.50-1,000")).toBe(10000.5);
  });

  // The whole point of the comma rule: a European decimal comma must FAIL
  // rather than silently produce a 10x-wrong money value.
  it("rejects a comma used as a decimal separator instead of guessing", () => {
    expect(err("1,5")).toMatch(/thousands separator/);
    expect(err("1,50")).toMatch(/thousands separator/);
    expect(err("11,00-9,60")).toMatch(/thousands separator/);
    expect(err("1,2345")).toMatch(/thousands separator/);
  });

  it("rounds to cents so the preview equals what gets stored", () => {
    expect(val("11000/3")).toBe(3666.67);
    expect(val("0.1+0.2")).toBe(0.3); // not 0.30000000000000004
    expect(val("-0.001")).toBe(0); // no negative zero
  });

  it("rejects malformed input rather than returning a number", () => {
    expect(err("")).toMatch(/enter an amount/);
    expect(err("   ")).toMatch(/enter an amount/);
    expect(err("1+")).toMatch(/incomplete/);
    expect(err("(1+2")).toMatch(/closing bracket/);
    expect(err("1+2)")).toMatch(/valid calculation/);
    expect(err("1 2")).toMatch(/valid calculation/);
    expect(err("abc")).toMatch(/understands/);
    expect(err("1/0")).toMatch(/divide by zero/);
    expect(err("5%2")).toMatch(/understands/);
  });

  it("never executes the input", () => {
    // If this were eval/new Function, these would throw or do something.
    expect(err("alert(1)")).toBeTruthy();
    expect(err("1;2")).toBeTruthy();
    expect(err("(()=>1)()")).toBeTruthy();
  });
});

describe("isFormula", () => {
  it("is false for plain amounts (so no preview clutter)", () => {
    expect(isFormula("")).toBe(false);
    expect(isFormula("450.75")).toBe(false);
    expect(isFormula("-450.75")).toBe(false);
    expect(isFormula("1,250.00")).toBe(false);
  });

  it("is true once there is arithmetic to show", () => {
    expect(isFormula("11,000-9,600")).toBe(true);
    expect(isFormula("2*3")).toBe(true);
    expect(isFormula("(1+2)")).toBe(true);
    expect(isFormula("1,5")).toBe(true); // malformed → preview shows the error
  });
});
