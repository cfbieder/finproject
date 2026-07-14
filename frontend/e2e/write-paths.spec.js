import { test, expect } from "@playwright/test";

/**
 * WRITE-path smoke tests (CR043 Phase 4).
 *
 * The read specs (money-paths.spec.js) catch the page that renders EMPTY. These catch the
 * other half, and it is the half that has cost the most: **the write that appears to
 * succeed and doesn't.**
 *
 *   - CR043 N10 — the forecast write API built its update from a whitelist, so a field it
 *     did not recognise was SILENTLY DROPPED. 200 OK, value gone. That is how CR046's
 *     income/expense window and CR047's tax override both shipped as no-ops: wired through
 *     the editor, the API, the engine and the copy path, and thrown away at one layer.
 *   - POST /util/coa/update destructured `type` and never used it, so changing an account's
 *     type returned 200, echoed the OLD type back, and changed nothing. Live for months,
 *     found only when the first-ever test was written for that route (v3.0.104).
 *
 * Both were invisible from the outside: save, get a success, come back later, it's gone.
 * No error, no log, nothing to grep for. A contract test on the API pins the shape; only a
 * browser round-trip — edit → save → REOPEN → still there — proves it for the user.
 *
 * So every test here reopens the form and asserts the value SURVIVED. Asserting on the save
 * response would reproduce exactly the mistake that let these ship.
 */

const SCENARIO = "E2E Scenario";

/** Open the module editor on a named module. */
async function openModuleEditor(page, moduleName) {
  await page.goto("/forecast-modules");
  const scenario = page.locator("#fc-scenario-select");
  await scenario.waitFor({ state: "visible" });
  await scenario.selectOption({ label: SCENARIO });

  await page.getByText(moduleName).first().waitFor();
  await page.getByText(moduleName).first().click();
  await page.getByRole("button", { name: /Edit/ }).click();
  await expect(page.locator("[role=dialog]")).toBeVisible();
}

test.describe("write paths — the value must survive a reopen", () => {
  test("a forecast module's tax override of 0 and income window survive a save (CR043 N10)", async ({
    page,
  }) => {
    await openModuleEditor(page, "E2E Brokerage");
    const dialog = page.locator("[role=dialog]");

    // 0 is the value that matters. "0%" and "unset" are DIFFERENT — 0 means "taxed at
    // nothing", and the engine relies on the distinction. A round-trip that collapses 0 to
    // null is precisely the silent corruption this test exists to catch.
    const taxOverride = dialog.getByLabel(/Full Tax Override/i);
    await taxOverride.fill("0");

    const incomeStart = dialog.getByLabel(/INCOME START YEAR/i);
    await incomeStart.selectOption("2028");

    await dialog.getByRole("button", { name: /Save Changes/i }).click();
    await expect(dialog).toBeHidden();

    // REOPEN. Asserting on the save response is the mistake that let N10 ship: the API
    // returned 200 while dropping the field.
    await openModuleEditor(page, "E2E Brokerage");
    const reopened = page.locator("[role=dialog]");

    await expect(reopened.getByLabel(/Full Tax Override/i)).toHaveValue("0");
    await expect(reopened.getByLabel(/INCOME START YEAR/i)).toHaveValue("2028");
  });

  test("a Chart of Accounts type change survives a save (the v3.0.104 silent drop)", async ({
    page,
  }) => {
    // Uses a throwaway account: changing Checking's or Brokerage's type would move it between
    // the balance sheet and the P&L and silently break the net-worth assertion in the read
    // specs. A test that corrupts another test's fixture is worse than no test.
    await page.goto("/coa-management");

    const row = page.locator("tbody tr", { hasText: "E2E Type Probe" }).first();
    await row.waitFor();
    await expect(row).toContainText("Expense");

    await row.getByTitle("Edit").click();

    // NB: the COA editor is one of the 14 bespoke dialogs still NOT on the shared <Modal>
    // primitive (check-modal-adoption baseline), so there is no role="dialog" to scope to.
    // Its <label> also wraps the <select> without a for/id pair, so getByLabel() cannot see
    // it either — hence this structural locator. Both are accessibility defects, not test
    // quirks: a screen reader has the same trouble. Migrating the dialog fixes both.
    const typeSelect = page.locator("label", { hasText: "Type" }).locator("select");
    await expect(typeSelect).toHaveValue("expense");
    await typeSelect.selectOption("income");

    await page.getByRole("button", { name: /^Save$/ }).click();

    // RELOAD before asserting — this line is the test.
    //
    // Without it this test PASSES WITH THE BUG PRESENT: the table updates optimistically from
    // client state after a 200, so it shows "Income" whether or not the server stored it.
    // Caught by sabotaging the route and watching the test pass anyway. Reading back the
    // client's own optimism is exactly the false confidence that let the bug live for months —
    // the API returned 200 AND echoed the old type, so nothing downstream looked wrong.
    await page.reload();

    await expect(
      page.locator("tbody tr", { hasText: "E2E Type Probe" }).first()
    ).toContainText("Income", { timeout: 10_000 });
  });
});
