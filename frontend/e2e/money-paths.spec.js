import { test, expect } from "@playwright/test";

/**
 * Money-path smoke tests (CR043 Phase 4).
 *
 * Every test here corresponds to a bug that ACTUALLY SHIPPED and that every unit test in the
 * repo passed straight through. That is the point: the failure mode of this codebase is not
 * the wrong number, it is the MISSING number — a page or a modal that renders empty while
 * the data sits right there in the database.
 *
 *   - Modify Transfer said "no transfers for this year" for two years, for every module and
 *     every year, because it fetched an endpoint that does not carry transfers. A unit test
 *     of its year-matching predicate passed the whole time — it was testing a code path that
 *     never received data. (v3.0.98)
 *   - The forecast write API silently dropped unknown fields: 200 OK, value gone. That is how
 *     CR046's window dates and CR047's tax override shipped as no-ops. (v3.0.95)
 *   - The module-list envelope changed; a consumer doing `Array.isArray(res) ? res : []`
 *     would have rendered ZERO modules, silently. (v3.0.103)
 *
 * So these assert on VALUES, never on "the page loaded". A test that only checks for a
 * heading cannot tell a working page from an empty one.
 *
 * Data: server/db/e2e-seed.sql, where the numbers are exact and hand-checkable —
 *   Checking 10,000 + Brokerage 100,000 − Credit Card 1,500 = NET WORTH 108,500.00
 */

const SCENARIO = "E2E Scenario";

/**
 * The Forecast pages default to the migration's "Base Case"; pick the seeded one.
 * Target the scenario picker BY ID — `select.first()` grabs the type FILTER dropdown on the
 * Modules page, which is exactly the kind of brittle locator that makes an e2e suite lie.
 */
async function selectE2EScenario(page, selectId) {
  const select = page.locator(selectId);
  await expect(select).toBeVisible();
  await select.selectOption({ label: SCENARIO });
}

test.describe("money paths", () => {
  test("balance sheet shows the seeded net worth, not an empty tree", async ({ page }) => {
    await page.goto("/balances");

    // The bug class in one assertion: an empty balance sheet still renders all its headings
    // and its chrome. Only the NUMBER separates "working" from "silently broken".
    // (It appears twice — a KPI card and a table cell — hence first().)
    await expect(page.getByText(/108[,.]500/).first()).toBeVisible();
    // The tree renders COLLAPSED, so the leaves (Checking/Brokerage) are not in the DOM
    // until expanded — assert on the top-level rows that are.
    await expect(page.getByText("Assets").first()).toBeVisible();
    await expect(page.getByText("Liabilities").first()).toBeVisible();
  });

  test("forecast modules list is not empty (the N8 envelope regression)", async ({ page }) => {
    // GET /forecast/modules moved from a bare array to {data:[…]} in v3.0.103. A consumer
    // still doing `Array.isArray(res) ? res : []` renders zero modules with no error at all.
    // This is the test that catches that.
    await page.goto("/forecast-modules");
    await selectE2EScenario(page, "#fc-scenario-select");

    await expect(page.getByText("E2E Brokerage").first()).toBeVisible();
    await expect(page.getByText("E2E Periodic").first()).toBeVisible();
  });

  test("the engine generates and the review renders the result", async ({ page }) => {
    await page.goto("/forecast-review");
    await selectE2EScenario(page, "#fc-review-scenario");

    await page.getByRole("button", { name: /^generate/i }).click();

    // Generation runs the whole engine (module build, cash sweep, tax, the income↔sweep
    // convergence loop) inside one transaction. If any of it throws, the Review stays empty
    // — so this single assertion covers the broadest surface in the app.
    //
    // The Review is keyed by ACCOUNT, not by module name: the engine books the seeded
    // "E2E Brokerage" module against its `Brokerage` account, and the sweep books cash to
    // `Transfer - Bank`. Asserting on the module name would have tested nothing.
    await expect(page.getByText("Brokerage").first()).toBeVisible({ timeout: 25_000 });
    // ("Transfer - Bank", where the sweep books cash, is a leaf under Transfers and renders
    //  collapsed — not asserted here rather than contorting the test to force it open.)
  });

  test("budget vs actual renders the seeded year", async ({ page }) => {
    // Seeded: budget Salary 12,000 / Rent −2,500 vs actual Salary 112,000 / Rent −3,500,
    // all in Jan–Feb 2026. The page DEFAULTS to "This Month", which is legitimately empty —
    // so widen to the year first. (Asserting against the default period would have produced
    // a test that passes on an empty page: the exact failure this suite exists to prevent.)
    await page.goto("/budget-vs-actual/table");
    await page.getByRole("button", { name: "This Year" }).click();

    await expect(page.getByText("Income").first()).toBeVisible();
    await expect(page.getByText(/112[,.]000/).first()).toBeVisible();
  });
});
