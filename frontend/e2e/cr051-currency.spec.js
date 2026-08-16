import { test, expect } from "@playwright/test";
import { confirmSavePreview } from "./helpers.js";

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
 * ── RE-POINTED BY CR069 P3; UN-SKIPPED 2026-08-05 ────────────────────────────────────────
 *
 * It used to drive `/forecast-setup-exp`, which no longer exists: an Expenditure item is a
 * module with `has_valuation = false` and one stream, so the body below drives the Modules
 * page and its stream card instead.
 *
 * It stayed skipped after that because the Modules form's Currency is a SELECT whose options
 * are the distinct currencies of every ACTIVE account (`getTraitsMap` → `traitValueOptions`) —
 * so with a USD-only seed the picker could not offer PLN and the spec had nothing to click.
 * The seed now carries `E2E PLN Wallet`, zero-balance and transaction-free precisely so it
 * cannot move `money-paths.spec.js`'s literal 108,500 net worth.
 *
 * What this covers that nothing else does: `cr051.incexp-currency.routes.test.js` proves the
 * SERVER derives the USD twin and refuses an unconvertible currency with a 400, and
 * `write-paths.spec.js` proves a stream card's value survives a reopen — but only a browser
 * proves the picker's own value reaches the save. That is the exact half that broke three
 * times, when the currency was hard-pinned to "USD" in three places and every server-side
 * test still passed.
 */

const SCENARIO = "E2E Scenario";

test.describe("CR051 — foreign-currency expense", () => {
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
    // Anchored on "Amount (base year" — a bare /Amount/ also matches the Mode SELECT, whose
    // accessible name concatenates its own option text ("Mode Amount Yield spread % of value").
    await card.getByLabel(/Amount \(base year/).fill("400");
    // Roadmap Known Issue #2 — an amount with no P&L line is refused, by the form and by the API.
    // The seed carries `E2E Expense Line` (unmapped, so it cannot move any report's totals)
    // precisely so this spec has one to pick.
    await card.getByLabel("Expense line").selectOption({ label: "E2E Expense Line" });

    await dialog.getByRole("button", { name: /Create|Save/ }).first().click();
    await confirmSavePreview(page);
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
    // "400.00", not "400": it round-trips through a numeric(_,2) column.
    const reopenedCard = reopened.locator(".fc-stream-card[data-direction='expense']");
    await expect(reopenedCard).toBeVisible();
    await expect(reopenedCard.getByLabel(/Amount \(base year/)).toHaveValue("400.00");

    // The currency string surviving is necessary but NOT sufficient — CR051's actual failure was
    // a currency that reached the server and was booked as dollars anyway. So assert the twin the
    // server derived from what the PICKER sent: 400 PLN / 4 = 100 USD. Without this the test
    // proves a string made a round trip, not that it meant anything. (The route test proves the
    // same arithmetic from a hand-built request; only this path starts at the select element.)
    const api = await page.request.get(
      `/api/v2/forecast/modules?scenario=${encodeURIComponent(SCENARIO)}`,
    );
    expect(api.ok()).toBeTruthy();
    const body = await api.json();
    const saved = (body.data ?? body).find((m) => m.Name === "E2E PLN Expense");
    expect(saved, "the saved module should come back from the API").toBeTruthy();
    const stream = saved.Streams.find((st) => st.direction === "expense");
    expect(Number(stream.amount)).toBeCloseTo(400, 2);
    expect(Number(stream.amount_usd)).toBeCloseTo(100, 2);
  });
});
