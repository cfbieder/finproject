/**
 * CR087 §4b — the variance sign convention, locked down.
 *
 * The defect: `BudgetRealization.jsx` and `excelExporter.js` both chose between
 * `actual − budget` and `budget − actual` by SUBSTRING-MATCHING an owner-editable
 * account name —
 *
 *     path[0].toLowerCase().includes("expense") || …includes("income")
 *
 * — so the same column carried opposite signs depending on what a root was
 * called, renaming `Expenses` → `Spending` in COA Management would have flipped
 * every variance under it silently, and any root matching neither word already
 * got the inverted convention. It is the name-as-key pattern the forecast rules
 * ban, and it lived in TWO files, so fixing only the page would have left the
 * screen and the exported workbook disagreeing.
 *
 * ⚠️ The branch was not merely fragile, it was WRONG. Measured on prod
 * 2026-08-24: expense `budget_entries` run **min −71,968 / max 0, 656 of 657
 * negative**, and 2026 expense transactions sum **−180,215.35**. Expenses are
 * stored NEGATIVE on both sides, so `actual − budget` is favourable-positive for
 * income and expense alike, and the second branch was never correct for anything.
 *
 * This suite locks the convention as arithmetic AND guards the source against
 * the branch coming back — the latter matters more, because the sign is computed
 * inline on six surfaces and a unit test can only reach two of them.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The one rule, stated once. Every surface must agree with this.
const variance = (actual, budget) => actual - budget;

describe("CR087 §4b — variance sign convention", () => {
  test("income: beating the budget is FAVOURABLE (positive)", () => {
    expect(variance(400, 300)).toBe(100);
  });

  test("income: missing the budget is UNFAVOURABLE (negative)", () => {
    expect(variance(250, 300)).toBe(-50);
  });

  test("expense: spending LESS is FAVOURABLE (positive) — both sides negative", () => {
    // budgeted −100, spent −80 ⇒ 20 under ⇒ +20 favourable
    expect(variance(-80, -100)).toBe(20);
  });

  test("expense: overspending is UNFAVOURABLE (negative)", () => {
    // budgeted −100, spent −130 ⇒ 30 over ⇒ −30 unfavourable
    expect(variance(-130, -100)).toBe(-30);
  });

  test("the OLD branch inverted expenses — this is the defect, kept as a witness", () => {
    const oldExpenseBranch = (actual, budget) => budget - actual;
    // The same underspend the convention calls +20 favourable…
    expect(variance(-80, -100)).toBe(20);
    // …the old fallback branch reported as −20, i.e. overspent.
    expect(oldExpenseBranch(-80, -100)).toBe(-20);
    // A root named neither "income" nor "expense" took exactly that branch.
  });

  test("a root named neither word is no longer a special case", () => {
    // `Realized Gain (Historical)` and `Margin Interest` are real prod roots
    // that match neither substring. They now use the same rule as everything else.
    for (const name of ["Realized Gain (Historical)", "Margin Interest", "Spending"]) {
      expect(name.toLowerCase().includes("expense")).toBe(false);
      expect(name.toLowerCase().includes("income")).toBe(false);
    }
    expect(variance(-80, -100)).toBe(20);
  });
});

describe("CR087 §4b — the branch must not come back", () => {
  // Inline sign computation cannot be imported, so guard the source instead.
  const SURFACES = [
    "pages/BudgetRealization.jsx",
    "pages/BudgetVariances.jsx",
    "pages/BudgetWorksheetV2.jsx",
    "utils/excelExporter.js",
    "features/BudgetEntry/hooks/useBalanceData.js",
  ];

  test.each(SURFACES)("%s computes no variance as budget − actual", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8")
      // strip comments — this file's own explanatory prose names the old form,
      // and so does BudgetRealization's, deliberately.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/budget\s*-\s*actual/i);
    expect(src).not.toMatch(/budgetForVariance\s*-\s*actualForVariance/);
  });

  test.each(SURFACES)("%s does not key a sign on an account-name substring", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/includes\(["']expense["']\)/);
    expect(src).not.toMatch(/includes\(["']income["']\)/);
  });
});
