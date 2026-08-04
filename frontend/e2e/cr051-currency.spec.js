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
 * ── RE-POINTED BY CR069 P3, AND STILL SKIPPED — for a reason worth reading ───────────────
 *
 * It used to drive `/forecast-setup-exp`, which no longer exists: an Expenditure item is a
 * module with `has_valuation = false` and one stream. The body below is rewritten for the
 * Modules page and its stream card, and everything up to the currency picker works.
 *
 * It cannot pass yet, and not for a reason a selector fixes: the Modules form's Currency is a
 * SELECT whose options are derived from the account's traits, and the e2e seed's only
 * forecast account (`Brokerage`) is USD. Making this real needs a PLN-bearing account and an
 * FX assumption in `server/db/e2e-seed.sql` — a seed change with its own blast radius, not a
 * tail-end edit to a spec.
 *
 * WHAT COVERS THE BEHAVIOUR MEANWHILE, so this is a gap and not a hole:
 *   - the SERVER half, fully: `server/src/v2/routes/__tests__/cr051.incexp-currency.routes.test.js`
 *     posts a PLN stream to /modules and asserts BOTH halves — the USD twin is derived from
 *     the native amount at the scenario's base-year rate, and a currency the scenario cannot
 *     convert is REFUSED with a 400 rather than silently booked as dollars.
 *   - the "survives a reopen" property of the stream card itself: `write-paths.spec.js` sets
 *     an income window on a card, saves, reopens, and asserts it came back — the CR043 N10
 *     shape this file also guards.
 *
 * Recorded as a P3 tail item rather than deleted: the picker-specific round-trip is genuinely
 * untested until the seed grows a foreign-currency account.
 */

const SCENARIO = "E2E Scenario";

test.describe.skip("CR051 — foreign-currency expense (needs a PLN account in the e2e seed)", () => {
  test("a PLN expense derives USD (native ÷ FX) and the currency survives a reopen", async ({
    page,
  }) => {
    await page.goto("/forecast-modules");
    const scenario = page.locator("#fc-scenario-select");
    await scenario.waitFor({ state: "visible" });
    await scenario.selectOption({ label: SCENARIO });

    // The Modules toolbar calls it "New" (the Expenditures page called it "+Add").
    await page.getByRole("button", { name: "+ New" }).click();
    const dialog = page.locator("[role=dialog]");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Name").fill("E2E PLN Expense");
    await dialog.getByLabel("Currency").selectOption("PLN");

    // The expense is a STREAM now — a card, added on demand.
    await dialog.locator(".fc-stream-cards__add").getByRole("button", { name: "+ Add expense" }).click();
    const card = dialog.locator(".fc-stream-card[data-direction='expense']");
    await expect(card).toBeVisible();
    await card.getByLabel(/Amount/).fill("400");

    await dialog.getByRole("button", { name: /Create|Save/ }).first().click();
    await expect(dialog).toBeHidden();

    // REOPEN — the assertion that matters. The currency was hard-pinned to USD before CR051,
    // and reading the save response would hide a reset. Only edit → reopen proves it stuck.
    const row = page.locator("tbody tr", { hasText: "E2E PLN Expense" }).first();
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole("button", { name: /Edit$/ }).click();
    const reopened = page.locator("[role=dialog]");
    await expect(reopened).toBeVisible();
    await expect(reopened.getByLabel("Currency")).toHaveValue("PLN");

    // ...and the amount came back on its card, as a magnitude — the direction carries the sign.
    const reopenedCard = reopened.locator(".fc-stream-card[data-direction='expense']");
    await expect(reopenedCard).toBeVisible();
    await expect(reopenedCard.getByLabel(/Amount/)).toHaveValue("400");
  });
});
