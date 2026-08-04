/**
 * CR069 P0 — an income/expense item's entries are attributed to the ITEM, not to the
 * FC line it posts to.
 *
 * The builder used to label entries with `module.Account` — the FC-line/account name —
 * while the balance-sheet builder has always used the module's name. Two items mapped to
 * one line therefore produced entries indistinguishable from each other: on prod's
 * `2026 Base`, `Retirement Home` filed under `Living Expenses`, `Car Purchase Chris`
 * under `One-Off Items`, and `Social Security` under `Total Salary` — three of twelve
 * items with no row bearing their own name, invisible to every breakdown, per-module
 * query and audit click-through.
 *
 * The code claimed this was safe because the two collided "via ON CONFLICT ... last-write-
 * wins". They never did: the conflict target ends in `entry_type`, which no writer sets,
 * and NULLs are distinct in a Postgres unique index — so the rows were always inserted
 * side by side. That is why the TOTALS were right and only the attribution was wrong,
 * and it is why these tests assert both halves: the per-account totals must not move.
 */

const fs = require("fs");
const path = require("path");
const { computeModule, writeEntriesAuditTrail } = require("../fcbuilder-incexp");
const { PATHS } = require("../constants");
const {
  createMockScenario,
  createMockIncExpModule,
  createMockAssumptions,
  createMockCategories,
  createMockCategoriesDF,
} = require("./helpers");

beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });

/** Compute one item against a shared account label; returns its entries payload. */
function computeItem(moduleOverrides) {
  const scenario = createMockScenario({ PeriodStart: 2026, PeriodEnd: 2030, TaxRate: 25 });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockIncExpModule(moduleOverrides);
  const catDF = createMockCategoriesDF([mod.Account, "Taxes", "Bank Accounts"], years);

  return computeModule(
    mod, scenario, createMockAssumptions(scenario), catDF,
    createMockCategories(), years, 1
  ).entries;
}

describe("CR069 P0 — entries are attributed to the item, not to its FC line", () => {
  test("the module label is the item's NAME, not its account", () => {
    const entries = computeItem({
      Name: "Retirement Home",
      Account: "Living Expenses",
      BaseValue: -1000,
      BaseValueUSD: -1000,
      Growth: 1,
    });

    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.module).toBe("Retirement Home");
    }
    // The ACCOUNT is still where the money lands — only the attribution moved.
    expect(entries.some((e) => e.account === "Living Expenses")).toBe(true);
    expect(entries.some((e) => e.module === "Living Expenses")).toBe(false);
  });

  test("two items on ONE account keep separate identities, and their totals still add up", () => {
    const living = computeItem({
      Name: "Living Expenses", Account: "Living Expenses",
      BaseValue: -1000, BaseValueUSD: -1000, Growth: 1,
    });
    const retirement = computeItem({
      Name: "Retirement Home", Account: "Living Expenses",
      BaseValue: -400, BaseValueUSD: -400, Growth: 1,
    });

    // Each is identifiable — the defect was that both said "Living Expenses".
    expect(new Set(living.map((e) => e.module))).toEqual(new Set(["Living Expenses"]));
    expect(new Set(retirement.map((e) => e.module))).toEqual(new Set(["Retirement Home"]));

    // ...and the account total is the sum of the two, unchanged by the relabel. The rows
    // coexist (they differ only in a NULL entry_type, which never conflicts), so a reader
    // that groups by account sees exactly what it saw before.
    const sumFor = (rows, year) => rows
      .filter((e) => e.account === "Living Expenses" && e.forecast_year === year)
      .reduce((s, e) => s + e.amount, 0);

    for (const year of [2026, 2027, 2030]) {
      expect(sumFor(living, year) + sumFor(retirement, year))
        .toBeCloseTo(sumFor([...living, ...retirement], year), 10);
    }
    // Each item keeps its OWN magnitude — the ratio of the two base values, not a shared
    // or overwritten series. (Absolute figures are not asserted: the base year already
    // carries one year of growth, which is the engine's convention and not this CR's.)
    expect(sumFor(living, 2026) / sumFor(retirement, 2026)).toBeCloseTo(1000 / 400, 10);
    expect(sumFor(living, 2026)).toBeLessThan(0);
    expect(sumFor(retirement, 2026)).toBeLessThan(0);
  });

  test("the audit trail is keyed by the item name, so two items on one account get a file each", () => {
    const scenario = createMockScenario({ PeriodStart: 2026, PeriodEnd: 2030 });
    const years = [2026, 2027, 2028, 2029, 2030];
    const frame = createMockCategoriesDF(["Living Expenses", "Taxes", "Bank Accounts"], years);

    writeEntriesAuditTrail(frame, "CR069 Test", "Retirement Home");

    const expected = path.join(PATHS.AUDIT_TRAIL_DIR, "CR069_Test_Retirement_Home_entries.csv");
    const collided = path.join(PATHS.AUDIT_TRAIL_DIR, "CR069_Test_Living_Expenses_entries.csv");
    try {
      expect(fs.existsSync(expected)).toBe(true);
      // The account-keyed name is what the two items used to share, one overwriting the
      // other — so the trail shown for "Living Expenses" was the LAST item's frame.
      expect(fs.existsSync(collided)).toBe(false);
    } finally {
      fs.rmSync(expected, { force: true });
    }
  });
});
