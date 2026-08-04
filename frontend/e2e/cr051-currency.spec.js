import { test, expect } from "@playwright/test";

/**
 * CR051 — foreign-currency expense, full browser round-trip.
 *
 * The unit/route tests prove the server derives base_value_usd and the engine converts per year.
 * This proves the UI half that only a browser can: the currency picker sends its value, the USD
 * preview derives from the native amount, and — the bug this whole family keeps producing — the
 * currency SURVIVES a save + reopen instead of silently resetting to USD (it used to be hard-pinned
 * to "USD" in three places).
 *
 * Seed (server/db/e2e-seed.sql): "E2E Scenario" has a base-year PLN rate of 4, so a −400 PLN
 * expense must book at −100 USD (−400 / 4), not −400.
 *
 * ── SKIPPED BY CR069 P2, and re-enabled by P3 ────────────────────────────────────────────
 *
 * It drives `/forecast-setup-exp`, which P2 removed: an Expenditure item is a module with
 * `has_valuation = false` and one stream, and its API answers 410. The route is gone in the
 * same deploy that stopped the engine reading that table, so leaving the page reachable would
 * have meant saves that succeed and are ignored.
 *
 * The SERVER half of what this protects is covered and was migrated, not dropped:
 * `server/src/v2/routes/__tests__/cr051.incexp-currency.routes.test.js` now posts a PLN stream
 * to `/modules` and asserts both halves — the USD twin is derived from the native amount at the
 * scenario's base-year rate, and a currency the scenario cannot convert is REFUSED with 400.
 *
 * The BROWSER half — that the currency picker sends its value and survives a reopen — cannot
 * be expressed until P3 gives the Modules form the equivalent controls (stream cards). P3 must
 * re-point this spec at `/forecast-modules` and un-skip it. Recorded in CR069 §8 so it is an
 * obligation rather than a skipped test nobody revisits.
 */

const SCENARIO = "E2E Scenario";

test.describe.skip("CR051 — foreign-currency expense (re-enable in CR069 P3)", () => {
  test("a PLN expense derives USD (native ÷ FX) and the currency survives a reopen", async ({
    page,
  }) => {
    await page.goto("/forecast-setup-exp");
    const scenario = page.locator("#fc-exp-scenario-select");
    await scenario.waitFor({ state: "visible" });
    await scenario.selectOption({ label: SCENARIO });

    // New draft expense — nothing is written until Save (CR050/CR042 draft pattern).
    // The toolbar button's accessible name is "+Add"; anchor on end to avoid "Add from FC Lines".
    await page.getByRole("button", { name: /Add$/ }).click();
    const dialog = page.locator("[role=dialog]");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Name").fill("E2E PLN Expense");
    // Type defaults to Expense, which is what exposes the Currency picker (expense-only, F5).
    await dialog.getByLabel("Currency").selectOption("PLN");
    await dialog.getByLabel("Base Value", { exact: true }).fill("-400");

    // The derived USD field is read-only and shows −400 / 4 = −100, in accounting notation.
    await expect(dialog.getByLabel("Base Value (USD)")).toHaveValue("(100.00)");

    await dialog.getByRole("button", { name: /Create Entry|Save Changes/ }).click();
    await expect(dialog).toBeHidden();

    // The table shows the derived USD and, beneath it, the native PLN amount.
    const row = page.locator("tbody tr", { hasText: "E2E PLN Expense" }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("PLN"); // native-currency tag
    await expect(row).toContainText("100"); // derived USD ≈ 100 (from −400 / 4)

    // REOPEN — the assertion that matters. The currency was hard-pinned to USD before CR051;
    // reading the save response would hide a reset. Only edit → reopen proves it stuck.
    await row.click();
    await page.getByRole("button", { name: /Edit$/ }).click();
    const reopened = page.locator("[role=dialog]");
    await expect(reopened).toBeVisible();
    await expect(reopened.getByLabel("Currency")).toHaveValue("PLN");
    await expect(reopened.getByLabel("Base Value", { exact: true })).toHaveValue("-400.00");
  });
});
