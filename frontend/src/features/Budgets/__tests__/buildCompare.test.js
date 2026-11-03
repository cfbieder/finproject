import { describe, expect, test } from "vitest";
import { compareBuilds, displaySign } from "../buildCompare.js";

const line = (categoryId, currency, annual, annualUsd, category = `Cat ${categoryId}`, parent = null) =>
  ({ categoryId, currency, annual, annualUsd, category, parent });
const view = (lines) => ({
  lines,
  usdTotal: lines.some((l) => l.annualUsd == null)
    ? null
    : Math.round(lines.reduce((s, l) => s + l.annualUsd, 0) * 100) / 100,
});

describe("compareBuilds", () => {
  test("merges on (category, currency) and takes B − A in USD", () => {
    const a = view([line(1, "USD", -1000, -1000), line(1, "PLN", -4000, -1000)]);
    const b = view([line(1, "USD", -1200, -1200), line(1, "PLN", -4000, -1000)]);
    const { rows, totals } = compareBuilds(a, b);
    expect(rows).toHaveLength(2);
    const usd = rows.find((r) => r.currency === "USD");
    expect(usd.diffUsd).toBe(-200);
    expect(usd.differs).toBe(true);
    expect(rows.find((r) => r.currency === "PLN").differs).toBe(false);
    expect(totals).toEqual({ a: -2000, b: -2200, diff: -200 });
  });

  test("a line in one build only is absent on the other and counts as 0, so the column adds up", () => {
    const a = view([line(1, "USD", -500, -500), line(2, "USD", 300, 300)]);
    const b = view([line(1, "USD", -500, -500), line(3, "EUR", -90, -100)]);
    const { rows, totals } = compareBuilds(a, b);
    const only = (id) => rows.find((r) => r.key.startsWith(`${id}|`));
    expect(only(2).b).toBeNull();
    expect(only(2).diffUsd).toBe(-300);
    expect(only(3).a).toBeNull();
    expect(only(3).diffUsd).toBe(-100);
    const sum = Math.round(rows.reduce((s, r) => s + r.diffUsd, 0) * 100) / 100;
    expect(sum).toBe(totals.diff);
    expect(totals.diff).toBe(-400);
  });

  test("an unknown USD figure gives no difference and no total, never a partial one", () => {
    const a = view([line(1, "USD", -100, -100), line(2, "PLN", null, null)]);
    const b = view([line(1, "USD", -100, -100), line(2, "PLN", -400, -100)]);
    const { rows, totals } = compareBuilds(a, b);
    expect(rows.find((r) => r.currency === "PLN").diffUsd).toBeNull();
    expect(rows.find((r) => r.currency === "PLN").differs).toBe(true);
    expect(totals.a).toBeNull();
    expect(totals.diff).toBeNull();
  });

  test("the same local figure priced at different rates differs in USD", () => {
    const a = view([line(1, "PLN", -4000, -1000)]);
    const b = view([line(1, "PLN", -4000, -1025.64)]);
    const [row] = compareBuilds(a, b).rows;
    expect(row.diffUsd).toBe(-25.64);
    expect(row.differs).toBe(true);
  });

  test("cents of per-line versus per-cell rounding are not a difference", () => {
    const a = view([line(1, "PLN", -4000, -1025.64)]);
    const b = view([line(1, "PLN", -4000, -1025.65)]);
    const [row] = compareBuilds(a, b).rows;
    expect(row.diffUsd).toBe(-0.01);
    expect(row.differs).toBe(false);
  });

  test("rows read parent, then category, then currency", () => {
    const a = view([line(3, "USD", 1, 1, "Zeta", "Home"), line(2, "PLN", 1, 1, "Alpha", "Home"),
      line(2, "EUR", 1, 1, "Alpha", "Home"), line(9, "USD", 1, 1, "Top", null)]);
    const order = compareBuilds(a, a).rows.map((r) => `${r.category}/${r.currency}`);
    expect(order).toEqual(["Top/USD", "Alpha/EUR", "Alpha/PLN", "Zeta/USD"]);
  });
});

describe("displaySign", () => {
  test("follows what is shown, so a figure printed as 0 is not negative", () => {
    expect(displaySign(-0.4)).toBe(0);
    expect(displaySign(-0.5)).toBe(-1);
    expect(displaySign(0.004, 2)).toBe(0);
    expect(displaySign(-0.01, 2)).toBe(-1);
    expect(displaySign(null)).toBe(0);
  });
});
